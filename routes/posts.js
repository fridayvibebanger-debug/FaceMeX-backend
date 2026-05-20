import { Router } from 'express';
import { loadJSON, saveJSON } from '../utils/jsonStore.js';
import { initSqlite, dbReady, postsRepo } from '../utils/sqlite.js';
import { requireAuth } from '../middleware/auth.js';
import { createNotification } from '../utils/notify.js';
import { connectDb } from '../lib/db.js';
import { Post } from '../models/Post.js';
import { mongoose } from '../lib/db.js';
import { User } from '../models/User.js';

const router = Router();

let posts = [];

// Initialize SQLite if available; otherwise load JSON fallback
await initSqlite();
if (!dbReady) {
  posts = (await loadJSON('posts.json', posts)) || posts;
}

async function mongoReady() {
  try {
    const conn = await connectDb();
    return !!conn;
  } catch {
    return false;
  }
}

function normalizeMode(mode) {
  return mode === 'professional' ? 'professional' : 'social';
}

function getCanonicalUserId(user) {
  return String(user?.externalId || user?._id || user?.id || '').trim();
}

function isOwner(postUserId, user) {
  const puid = String(postUserId || '').trim();
  if (!puid) return false;
  const canonical = getCanonicalUserId(user);
  const mongoId = String(user?._id || '').trim();
  return (canonical && puid === canonical) || (mongoId && puid === mongoId);
}

function isCollaborator(post, user) {
  const canonical = getCanonicalUserId(user);
  if (!canonical) return false;
  const collaborators = Array.isArray(post?.collaborators) ? post.collaborators : [];
  return collaborators.map((x) => String(x)).includes(String(canonical));
}

function canEdit(post, user) {
  return isOwner(post?.userId, user) || isCollaborator(post, user);
}

router.get('/', (req, res) => {
  (async () => {
    const mode = req.query.mode === 'professional' ? 'professional' : (req.query.mode === 'social' ? 'social' : null);
    const skillRaw = (req.query.skill || '').toString().trim();
    const skill = skillRaw ? skillRaw.toLowerCase() : '';
    const matchesSkill = (content = '') => {
      if (!skill) return true;
      const c = String(content).toLowerCase();
      return c.includes(`#${skill}`) || c.split(/[^a-z0-9+#]/i).includes(skill);
    };

    if (await mongoReady()) {
      const query = {};
      if (mode) query.mode = mode;
      const list = await Post.find(query).sort({ createdAt: -1 }).limit(200).lean();

      const userIds = Array.from(
        new Set((list || []).map((p) => String(p.userId || '').trim()).filter(Boolean))
      );
      const objectIds = userIds
        .filter((id) => /^[0-9a-fA-F]{24}$/.test(id))
        .map((id) => new mongoose.Types.ObjectId(id));

      const users = userIds.length
        ? await User.find({
            $or: [
              { externalId: { $in: userIds } },
              ...(objectIds.length ? [{ _id: { $in: objectIds } }] : []),
            ],
          })
            .select('externalId name avatar verified')
            .lean()
        : [];

      const byUserId = new Map();
      for (const u of users || []) {
        if (u.externalId) byUserId.set(String(u.externalId), u);
        if (u._id) byUserId.set(String(u._id), u);
      }

      const shaped = (list || []).map((p) => {
        const u = byUserId.get(String(p.userId || ''));
        const avatar = (u && u.avatar) ? u.avatar : p.avatar;
        const userName = (u && u.name) ? u.name : p.userName;
        const verified = (u && u.verified) ? true : false;
        return {
          id: p.id,
          userId: p.userId,
          userName,
          avatar,
          verified,
          userVerified: verified,
          content: p.content,
          image: p.image || (Array.isArray(p.images) ? (p.images[0] || '') : ''),
          images: Array.isArray(p.images) ? p.images : [],
          audio: p.audio || '',
          mode: normalizeMode(p.mode),
          collabInvites: Array.isArray(p.collabInvites) ? p.collabInvites : [],
          collaborators: Array.isArray(p.collaborators) ? p.collaborators : [],
          likedBy: Array.isArray(p.likedBy) ? p.likedBy : [],
          likes: Array.isArray(p.likedBy) ? p.likedBy.length : 0,
          comments: Array.isArray(p.comments) ? p.comments : [],
          createdAt: p.createdAt ? new Date(p.createdAt).toISOString() : new Date().toISOString(),
        };
      });
      let filtered = mode ? shaped.filter((p) => p.mode === mode) : shaped;
      if (skill) filtered = filtered.filter((p) => p.mode === 'professional' && matchesSkill(p.content));
      return res.json(filtered);
    }

    if (dbReady) {
      const list = postsRepo.list();
      const normalized = list.map((p) => ({ ...p, mode: p.mode === 'professional' ? 'professional' : 'social' }));
      let filtered = mode ? normalized.filter((p) => p.mode === mode) : normalized;
      if (skill) filtered = filtered.filter((p) => p.mode === 'professional' && matchesSkill(p.content));
      return res.json(filtered);
    }

    // JSON fallback
    const shaped = posts.map((p) => ({
      ...p,
      mode: p.mode === 'professional' ? 'professional' : 'social',
      likes: Array.isArray(p.likedBy) ? p.likedBy.length : (p.likes || 0),
    }));
    let filtered = mode ? shaped.filter((p) => p.mode === mode) : shaped;
    if (skill) filtered = filtered.filter((p) => p.mode === 'professional' && matchesSkill(p.content));
    return res.json(filtered);
  })().catch(() => res.status(500).json({ error: 'server_error' }));
});

// Invite a collaborator (owner only)
router.post('/:id/collab/invite', requireAuth, (req, res) => {
  (async () => {
    const { id } = req.params;
    const inviteeIdRaw = String(req.body?.userId || '').trim();
    if (!inviteeIdRaw) return res.status(400).json({ error: 'userId_required' });
    const inviterId = getCanonicalUserId(req.user);

    if (!(await mongoReady())) {
      return res.status(501).json({ error: 'not_supported' });
    }

    const doc = await Post.findOne({ id });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    if (!isOwner(doc.userId, req.user)) return res.status(403).json({ error: 'Forbidden' });
    if (String(inviteeIdRaw) === String(inviterId)) return res.status(400).json({ error: 'cannot_invite_self' });

    const invites = Array.isArray(doc.collabInvites) ? doc.collabInvites.map(String) : [];
    const collaborators = Array.isArray(doc.collaborators) ? doc.collaborators.map(String) : [];
    if (collaborators.includes(String(inviteeIdRaw))) {
      return res.json({ ok: true, status: 'already_collaborator' });
    }
    if (!invites.includes(String(inviteeIdRaw))) invites.push(String(inviteeIdRaw));
    doc.collabInvites = invites;
    await doc.save();

    try {
      createNotification(req, {
        toUserId: String(inviteeIdRaw),
        fromUserId: String(inviterId),
        type: 'collab_invite',
        title: 'Collaboration Invite',
        message: `${String(req.user?.name || 'Someone')} invited you to collaborate on a post`,
        actionUrl: '/feed',
        meta: { postId: id },
      }).catch(() => {});
    } catch {}

    return res.json({ ok: true, collabInvites: doc.collabInvites, collaborators: doc.collaborators });
  })().catch(() => res.status(500).json({ error: 'server_error' }));
});

// Accept a collaboration invite (invitee only)
router.post('/:id/collab/accept', requireAuth, (req, res) => {
  (async () => {
    const { id } = req.params;
    const userId = getCanonicalUserId(req.user);

    if (!(await mongoReady())) {
      return res.status(501).json({ error: 'not_supported' });
    }

    const doc = await Post.findOne({ id });
    if (!doc) return res.status(404).json({ error: 'Not found' });

    const invites = Array.isArray(doc.collabInvites) ? doc.collabInvites.map(String) : [];
    if (!invites.includes(String(userId))) return res.status(403).json({ error: 'No invite' });

    const nextInvites = invites.filter((x) => x !== String(userId));
    const collaborators = Array.isArray(doc.collaborators) ? doc.collaborators.map(String) : [];
    if (!collaborators.includes(String(userId))) collaborators.push(String(userId));
    doc.collabInvites = nextInvites;
    doc.collaborators = collaborators;
    await doc.save();

    try {
      createNotification(req, {
        toUserId: String(doc.userId),
        fromUserId: String(userId),
        type: 'collab_accept',
        title: 'Collaboration Accepted',
        message: `${String(req.user?.name || 'Someone')} accepted your collaboration invite`,
        actionUrl: '/feed',
        meta: { postId: id },
      }).catch(() => {});
    } catch {}

    return res.json({ ok: true, collabInvites: doc.collabInvites, collaborators: doc.collaborators });
  })().catch(() => res.status(500).json({ error: 'server_error' }));
});

// Reject a collaboration invite (invitee only)
router.post('/:id/collab/reject', requireAuth, (req, res) => {
  (async () => {
    const { id } = req.params;
    const userId = getCanonicalUserId(req.user);

    if (!(await mongoReady())) {
      return res.status(501).json({ error: 'not_supported' });
    }

    const doc = await Post.findOne({ id });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    const invites = Array.isArray(doc.collabInvites) ? doc.collabInvites.map(String) : [];
    if (!invites.includes(String(userId))) return res.status(403).json({ error: 'No invite' });
    doc.collabInvites = invites.filter((x) => x !== String(userId));
    await doc.save();
    return res.json({ ok: true, collabInvites: doc.collabInvites, collaborators: doc.collaborators });
  })().catch(() => res.status(500).json({ error: 'server_error' }));
});

router.post('/', requireAuth, (req, res) => {
  (async () => {
    const { content, image, images, audio, mode } = req.body;
    const safeImages = Array.isArray(images) ? images.filter(Boolean).slice(0, 5) : [];
    const firstImage = (safeImages[0] || image || '');
    const id = `p${Date.now()}`;
    const currentUserId = getCanonicalUserId(req.user);
    const currentUserName = String(req.user?.name || '');
    const currentUserAvatar = String(req.user?.avatar || '');

    if (await mongoReady()) {
      const created = await Post.create({
        id,
        userId: currentUserId,
        userName: currentUserName,
        avatar: currentUserAvatar,
        content: content || '',
        image: firstImage || '',
        images: safeImages,
        audio: audio || '',
        mode: normalizeMode(mode),
        collabInvites: [],
        collaborators: [],
        likedBy: [],
        comments: [],
      });
      return res.status(201).json({
        id: created.id,
        userId: created.userId,
        userName: created.userName,
        avatar: created.avatar,
        content: created.content,
        image: created.image,
        images: created.images,
        audio: created.audio,
        collabInvites: Array.isArray(created.collabInvites) ? created.collabInvites : [],
        collaborators: Array.isArray(created.collaborators) ? created.collaborators : [],
        likedBy: created.likedBy,
        comments: created.comments,
        createdAt: created.createdAt.toISOString(),
        mode: normalizeMode(created.mode),
        likes: 0,
      });
    }

    if (dbReady) {
      const created = postsRepo.create({
        id,
        userId: currentUserId,
        userName: currentUserName,
        avatar: currentUserAvatar,
        content: content || '',
        image: firstImage || '',
        images: safeImages,
        audio: audio || '',
        mode: mode === 'professional' ? 'professional' : 'social'
      });
      return res.status(201).json({ ...created });
    }

    const post = {
      id,
      userId: currentUserId,
      userName: currentUserName,
      avatar: currentUserAvatar,
      content: content || '',
      image: firstImage || '',
      images: safeImages,
      audio: audio || '',
      likedBy: [],
      comments: [],
      createdAt: new Date().toISOString(),
      mode: mode === 'professional' ? 'professional' : 'social'
    };
    posts.unshift(post);
    saveJSON('posts.json', posts).catch(() => {});
    return res.status(201).json({ ...post, likes: 0 });
  })().catch(() => res.status(500).json({ error: 'server_error' }));
});

router.post('/:id/like', requireAuth, (req, res) => {
  (async () => {
    const { id } = req.params;
    const userId = getCanonicalUserId(req.user);
    const userName = String(req.user?.name || 'Someone');

    if (await mongoReady()) {
      const doc = await Post.findOne({ id });
      if (!doc) return res.status(404).json({ error: 'Not found' });
      if (!Array.isArray(doc.likedBy)) doc.likedBy = [];

      const alreadyLiked = doc.likedBy.includes(userId);
      if (alreadyLiked) {
        doc.likedBy = doc.likedBy.filter((x) => String(x) !== String(userId));
      } else {
        doc.likedBy.push(userId);
      }
      await doc.save();

      try {
        const likedNow = doc.likedBy.includes(userId);
        const ownerId = String(doc.userId || '');
        if (likedNow && ownerId && ownerId !== userId) {
          createNotification(req, {
            toUserId: ownerId,
            fromUserId: userId,
            type: 'like',
            title: 'New Reaction',
            message: `${userName} reacted to your post`,
            actionUrl: '/feed',
            meta: { postId: id },
          }).catch(() => {});
        }
      } catch {}

      return res.json({
        id: doc.id,
        userId: doc.userId,
        userName: doc.userName,
        avatar: doc.avatar,
        content: doc.content,
        image: doc.image || (Array.isArray(doc.images) ? (doc.images[0] || '') : ''),
        images: Array.isArray(doc.images) ? doc.images : [],
        audio: doc.audio || '',
        mode: normalizeMode(doc.mode),
        likedBy: Array.isArray(doc.likedBy) ? doc.likedBy : [],
        likes: Array.isArray(doc.likedBy) ? doc.likedBy.length : 0,
        comments: Array.isArray(doc.comments) ? doc.comments : [],
        createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : new Date().toISOString(),
      });
    }

    if (dbReady) {
      const updated = postsRepo.toggleLike(id, userId);
      if (!updated) return res.status(404).json({ error: 'Not found' });
      try {
        const likedNow = Array.isArray(updated.likedBy) && updated.likedBy.includes(userId);
        const ownerId = String(updated.userId || '');
        if (likedNow && ownerId && ownerId !== userId) {
          createNotification(req, {
            toUserId: ownerId,
            fromUserId: userId,
            type: 'like',
            title: 'New Reaction',
            message: `${userName} reacted to your post`,
            actionUrl: '/feed',
            meta: { postId: id },
          }).catch(() => {});
        }
      } catch {}
      return res.json(updated);
    }

    const p = posts.find((x) => x.id === id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    if (!Array.isArray(p.likedBy)) p.likedBy = [];
    const idx = p.likedBy.indexOf(userId);
    if (idx === -1) {
      p.likedBy.push(userId);
      try {
        const ownerId = String(p.userId || '');
        if (ownerId && ownerId !== userId) {
          createNotification(req, {
            toUserId: ownerId,
            fromUserId: userId,
            type: 'like',
            title: 'New Reaction',
            message: `${userName} reacted to your post`,
            actionUrl: '/feed',
            meta: { postId: id },
          }).catch(() => {});
        }
      } catch {}
    } else {
      p.likedBy.splice(idx, 1);
    }
    saveJSON('posts.json', posts).catch(() => {});
    return res.json({ ...p, likes: p.likedBy.length });
  })().catch(() => res.status(500).json({ error: 'server_error' }));
});

router.post('/:id/comment', requireAuth, (req, res) => {
  (async () => {
    const { id } = req.params;
    const { text } = req.body;
    const userId = getCanonicalUserId(req.user);
    const userName = String(req.user?.name || '');
    const comment = { id: `c${Date.now()}`, userId, userName, text: text || '', createdAt: new Date().toISOString() };

    if (await mongoReady()) {
      const doc = await Post.findOne({ id });
      if (!doc) return res.status(404).json({ error: 'Not found' });
      if (!Array.isArray(doc.comments)) doc.comments = [];
      doc.comments.push(comment);
      await doc.save();
      try {
        const ownerId = String(doc.userId || '');
        if (ownerId && ownerId !== userId) {
          createNotification(req, {
            toUserId: ownerId,
            fromUserId: userId,
            type: 'comment',
            title: 'New Comment',
            message: `${userName || 'Someone'} commented on your post`,
            actionUrl: '/feed',
            meta: { postId: id, commentId: comment.id },
          }).catch(() => {});
        }
      } catch {}
      return res.status(201).json(comment);
    }

    if (dbReady) {
      const c = postsRepo.addComment(id, { id: comment.id, userId, userName, text: comment.text });
      if (!c) return res.status(404).json({ error: 'Not found' });
      try {
        const p = postsRepo.get(id);
        const ownerId = String(p?.userId || '');
        if (ownerId && ownerId !== userId) {
          createNotification(req, {
            toUserId: ownerId,
            fromUserId: userId,
            type: 'comment',
            title: 'New Comment',
            message: `${userName || 'Someone'} commented on your post`,
            actionUrl: '/feed',
            meta: { postId: id, commentId: c.id },
          }).catch(() => {});
        }
      } catch {}
      return res.status(201).json(c);
    }

    const p = posts.find((x) => x.id === id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    p.comments.push(comment);
    try {
      const ownerId = String(p.userId || '');
      if (ownerId && ownerId !== userId) {
        createNotification(req, {
          toUserId: ownerId,
          fromUserId: userId,
          type: 'comment',
          title: 'New Comment',
          message: `${userName || 'Someone'} commented on your post`,
          actionUrl: '/feed',
          meta: { postId: id, commentId: comment.id },
        }).catch(() => {});
      }
    } catch {}
    saveJSON('posts.json', posts).catch(() => {});
    return res.status(201).json(comment);
  })().catch(() => res.status(500).json({ error: 'server_error' }));
});

// Edit a post (owner only)
router.patch('/:id', requireAuth, (req, res) => {
  (async () => {
    const { id } = req.params;
    const { content } = req.body;
    const userId = getCanonicalUserId(req.user);
    const nextContent = (content || '').toString();

    if (await mongoReady()) {
      const doc = await Post.findOne({ id });
      if (!doc) return res.status(404).json({ error: 'Not found' });
      if (!canEdit(doc, req.user)) return res.status(403).json({ error: 'Forbidden' });
      doc.content = nextContent || doc.content;
      await doc.save();
      return res.json({
        id: doc.id,
        userId: doc.userId,
        userName: doc.userName,
        avatar: doc.avatar,
        content: doc.content,
        image: doc.image || (Array.isArray(doc.images) ? (doc.images[0] || '') : ''),
        images: Array.isArray(doc.images) ? doc.images : [],
        audio: doc.audio || '',
        mode: normalizeMode(doc.mode),
        collabInvites: Array.isArray(doc.collabInvites) ? doc.collabInvites : [],
        collaborators: Array.isArray(doc.collaborators) ? doc.collaborators : [],
        likedBy: Array.isArray(doc.likedBy) ? doc.likedBy : [],
        likes: Array.isArray(doc.likedBy) ? doc.likedBy.length : 0,
        comments: Array.isArray(doc.comments) ? doc.comments : [],
        createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : new Date().toISOString(),
      });
    }

    if (dbReady) {
      const p = postsRepo.get(id);
      if (!p) return res.status(404).json({ error: 'Not found' });
      if (String(p.userId || '') !== String(userId) && String(p.userId || '') !== String(req.user?._id || '')) return res.status(403).json({ error: 'Forbidden' });
      // simple update without adding a new repo function
      postsRepo._db.prepare(`UPDATE posts SET content=? WHERE id=?`).run(nextContent, id);
      const updated = postsRepo.get(id);
      return res.json(updated);
    }

    const p = posts.find((x) => x.id === id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    if (String(p.userId || '') !== String(userId) && String(p.userId || '') !== String(req.user?._id || '')) return res.status(403).json({ error: 'Forbidden' });
    p.content = nextContent || p.content;
    saveJSON('posts.json', posts).catch(() => {});
    return res.json({ ...p, likes: Array.isArray(p.likedBy) ? p.likedBy.length : (p.likes || 0) });
  })().catch(() => res.status(500).json({ error: 'server_error' }));
});

// Delete a post (owner only)
router.delete('/:id', requireAuth, (req, res) => {
  (async () => {
    const { id } = req.params;
    const userId = getCanonicalUserId(req.user);

    if (await mongoReady()) {
      const doc = await Post.findOne({ id });
      if (!doc) return res.status(404).json({ error: 'Not found' });
      if (!isOwner(doc.userId, req.user)) return res.status(403).json({ error: 'Forbidden' });
      await Post.deleteOne({ id });
      return res.json({ ok: true });
    }

    if (dbReady) {
      const p = postsRepo.get(id);
      if (!p) return res.status(404).json({ error: 'Not found' });
      if (String(p.userId || '') !== String(userId) && String(p.userId || '') !== String(req.user?._id || '')) return res.status(403).json({ error: 'Forbidden' });
      postsRepo._db.prepare(`DELETE FROM posts WHERE id=?`).run(id);
      postsRepo._db.prepare(`DELETE FROM post_likes WHERE postId=?`).run(id);
      postsRepo._db.prepare(`DELETE FROM comments WHERE postId=?`).run(id);
      return res.json({ ok: true });
    }

    const idx = posts.findIndex((x) => x.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    if (String(posts[idx].userId || '') !== String(userId) && String(posts[idx].userId || '') !== String(req.user?._id || '')) return res.status(403).json({ error: 'Forbidden' });
    posts.splice(idx, 1);
    saveJSON('posts.json', posts).catch(() => {});
    return res.json({ ok: true });
  })().catch(() => res.status(500).json({ error: 'server_error' }));
});

// Edit a comment
router.patch('/:id/comment/:commentId', requireAuth, (req, res) => {
  (async () => {
    const { id, commentId } = req.params;
    const { text } = req.body;
    const userId = getCanonicalUserId(req.user);

    if (await mongoReady()) {
      const doc = await Post.findOne({ id });
      if (!doc) return res.status(404).json({ error: 'Not found' });
      const comments = Array.isArray(doc.comments) ? doc.comments : [];
      const idx = comments.findIndex((c) => String(c?.id) === String(commentId));
      if (idx === -1) return res.status(404).json({ error: 'Comment not found' });
      if (String(comments[idx].userId) !== String(userId)) return res.status(403).json({ error: 'Forbidden' });
      comments[idx].text = (text || comments[idx].text || '').toString();
      doc.comments = comments;
      await doc.save();
      return res.json(comments[idx]);
    }

    if (dbReady) {
      const c = postsRepo.editComment(commentId, text || '');
      if (!c) return res.status(404).json({ error: 'Comment not found' });
      return res.json(c);
    }

    const p = posts.find((x) => x.id === id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    const c = p.comments.find((c) => c.id === commentId);
    if (!c) return res.status(404).json({ error: 'Comment not found' });
    if (c.userId !== userId) return res.status(403).json({ error: 'Forbidden' });
    c.text = text || c.text;
    saveJSON('posts.json', posts).catch(() => {});
    return res.json(c);
  })().catch(() => res.status(500).json({ error: 'server_error' }));
});

// Delete a comment
router.delete('/:id/comment/:commentId', requireAuth, (req, res) => {
  (async () => {
    const { id, commentId } = req.params;
    const userId = getCanonicalUserId(req.user);

    if (await mongoReady()) {
      const doc = await Post.findOne({ id });
      if (!doc) return res.status(404).json({ error: 'Not found' });
      const comments = Array.isArray(doc.comments) ? doc.comments : [];
      const idx = comments.findIndex((c) => String(c?.id) === String(commentId));
      if (idx === -1) return res.status(404).json({ error: 'Comment not found' });
      if (String(comments[idx].userId) !== String(userId)) return res.status(403).json({ error: 'Forbidden' });
      const removed = comments.splice(idx, 1)[0];
      doc.comments = comments;
      await doc.save();
      return res.json(removed);
    }

    if (dbReady) {
      const removed = postsRepo.deleteComment(commentId);
      if (!removed) return res.status(404).json({ error: 'Comment not found' });
      return res.json(removed);
    }

    const p = posts.find((x) => x.id === id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    const idx = p.comments.findIndex((c) => c.id === commentId);
    if (idx === -1) return res.status(404).json({ error: 'Comment not found' });
    if (p.comments[idx].userId !== userId) return res.status(403).json({ error: 'Forbidden' });
    const removed = p.comments.splice(idx, 1)[0];
    saveJSON('posts.json', posts).catch(() => {});
    return res.json(removed);
  })().catch(() => res.status(500).json({ error: 'server_error' }));
});

export default router;
