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

function clean(value) {
  return String(value || '').trim();
}

function normalizeMode(mode) {
  return mode === 'professional' ? 'professional' : 'social';
}

function getCanonicalUserId(user) {
  return clean(user?.externalId || user?._id || user?.id || user?.supabaseId || user?.authId);
}

function toObjectIdIfValid(id) {
  const cleanId = clean(id);

  if (!/^[0-9a-fA-F]{24}$/.test(cleanId)) return null;

  try {
    return new mongoose.Types.ObjectId(cleanId);
  } catch {
    return null;
  }
}

function isVerifiedUser(user) {
  return Boolean(
    user?.addons?.verified === true ||
      user?.verified === true ||
      user?.userVerified === true ||
      user?.authorVerified === true ||
      user?.accountVerified === true ||
      user?.isVerified === true ||
      user?.is_verified === true
  );
}

async function getUserByAnyId(userId) {
  try {
    const cleanId = clean(userId);
    if (!cleanId) return null;

    const objectId = toObjectIdIfValid(cleanId);

    const user = await User.findOne({
      $or: [
        { externalId: cleanId },
        { id: cleanId },
        { supabaseId: cleanId },
        { authId: cleanId },
        ...(objectId ? [{ _id: objectId }] : []),
      ],
    })
      .select(
        '_id id externalId supabaseId authId name fullName full_name username email avatar avatarUrl avatar_url addons verified userVerified authorVerified accountVerified isVerified is_verified tier subscriptionTier'
      )
      .lean();

    return user || null;
  } catch (err) {
    console.error('User lookup failed:', err?.message || err);
    return null;
  }
}

async function getUserVerifiedStatus(userId) {
  const foundUser = await getUserByAnyId(userId);
  return isVerifiedUser(foundUser);
}

async function buildUserMapForPosts(list) {
  const userIds = Array.from(
    new Set(
      (list || [])
        .map((post) => clean(post.userId || post.user || post.authorId || post.externalId))
        .filter(Boolean)
    )
  );

  if (!userIds.length) return new Map();

  const objectIds = userIds.map(toObjectIdIfValid).filter(Boolean);

  const users = await User.find({
    $or: [
      { externalId: { $in: userIds } },
      { id: { $in: userIds } },
      { supabaseId: { $in: userIds } },
      { authId: { $in: userIds } },
      ...(objectIds.length ? [{ _id: { $in: objectIds } }] : []),
    ],
  })
    .select(
      '_id id externalId supabaseId authId name fullName full_name username email avatar avatarUrl avatar_url addons verified userVerified authorVerified accountVerified isVerified is_verified tier subscriptionTier'
    )
    .lean();

  const map = new Map();

  for (const user of users || []) {
    const keys = [
      user?._id,
      user?.id,
      user?.externalId,
      user?.supabaseId,
      user?.authId,
    ]
      .map((x) => clean(x))
      .filter(Boolean);

    keys.forEach((key) => map.set(key, user));
  }

  return map;
}

function getUserDisplayName(user, fallback = '') {
  return (
    clean(user?.name) ||
    clean(user?.fullName) ||
    clean(user?.full_name) ||
    clean(user?.username) ||
    clean(user?.email).split('@')[0] ||
    clean(fallback) ||
    'FaceMeX Member'
  );
}

function getUserAvatar(user, fallback = '') {
  return (
    clean(user?.avatar) ||
    clean(user?.avatarUrl) ||
    clean(user?.avatar_url) ||
    clean(fallback)
  );
}

function normalizeComment(comment = {}) {
  const created =
    comment.timestamp ||
    comment.createdAt ||
    comment.created_at ||
    new Date().toISOString();

  const content = clean(comment.content || comment.text || '');

  return {
    id: clean(comment.id) || `c${Date.now()}`,
    userId: clean(comment.userId),
    userName: clean(comment.userName) || 'FaceMeX Member',
    userAvatar: clean(comment.userAvatar || comment.avatar),
    avatar: clean(comment.userAvatar || comment.avatar),
    content,
    text: content,
    type: comment.type || (comment.voiceUrl ? 'voice' : 'text'),
    voiceUrl: clean(comment.voiceUrl || comment.voice_url),
    createdAt: new Date(created).toISOString(),
    timestamp: new Date(created).toISOString(),
  };
}

function shapePost(rawPost, author = null) {
  const p = typeof rawPost?.toObject === 'function' ? rawPost.toObject() : rawPost || {};

  const authorVerified =
    isVerifiedUser(author) ||
    p?.verified === true ||
    p?.userVerified === true ||
    p?.authorVerified === true ||
    p?.accountVerified === true ||
    p?.isVerified === true ||
    p?.is_verified === true;

  const userName = getUserDisplayName(author, p.userName);
  const avatar = getUserAvatar(author, p.userAvatar || p.avatar);

  const images = Array.isArray(p.images) ? p.images.filter(Boolean) : [];
  const firstImage = clean(p.image) || images[0] || '';

  const likedBy = Array.isArray(p.likedBy) ? p.likedBy.map(String) : [];
  const comments = Array.isArray(p.comments) ? p.comments.map(normalizeComment) : [];

  const createdAt = p.createdAt
    ? new Date(p.createdAt).toISOString()
    : p.timestamp
      ? new Date(p.timestamp).toISOString()
      : new Date().toISOString();

  return {
    id: clean(p.id || p._id || `p${Date.now()}`),
    _id: p._id,
    userId: clean(p.userId || p.user || p.authorId),
    userName,
    avatar,
    userAvatar: avatar,

    verified: authorVerified,
    userVerified: authorVerified,
    authorVerified,
    accountVerified: authorVerified,
    isVerified: authorVerified,

    content: clean(p.content),
    image: firstImage,
    images,
    audio: clean(p.audio),
    video: clean(p.video || p.videoUrl),
    videoUrl: clean(p.videoUrl || p.video),

    documents: Array.isArray(p.documents) ? p.documents : [],
    documentUrl: clean(p.documentUrl || p.document_url),
    documentPages: Array.isArray(p.documentPages)
      ? p.documentPages
      : Array.isArray(p.document_pages)
        ? p.document_pages
        : [],

    mode: normalizeMode(p.mode),
    collabInvites: Array.isArray(p.collabInvites) ? p.collabInvites.map(String) : [],
    collaborators: Array.isArray(p.collaborators) ? p.collaborators.map(String) : [],

    likedBy,
    likes: likedBy.length,
    shares: Number(p.shares || 0),

    comments,
    createdAt,
    timestamp: createdAt,
  };
}

function isOwner(postUserId, user) {
  const postOwnerId = clean(postUserId);
  if (!postOwnerId) return false;

  const canonical = getCanonicalUserId(user);
  const mongoId = clean(user?._id);
  const supabaseId = clean(user?.id);
  const externalId = clean(user?.externalId);

  return Boolean(
    (canonical && postOwnerId === canonical) ||
      (mongoId && postOwnerId === mongoId) ||
      (supabaseId && postOwnerId === supabaseId) ||
      (externalId && postOwnerId === externalId)
  );
}

function isCollaborator(post, user) {
  const canonical = getCanonicalUserId(user);
  if (!canonical) return false;

  const collaborators = Array.isArray(post?.collaborators) ? post.collaborators : [];

  return collaborators.map(String).includes(String(canonical));
}

function canEdit(post, user) {
  return isOwner(post?.userId, user) || isCollaborator(post, user);
}

router.get('/', (req, res) => {
  (async () => {
    const mode =
      req.query.mode === 'professional'
        ? 'professional'
        : req.query.mode === 'social'
          ? 'social'
          : null;

    const skillRaw = clean(req.query.skill);
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

      const userMap = await buildUserMapForPosts(list);

      const shaped = (list || []).map((post) => {
        const author = userMap.get(clean(post.userId));
        return shapePost(post, author);
      });

      let filtered = mode ? shaped.filter((post) => post.mode === mode) : shaped;

      if (skill) {
        filtered = filtered.filter(
          (post) => post.mode === 'professional' && matchesSkill(post.content)
        );
      }

      return res.json(filtered);
    }

    if (dbReady) {
      const list = postsRepo.list();

      const normalized = list.map((post) => ({
        ...shapePost(post),
        mode: normalizeMode(post.mode),
      }));

      let filtered = mode
        ? normalized.filter((post) => post.mode === mode)
        : normalized;

      if (skill) {
        filtered = filtered.filter(
          (post) => post.mode === 'professional' && matchesSkill(post.content)
        );
      }

      return res.json(filtered);
    }

    const shaped = posts.map((post) => shapePost(post));

    let filtered = mode ? shaped.filter((post) => post.mode === mode) : shaped;

    if (skill) {
      filtered = filtered.filter(
        (post) => post.mode === 'professional' && matchesSkill(post.content)
      );
    }

    return res.json(filtered);
  })().catch((err) => {
    console.error('Get posts error:', err?.message || err);
    res.status(500).json({ error: 'server_error' });
  });
});

router.post('/', requireAuth, (req, res) => {
  (async () => {
    const {
      content = '',
      image = '',
      images = [],
      audio = '',
      video = '',
      videoUrl = '',
      mode = 'social',
      documents = [],
      documentUrl = '',
      documentPages = [],
    } = req.body || {};

    const safeImages = Array.isArray(images) ? images.filter(Boolean).slice(0, 5) : [];
    const firstImage = safeImages[0] || image || '';
    const id = `p${Date.now()}`;

    const currentUserId = getCanonicalUserId(req.user);
    const fullUser = await getUserByAnyId(currentUserId);

    const currentUserName = getUserDisplayName(fullUser || req.user, req.user?.name);
    const currentUserAvatar = getUserAvatar(fullUser || req.user, req.user?.avatar);
    const currentUserVerified = isVerifiedUser(fullUser) || isVerifiedUser(req.user);

    if (await mongoReady()) {
      const created = await Post.create({
        id,
        userId: currentUserId,
        userName: currentUserName,
        avatar: currentUserAvatar,
        userAvatar: currentUserAvatar,

        verified: currentUserVerified,
        userVerified: currentUserVerified,
        authorVerified: currentUserVerified,
        accountVerified: currentUserVerified,
        isVerified: currentUserVerified,

        content: clean(content),
        image: firstImage || '',
        images: safeImages,
        audio: audio || '',
        video: video || videoUrl || '',
        videoUrl: videoUrl || video || '',
        documents: Array.isArray(documents) ? documents : [],
        documentUrl: documentUrl || '',
        documentPages: Array.isArray(documentPages) ? documentPages : [],

        mode: normalizeMode(mode),
        collabInvites: [],
        collaborators: [],
        likedBy: [],
        likes: 0,
        shares: 0,
        comments: [],
      });

      return res.status(201).json(shapePost(created, fullUser));
    }

    if (dbReady) {
      const created = postsRepo.create({
        id,
        userId: currentUserId,
        userName: currentUserName,
        avatar: currentUserAvatar,
        userAvatar: currentUserAvatar,
        verified: currentUserVerified,
        userVerified: currentUserVerified,
        authorVerified: currentUserVerified,
        accountVerified: currentUserVerified,
        content: clean(content),
        image: firstImage || '',
        images: safeImages,
        audio: audio || '',
        mode: normalizeMode(mode),
      });

      return res.status(201).json(shapePost(created));
    }

    const post = {
      id,
      userId: currentUserId,
      userName: currentUserName,
      avatar: currentUserAvatar,
      userAvatar: currentUserAvatar,
      verified: currentUserVerified,
      userVerified: currentUserVerified,
      authorVerified: currentUserVerified,
      accountVerified: currentUserVerified,
      content: clean(content),
      image: firstImage || '',
      images: safeImages,
      audio: audio || '',
      video: video || videoUrl || '',
      videoUrl: videoUrl || video || '',
      documents: Array.isArray(documents) ? documents : [],
      documentUrl: documentUrl || '',
      documentPages: Array.isArray(documentPages) ? documentPages : [],
      likedBy: [],
      likes: 0,
      shares: 0,
      comments: [],
      createdAt: new Date().toISOString(),
      mode: normalizeMode(mode),
    };

    posts.unshift(post);
    saveJSON('posts.json', posts).catch(() => {});

    return res.status(201).json(shapePost(post));
  })().catch((err) => {
    console.error('Create post error:', err?.message || err);
    res.status(500).json({ error: 'server_error' });
  });
});

router.post('/:id/like', requireAuth, (req, res) => {
  (async () => {
    const { id } = req.params;
    const userId = getCanonicalUserId(req.user);
    const userName = clean(req.user?.name) || 'Someone';

    if (await mongoReady()) {
      const doc = await Post.findOne({ id });
      if (!doc) return res.status(404).json({ error: 'Not found' });

      if (!Array.isArray(doc.likedBy)) doc.likedBy = [];

      const alreadyLiked = doc.likedBy.map(String).includes(String(userId));

      if (alreadyLiked) {
        doc.likedBy = doc.likedBy.filter((x) => String(x) !== String(userId));
      } else {
        doc.likedBy.push(userId);
      }

      await doc.save();

      try {
        const likedNow = doc.likedBy.map(String).includes(String(userId));
        const ownerId = clean(doc.userId);

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

      const author = await getUserByAnyId(doc.userId);
      return res.json(shapePost(doc, author));
    }

    if (dbReady) {
      const updated = postsRepo.toggleLike(id, userId);
      if (!updated) return res.status(404).json({ error: 'Not found' });
      return res.json(shapePost(updated));
    }

    const p = posts.find((x) => x.id === id);
    if (!p) return res.status(404).json({ error: 'Not found' });

    if (!Array.isArray(p.likedBy)) p.likedBy = [];

    const idx = p.likedBy.indexOf(userId);

    if (idx === -1) {
      p.likedBy.push(userId);
    } else {
      p.likedBy.splice(idx, 1);
    }

    saveJSON('posts.json', posts).catch(() => {});

    return res.json(shapePost(p));
  })().catch((err) => {
    console.error('Like post error:', err?.message || err);
    res.status(500).json({ error: 'server_error' });
  });
});

router.post('/:id/share', requireAuth, (req, res) => {
  (async () => {
    const { id } = req.params;
    const userId = getCanonicalUserId(req.user);

    if (await mongoReady()) {
      const doc = await Post.findOne({ id });
      if (!doc) return res.status(404).json({ error: 'Not found' });

      doc.shares = Number(doc.shares || 0) + 1;
      await doc.save();

      try {
        const ownerId = clean(doc.userId);

        if (ownerId && ownerId !== userId) {
          createNotification(req, {
            toUserId: ownerId,
            fromUserId: userId,
            type: 'share',
            title: 'Post Shared',
            message: `${clean(req.user?.name) || 'Someone'} shared your post`,
            actionUrl: '/feed',
            meta: { postId: id },
          }).catch(() => {});
        }
      } catch {}

      const author = await getUserByAnyId(doc.userId);
      return res.json(shapePost(doc, author));
    }

    const p = posts.find((x) => x.id === id);
    if (!p) return res.status(404).json({ error: 'Not found' });

    p.shares = Number(p.shares || 0) + 1;
    saveJSON('posts.json', posts).catch(() => {});

    return res.json(shapePost(p));
  })().catch((err) => {
    console.error('Share post error:', err?.message || err);
    res.status(500).json({ error: 'server_error' });
  });
});

router.post('/:id/comment', requireAuth, (req, res) => {
  (async () => {
    const { id } = req.params;
    const text = clean(req.body?.text || req.body?.content);
    const voiceUrl = clean(req.body?.voiceUrl || req.body?.voice_url);
    const type = voiceUrl ? 'voice' : 'text';

    const userId = getCanonicalUserId(req.user);
    const fullUser = await getUserByAnyId(userId);

    const comment = normalizeComment({
      id: `c${Date.now()}`,
      userId,
      userName: getUserDisplayName(fullUser || req.user, req.user?.name),
      userAvatar: getUserAvatar(fullUser || req.user, req.user?.avatar),
      content: text,
      text,
      type,
      voiceUrl,
      createdAt: new Date().toISOString(),
      timestamp: new Date().toISOString(),
    });

    if (await mongoReady()) {
      const doc = await Post.findOne({ id });
      if (!doc) return res.status(404).json({ error: 'Not found' });

      if (!Array.isArray(doc.comments)) doc.comments = [];

      doc.comments.push(comment);
      await doc.save();

      try {
        const ownerId = clean(doc.userId);

        if (ownerId && ownerId !== userId) {
          createNotification(req, {
            toUserId: ownerId,
            fromUserId: userId,
            type: type === 'voice' ? 'voice_comment' : 'comment',
            title: type === 'voice' ? 'New Voice Reply' : 'New Comment',
            message: `${comment.userName || 'Someone'} replied to your post`,
            actionUrl: '/feed',
            meta: { postId: id, commentId: comment.id },
          }).catch(() => {});
        }
      } catch {}

      return res.status(201).json(comment);
    }

    if (dbReady) {
      const c = postsRepo.addComment(id, {
        id: comment.id,
        userId,
        userName: comment.userName,
        text: comment.content,
      });

      if (!c) return res.status(404).json({ error: 'Not found' });

      return res.status(201).json(normalizeComment(c));
    }

    const p = posts.find((x) => x.id === id);
    if (!p) return res.status(404).json({ error: 'Not found' });

    if (!Array.isArray(p.comments)) p.comments = [];

    p.comments.push(comment);

    saveJSON('posts.json', posts).catch(() => {});

    return res.status(201).json(comment);
  })().catch((err) => {
    console.error('Comment error:', err?.message || err);
    res.status(500).json({ error: 'server_error' });
  });
});

router.post('/:id/voice-comment', requireAuth, (req, res) => {
  req.body = {
    ...(req.body || {}),
    voiceUrl: req.body?.voiceUrl || req.body?.audio || req.body?.url,
  };

  return router.handle(
    {
      ...req,
      method: 'POST',
      url: `/${req.params.id}/comment`,
      originalUrl: req.originalUrl,
    },
    res
  );
});

router.patch('/:id', requireAuth, (req, res) => {
  (async () => {
    const { id } = req.params;
    const nextContent = clean(req.body?.content);

    if (await mongoReady()) {
      const doc = await Post.findOne({ id });
      if (!doc) return res.status(404).json({ error: 'Not found' });

      if (!canEdit(doc, req.user)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      doc.content = nextContent || doc.content;
      await doc.save();

      const author = await getUserByAnyId(doc.userId);
      return res.json(shapePost(doc, author));
    }

    if (dbReady) {
      const p = postsRepo.get(id);

      if (!p) return res.status(404).json({ error: 'Not found' });

      if (!isOwner(p.userId, req.user)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      postsRepo._db.prepare(`UPDATE posts SET content=? WHERE id=?`).run(nextContent, id);

      const updated = postsRepo.get(id);

      return res.json(shapePost(updated));
    }

    const p = posts.find((x) => x.id === id);

    if (!p) return res.status(404).json({ error: 'Not found' });

    if (!isOwner(p.userId, req.user)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    p.content = nextContent || p.content;

    saveJSON('posts.json', posts).catch(() => {});

    return res.json(shapePost(p));
  })().catch((err) => {
    console.error('Edit post error:', err?.message || err);
    res.status(500).json({ error: 'server_error' });
  });
});

router.delete('/:id', requireAuth, (req, res) => {
  (async () => {
    const { id } = req.params;

    if (await mongoReady()) {
      const doc = await Post.findOne({ id });

      if (!doc) return res.status(404).json({ error: 'Not found' });

      if (!isOwner(doc.userId, req.user)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      await Post.deleteOne({ id });

      return res.json({ ok: true });
    }

    if (dbReady) {
      const p = postsRepo.get(id);

      if (!p) return res.status(404).json({ error: 'Not found' });

      if (!isOwner(p.userId, req.user)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      postsRepo._db.prepare(`DELETE FROM posts WHERE id=?`).run(id);
      postsRepo._db.prepare(`DELETE FROM post_likes WHERE postId=?`).run(id);
      postsRepo._db.prepare(`DELETE FROM comments WHERE postId=?`).run(id);

      return res.json({ ok: true });
    }

    const idx = posts.findIndex((x) => x.id === id);

    if (idx === -1) return res.status(404).json({ error: 'Not found' });

    if (!isOwner(posts[idx].userId, req.user)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    posts.splice(idx, 1);
    saveJSON('posts.json', posts).catch(() => {});

    return res.json({ ok: true });
  })().catch((err) => {
    console.error('Delete post error:', err?.message || err);
    res.status(500).json({ error: 'server_error' });
  });
});

router.post('/:id/collab/invite', requireAuth, (req, res) => {
  (async () => {
    const { id } = req.params;
    const inviteeIdRaw = clean(req.body?.userId);

    if (!inviteeIdRaw) {
      return res.status(400).json({ error: 'userId_required' });
    }

    const inviterId = getCanonicalUserId(req.user);

    if (!(await mongoReady())) {
      return res.status(501).json({ error: 'not_supported' });
    }

    const doc = await Post.findOne({ id });

    if (!doc) return res.status(404).json({ error: 'Not found' });

    if (!isOwner(doc.userId, req.user)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (String(inviteeIdRaw) === String(inviterId)) {
      return res.status(400).json({ error: 'cannot_invite_self' });
    }

    const invites = Array.isArray(doc.collabInvites) ? doc.collabInvites.map(String) : [];
    const collaborators = Array.isArray(doc.collaborators) ? doc.collaborators.map(String) : [];

    if (collaborators.includes(String(inviteeIdRaw))) {
      return res.json({ ok: true, status: 'already_collaborator' });
    }

    if (!invites.includes(String(inviteeIdRaw))) {
      invites.push(String(inviteeIdRaw));
    }

    doc.collabInvites = invites;
    await doc.save();

    try {
      createNotification(req, {
        toUserId: String(inviteeIdRaw),
        fromUserId: String(inviterId),
        type: 'collab_invite',
        title: 'Collaboration Invite',
        message: `${clean(req.user?.name) || 'Someone'} invited you to collaborate on a post`,
        actionUrl: '/feed',
        meta: { postId: id },
      }).catch(() => {});
    } catch {}

    return res.json({
      ok: true,
      collabInvites: doc.collabInvites,
      collaborators: doc.collaborators,
    });
  })().catch((err) => {
    console.error('Collab invite error:', err?.message || err);
    res.status(500).json({ error: 'server_error' });
  });
});

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

    if (!invites.includes(String(userId))) {
      return res.status(403).json({ error: 'No invite' });
    }

    const nextInvites = invites.filter((x) => x !== String(userId));
    const collaborators = Array.isArray(doc.collaborators) ? doc.collaborators.map(String) : [];

    if (!collaborators.includes(String(userId))) {
      collaborators.push(String(userId));
    }

    doc.collabInvites = nextInvites;
    doc.collaborators = collaborators;

    await doc.save();

    try {
      createNotification(req, {
        toUserId: String(doc.userId),
        fromUserId: String(userId),
        type: 'collab_accept',
        title: 'Collaboration Accepted',
        message: `${clean(req.user?.name) || 'Someone'} accepted your collaboration invite`,
        actionUrl: '/feed',
        meta: { postId: id },
      }).catch(() => {});
    } catch {}

    return res.json({
      ok: true,
      collabInvites: doc.collabInvites,
      collaborators: doc.collaborators,
    });
  })().catch((err) => {
    console.error('Collab accept error:', err?.message || err);
    res.status(500).json({ error: 'server_error' });
  });
});

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

    if (!invites.includes(String(userId))) {
      return res.status(403).json({ error: 'No invite' });
    }

    doc.collabInvites = invites.filter((x) => x !== String(userId));

    await doc.save();

    return res.json({
      ok: true,
      collabInvites: doc.collabInvites,
      collaborators: doc.collaborators,
    });
  })().catch((err) => {
    console.error('Collab reject error:', err?.message || err);
    res.status(500).json({ error: 'server_error' });
  });
});

router.patch('/:id/comment/:commentId', requireAuth, (req, res) => {
  (async () => {
    const { id, commentId } = req.params;
    const text = clean(req.body?.text || req.body?.content);

    const userId = getCanonicalUserId(req.user);

    if (await mongoReady()) {
      const doc = await Post.findOne({ id });
      if (!doc) return res.status(404).json({ error: 'Not found' });

      const comments = Array.isArray(doc.comments) ? doc.comments : [];
      const idx = comments.findIndex((comment) => String(comment?.id) === String(commentId));

      if (idx === -1) {
        return res.status(404).json({ error: 'Comment not found' });
      }

      if (String(comments[idx].userId) !== String(userId)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      comments[idx].content = text || comments[idx].content || comments[idx].text || '';
      comments[idx].text = comments[idx].content;
      doc.comments = comments;

      await doc.save();

      return res.json(normalizeComment(comments[idx]));
    }

    if (dbReady) {
      const c = postsRepo.editComment(commentId, text || '');

      if (!c) {
        return res.status(404).json({ error: 'Comment not found' });
      }

      return res.json(normalizeComment(c));
    }

    const p = posts.find((x) => x.id === id);

    if (!p) return res.status(404).json({ error: 'Not found' });

    const c = p.comments.find((comment) => comment.id === commentId);

    if (!c) return res.status(404).json({ error: 'Comment not found' });

    if (String(c.userId) !== String(userId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    c.content = text || c.content || c.text || '';
    c.text = c.content;

    saveJSON('posts.json', posts).catch(() => {});

    return res.json(normalizeComment(c));
  })().catch((err) => {
    console.error('Edit comment error:', err?.message || err);
    res.status(500).json({ error: 'server_error' });
  });
});

router.delete('/:id/comment/:commentId', requireAuth, (req, res) => {
  (async () => {
    const { id, commentId } = req.params;
    const userId = getCanonicalUserId(req.user);

    if (await mongoReady()) {
      const doc = await Post.findOne({ id });
      if (!doc) return res.status(404).json({ error: 'Not found' });

      const comments = Array.isArray(doc.comments) ? doc.comments : [];
      const idx = comments.findIndex((comment) => String(comment?.id) === String(commentId));

      if (idx === -1) {
        return res.status(404).json({ error: 'Comment not found' });
      }

      if (String(comments[idx].userId) !== String(userId) && !isOwner(doc.userId, req.user)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const removed = comments.splice(idx, 1)[0];
      doc.comments = comments;

      await doc.save();

      return res.json(normalizeComment(removed));
    }

    if (dbReady) {
      const removed = postsRepo.deleteComment(commentId);

      if (!removed) {
        return res.status(404).json({ error: 'Comment not found' });
      }

      return res.json(normalizeComment(removed));
    }

    const p = posts.find((x) => x.id === id);

    if (!p) return res.status(404).json({ error: 'Not found' });

    const idx = p.comments.findIndex((comment) => comment.id === commentId);

    if (idx === -1) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    if (String(p.comments[idx].userId) !== String(userId) && !isOwner(p.userId, req.user)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const removed = p.comments.splice(idx, 1)[0];

    saveJSON('posts.json', posts).catch(() => {});

    return res.json(normalizeComment(removed));
  })().catch((err) => {
    console.error('Delete comment error:', err?.message || err);
    res.status(500).json({ error: 'server_error' });
  });
});

export default router;
