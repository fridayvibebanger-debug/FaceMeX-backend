import { Router } from 'express';
import { loadJSON, saveJSON } from '../utils/jsonStore.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const tierOrder = {
  free: 0,
  pro: 1,
  creator: 2,
  business: 3,
  exclusive: 4,
};

function hasTier(user, minTier) {
  const t = user?.tier || 'free';
  return (tierOrder[t] ?? 0) >= (tierOrder[minTier] ?? 0);
}

function getCurrentUserId(req) {
  return String(req.user?._id || req.user?.id || req.headers['x-user-id'] || '1');
}

function getCurrentUserName(req) {
  return String(req.user?.name || req.user?.fullName || req.headers['x-user-name'] || 'FaceMe User');
}

function getCurrentUserTier(req) {
  return String(req.user?.tier || req.headers['x-user-tier'] || 'free');
}

function toStr(v) {
  return v == null ? '' : String(v);
}

function sanitizeAttachments(input) {
  const list = Array.isArray(input) ? input : [];
  return list
    .map((f) => ({
      name: toStr(f?.name).slice(0, 160),
      type: toStr(f?.type).slice(0, 80),
      dataUrl: toStr(f?.dataUrl),
    }))
    .filter((f) => f.name && f.type && f.dataUrl && (f.type.startsWith('image/') || f.type.startsWith('video/')));
}

function sanitizeVoiceNote(input) {
  const v = input || {};
  const type = toStr(v?.type).slice(0, 80);
  const dataUrl = toStr(v?.dataUrl);
  const durationMs = Number(v?.durationMs || 0) || 0;
  if (!type || !dataUrl) return null;
  if (!type.startsWith('audio/')) return null;
  return {
    type,
    dataUrl,
    durationMs: Math.max(0, Math.min(durationMs, 10 * 60 * 1000)),
  };
}

function isAdmin(group, userId) {
  const admins = Array.isArray(group?.adminIds) ? group.adminIds : [];
  return admins.includes(userId);
}

let state = {
  groups: [],
  memberships: {},
  posts: {},
};

state = (await loadJSON('proGroups.json', state)) || state;

function snapshotForUser(userId) {
  return state.groups.map((g) => {
    const members = Array.isArray(state.memberships[g.id]) ? state.memberships[g.id] : [];
    return {
      ...g,
      memberCount: members.length,
      joined: members.includes(userId),
    };
  });
}

router.get('/', (req, res) => {
  const userId = getCurrentUserId(req);
  return res.json(snapshotForUser(userId));
});

router.post('/', requireAuth, async (req, res) => {
  const userId = getCurrentUserId(req);
  const tier = getCurrentUserTier(req);
  if (!hasTier({ tier }, 'creator')) {
    return res.status(403).json({ error: 'tier_required', required: 'creator' });
  }

  const body = req.body || {};
  const name = String(body.name || '').trim();
  const industry = String(body.industry || '').trim();
  const description = String(body.description || '').trim();

  if (!name || !industry) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  const id = `pg${Date.now()}`;
  const group = {
    id,
    name,
    industry,
    description,
    createdAt: new Date().toISOString(),
    ownerId: userId,
    adminIds: [userId],
  };

  state.groups.unshift(group);
  if (!Array.isArray(state.memberships[id])) state.memberships[id] = [];
  if (!state.memberships[id].includes(userId)) state.memberships[id].push(userId);
  if (!Array.isArray(state.posts[id])) state.posts[id] = [];

  await saveJSON('proGroups.json', state).catch(() => {});

  return res.status(201).json({
    ...group,
    memberCount: (state.memberships[id] || []).length,
    joined: true,
    isAdmin: true,
  });
});

router.get('/:groupId', (req, res) => {
  const userId = getCurrentUserId(req);
  const { groupId } = req.params;
  const group = state.groups.find((g) => g.id === groupId);
  if (!group) return res.status(404).json({ error: 'group_not_found' });

  const members = Array.isArray(state.memberships[groupId]) ? state.memberships[groupId] : [];
  const posts = Array.isArray(state.posts[groupId]) ? state.posts[groupId] : [];

  return res.json({
    group: {
      ...group,
      memberCount: members.length,
      joined: members.includes(userId),
      isAdmin: isAdmin(group, userId),
    },
    posts,
  });
});

router.post('/:groupId/join', async (req, res) => {
  const userId = getCurrentUserId(req);
  const { groupId } = req.params;
  const group = state.groups.find((g) => g.id === groupId);
  if (!group) return res.status(404).json({ error: 'group_not_found' });

  if (!Array.isArray(state.memberships[groupId])) state.memberships[groupId] = [];
  if (!state.memberships[groupId].includes(userId)) state.memberships[groupId].push(userId);

  await saveJSON('proGroups.json', state).catch(() => {});

  return res.json({ ok: true });
});

router.post('/:groupId/leave', async (req, res) => {
  const userId = getCurrentUserId(req);
  const { groupId } = req.params;
  const group = state.groups.find((g) => g.id === groupId);
  if (!group) return res.status(404).json({ error: 'group_not_found' });

  const list = Array.isArray(state.memberships[groupId]) ? state.memberships[groupId] : [];
  state.memberships[groupId] = list.filter((id) => id !== userId);

  await saveJSON('proGroups.json', state).catch(() => {});

  return res.json({ ok: true });
});

router.post('/:groupId/posts', async (req, res) => {
  const userId = getCurrentUserId(req);
  const tier = getCurrentUserTier(req);
  const { groupId } = req.params;
  const group = state.groups.find((g) => g.id === groupId);
  if (!group) return res.status(404).json({ error: 'group_not_found' });

  const members = Array.isArray(state.memberships[groupId]) ? state.memberships[groupId] : [];
  if (!members.includes(userId)) return res.status(403).json({ error: 'membership_required' });

  const body = req.body || {};
  const content = String(body.content || '').trim();
  const announcement = !!body.announcement;
  const attachments = sanitizeAttachments(body.attachments);

  if (!content && attachments.length === 0) return res.status(400).json({ error: 'missing_fields' });

  if (announcement) {
    if (!isAdmin(group, userId)) return res.status(403).json({ error: 'admin_required' });
    if (!hasTier({ tier }, 'creator')) return res.status(403).json({ error: 'tier_required', required: 'creator' });
  }

  const post = {
    id: `pgp${Date.now()}`,
    groupId,
    authorId: userId,
    authorName: getCurrentUserName(req),
    content,
    attachments,
    createdAt: new Date().toISOString(),
    announcement,
    pinned: false,
    likeUserIds: [],
    comments: [],
  };

  if (!Array.isArray(state.posts[groupId])) state.posts[groupId] = [];
  state.posts[groupId].unshift(post);

  await saveJSON('proGroups.json', state).catch(() => {});
  return res.status(201).json(post);
});

router.post('/:groupId/posts/:postId/like', async (req, res) => {
  const userId = getCurrentUserId(req);
  const { groupId, postId } = req.params;
  const group = state.groups.find((g) => g.id === groupId);
  if (!group) return res.status(404).json({ error: 'group_not_found' });

  const members = Array.isArray(state.memberships[groupId]) ? state.memberships[groupId] : [];
  if (!members.includes(userId)) return res.status(403).json({ error: 'membership_required' });

  const posts = Array.isArray(state.posts[groupId]) ? state.posts[groupId] : [];
  const post = posts.find((p) => p.id === postId);
  if (!post) return res.status(404).json({ error: 'post_not_found' });

  const list = Array.isArray(post.likeUserIds) ? post.likeUserIds : [];
  const has = list.includes(userId);
  post.likeUserIds = has ? list.filter((id) => id !== userId) : [userId, ...list];

  await saveJSON('proGroups.json', state).catch(() => {});
  return res.json({ ok: true, liked: !has, likeCount: post.likeUserIds.length });
});

router.post('/:groupId/posts/:postId/comments', async (req, res) => {
  const userId = getCurrentUserId(req);
  const tier = getCurrentUserTier(req);
  const { groupId, postId } = req.params;
  const group = state.groups.find((g) => g.id === groupId);
  if (!group) return res.status(404).json({ error: 'group_not_found' });

  const members = Array.isArray(state.memberships[groupId]) ? state.memberships[groupId] : [];
  if (!members.includes(userId)) return res.status(403).json({ error: 'membership_required' });

  const posts = Array.isArray(state.posts[groupId]) ? state.posts[groupId] : [];
  const post = posts.find((p) => p.id === postId);
  if (!post) return res.status(404).json({ error: 'post_not_found' });

  if (!hasTier({ tier }, 'creator')) {
    return res.status(403).json({ error: 'tier_required', required: 'creator' });
  }

  const body = req.body || {};
  const voiceNote = sanitizeVoiceNote(body.voiceNote);
  if (!voiceNote) return res.status(400).json({ error: 'voice_note_required' });

  const comment = {
    id: `pgc${Date.now()}`,
    authorId: userId,
    authorName: getCurrentUserName(req),
    voiceNote,
    createdAt: new Date().toISOString(),
  };

  if (!Array.isArray(post.comments)) post.comments = [];
  post.comments.push(comment);

  await saveJSON('proGroups.json', state).catch(() => {});
  return res.status(201).json(comment);
});

router.patch('/:groupId/posts/:postId/pin', async (req, res) => {
  const userId = getCurrentUserId(req);
  const tier = getCurrentUserTier(req);
  const { groupId, postId } = req.params;
  const group = state.groups.find((g) => g.id === groupId);
  if (!group) return res.status(404).json({ error: 'group_not_found' });

  if (!isAdmin(group, userId)) return res.status(403).json({ error: 'admin_required' });
  if (!hasTier({ tier }, 'creator')) return res.status(403).json({ error: 'tier_required', required: 'creator' });

  const posts = Array.isArray(state.posts[groupId]) ? state.posts[groupId] : [];
  const post = posts.find((p) => p.id === postId);
  if (!post) return res.status(404).json({ error: 'post_not_found' });

  const nextPinned = !!(req.body || {}).pinned;
  for (const p of posts) {
    if (p.id === postId) {
      p.pinned = nextPinned;
    } else if (nextPinned) {
      p.pinned = false;
    }
  }

  await saveJSON('proGroups.json', state).catch(() => {});
  return res.json({ ok: true });
});

export default router;
