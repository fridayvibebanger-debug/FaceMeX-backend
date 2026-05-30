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
  return clean(
    user?.externalId ||
      user?.supabaseId ||
      user?.authId ||
      user?.id ||
      user?._id
  );
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
      user?.is_verified === true ||
      user?.profileVerified === true ||
      user?.subscriptionVerified === true
  );
}

function getSafeDate(value) {
  const raw = value || new Date().toISOString();
  const date = raw instanceof Date ? raw : new Date(String(raw));

  if (Number.isNaN(date.getTime())) return new Date();

  return date;
}

function getSafeIsoDate(value) {
  return getSafeDate(value).toISOString();
}

function extractHashtags(content = '') {
  const matches = String(content).match(/#[a-zA-Z0-9_]+/g) || [];
  return Array.from(new Set(matches)).slice(0, 10);
}

function getUserPublicId(user) {
  return clean(
    user?.externalId ||
      user?.supabaseId ||
      user?.authId ||
      user?.id ||
      user?._id
  );
}

function getUserDisplayName(user, fallback = '') {
  const emailName = clean(user?.email).includes('@')
    ? clean(user?.email).split('@')[0]
    : '';

  return (
    clean(user?.name) ||
    clean(user?.fullName) ||
    clean(user?.full_name) ||
    clean(user?.username) ||
    emailName ||
    clean(fallback) ||
    'FaceMeX Member'
  );
}

function getUserAvatar(user, fallback = '') {
  return (
    clean(user?.avatar) ||
    clean(user?.avatarUrl) ||
    clean(user?.avatar_url) ||
    clean(user?.profileImage) ||
    clean(user?.profile_image) ||
    clean(fallback)
  );
}

function getCollabCodeFromUser(user) {
  const name = getUserDisplayName(user, 'User')
    .replace(/\s+/g, '')
    .replace(/[^a-zA-Z0-9]/g, '');

  const id = getUserPublicId(user).replace(/[^a-zA-Z0-9]/g, '');
  const last4 = id.slice(-4) || '0000';

  return `${name || 'User'}${last4}`;
}

function makeUserProfile(user, fallbackId = '', fallbackName = '') {
  const id = getUserPublicId(user) || clean(fallbackId);
  const name = getUserDisplayName(user, fallbackName);

  return {
    id,
    userId: id,
    name,
    userName: name,
    avatar: getUserAvatar(user),
    userAvatar: getUserAvatar(user),
    verified: isVerifiedUser(user),
    userVerified: isVerifiedUser(user),
    isVerified: isVerifiedUser(user),
    code: getCollabCodeFromUser(user),
  };
}

async function getUserByAnyId(userIdOrCode) {
  try {
    const value = clean(userIdOrCode);
    if (!value) return null;

    const objectId = toObjectIdIfValid(value);

    const directUser = await User.findOne({
      $or: [
        { externalId: value },
        { id: value },
        { supabaseId: value },
        { authId: value },
        { username: value },
        { email: value },
        ...(objectId ? [{ _id: objectId }] : []),
      ],
    })
      .select(
        '_id id externalId supabaseId authId name fullName full_name username email avatar avatarUrl avatar_url profileImage profile_image addons verified userVerified authorVerified accountVerified isVerified is_verified profileVerified subscriptionVerified tier subscriptionTier'
      )
      .lean();

    if (directUser) return directUser;

    const sampleUsers = await User.find({})
      .select(
        '_id id externalId supabaseId authId name fullName full_name username email avatar avatarUrl avatar_url addons verified userVerified authorVerified accountVerified isVerified is_verified profileVerified subscriptionVerified'
      )
      .limit(5000)
      .lean();

    const lowerValue = value.toLowerCase();

    const byGeneratedCode = (sampleUsers || []).find((user) => {
      const code = getCollabCodeFromUser(user).toLowerCase();
      const name = getUserDisplayName(user).replace(/\s+/g, '').toLowerCase();
      const username = clean(user?.username).toLowerCase();

      return code === lowerValue || name === lowerValue || username === lowerValue;
    });

    return byGeneratedCode || null;
  } catch (err) {
    console.error('User lookup failed:', err?.message || err);
    return null;
  }
}

async function resolveUserIdOrCode(value) {
  const raw = clean(value);
  if (!raw) return '';

  const foundUser = await getUserByAnyId(raw);
  if (foundUser) return getUserPublicId(foundUser);

  return raw;
}

function collectRawUserId(value, bucket) {
  if (!value) return;

  if (typeof value === 'string') {
    const v = clean(value);
    if (v) bucket.add(v);
    return;
  }

  const keys = [
    value._id,
    value.id,
    value.userId,
    value.externalId,
    value.supabaseId,
    value.authId,
  ];

  keys.map(clean).filter(Boolean).forEach((id) => bucket.add(id));
}

async function buildUserMapForPosts(list) {
  const ids = new Set();

  for (const post of list || []) {
    collectRawUserId(post?.userId, ids);
    collectRawUserId(post?.user, ids);
    collectRawUserId(post?.authorId, ids);
    collectRawUserId(post?.externalId, ids);

    if (Array.isArray(post?.collaborators)) {
      post.collaborators.forEach((item) => collectRawUserId(item, ids));
    }

    if (Array.isArray(post?.collabInvites)) {
      post.collabInvites.forEach((item) => collectRawUserId(item, ids));
    }

    if (Array.isArray(post?.comments)) {
      post.comments.forEach((comment) => collectRawUserId(comment?.userId, ids));
    }
  }

  const userIds = Array.from(ids).filter(Boolean);

  if (!userIds.length) return new Map();

  const objectIds = userIds.map(toObjectIdIfValid).filter(Boolean);

  const users = await User.find({
    $or: [
      { externalId: { $in: userIds } },
      { id: { $in: userIds } },
      { supabaseId: { $in: userIds } },
      { authId: { $in: userIds } },
      { username: { $in: userIds } },
      ...(objectIds.length ? [{ _id: { $in: objectIds } }] : []),
    ],
  })
    .select(
      '_id id externalId supabaseId authId name fullName full_name username email avatar avatarUrl avatar_url profileImage profile_image addons verified userVerified authorVerified accountVerified isVerified is_verified profileVerified subscriptionVerified tier subscriptionTier'
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
      user?.username,
      getCollabCodeFromUser(user),
    ]
      .map(clean)
      .filter(Boolean);

    keys.forEach((key) => map.set(key, user));
  }

  return map;
}

function getUserFromMap(userMap, rawValue) {
  if (!userMap || !rawValue) return null;

  if (typeof rawValue === 'string') {
    return userMap.get(clean(rawValue)) || null;
  }

  const keys = [
    rawValue?._id,
    rawValue?.id,
    rawValue?.userId,
    rawValue?.externalId,
    rawValue?.supabaseId,
    rawValue?.authId,
    rawValue?.username,
  ]
    .map(clean)
    .filter(Boolean);

  for (const key of keys) {
    const found = userMap.get(key);
    if (found) return found;
  }

  return null;
}

function normalizeProfileFromRaw(raw, userMap, index = 0) {
  const foundUser = getUserFromMap(userMap, raw);

  if (foundUser) {
    return makeUserProfile(foundUser);
  }

  if (typeof raw === 'string') {
    return {
      id: raw,
      userId: raw,
      name: raw.length > 18 ? `Collaborator ${index + 1}` : raw,
      userName: raw.length > 18 ? `Collaborator ${index + 1}` : raw,
      avatar: '',
      userAvatar: '',
      verified: false,
      userVerified: false,
      isVerified: false,
      code: raw,
    };
  }

  const id =
    clean(raw?._id) ||
    clean(raw?.id) ||
    clean(raw?.userId) ||
    clean(raw?.externalId) ||
    clean(raw?.supabaseId) ||
    clean(raw?.authId) ||
    `collab-${index}`;

  const name =
    clean(raw?.name) ||
    clean(raw?.userName) ||
    clean(raw?.fullName) ||
    clean(raw?.full_name) ||
    clean(raw?.username) ||
    `Collaborator ${index + 1}`;

  const avatar =
    clean(raw?.avatar) ||
    clean(raw?.userAvatar) ||
    clean(raw?.avatarUrl) ||
    clean(raw?.avatar_url) ||
    '';

  const verified = isVerifiedUser(raw);

  return {
    id,
    userId: id,
    name,
    userName: name,
    avatar,
    userAvatar: avatar,
    verified,
    userVerified: verified,
    isVerified: verified,
    code: clean(raw?.code) || id,
  };
}

function normalizeComment(comment = {}, userMap = new Map()) {
  const commentUser = getUserFromMap(userMap, comment?.userId);
  const created = getSafeIsoDate(
    comment.timestamp ||
      comment.createdAt ||
      comment.created_at ||
      new Date().toISOString()
  );

  const content = clean(comment.content || comment.text || '');
  const userName = getUserDisplayName(commentUser, comment.userName);
  const userAvatar = getUserAvatar(commentUser, comment.userAvatar || comment.avatar);
  const verified = isVerifiedUser(commentUser) || isVerifiedUser(comment);

  return {
    id: clean(comment.id) || `c${Date.now()}`,
    userId: clean(comment.userId),
    userName,
    userAvatar,
    avatar: userAvatar,
    verified,
    userVerified: verified,
    isVerified: verified,
    content,
    text: content,
    type: comment.type || (comment.voiceUrl ? 'voice' : 'text'),
    voiceUrl: clean(comment.voiceUrl || comment.voice_url),
    createdAt: created,
    timestamp: created,
  };
}

function shapePost(rawPost, author = null, userMap = new Map()) {
  const p = typeof rawPost?.toObject === 'function' ? rawPost.toObject() : rawPost || {};

  const authorFromMap =
    author ||
    getUserFromMap(userMap, p.userId) ||
    getUserFromMap(userMap, p.user) ||
    getUserFromMap(userMap, p.authorId);

  const authorVerified =
    isVerifiedUser(authorFromMap) ||
    p?.verified === true ||
    p?.userVerified === true ||
    p?.authorVerified === true ||
    p?.accountVerified === true ||
    p?.isVerified === true ||
    p?.is_verified === true ||
    p?.profileVerified === true;

  const userName = getUserDisplayName(authorFromMap, p.userName);
  const avatar = getUserAvatar(authorFromMap, p.userAvatar || p.avatar);

  const images = Array.isArray(p.images) ? p.images.filter(Boolean) : [];
  const firstImage = clean(p.image) || images[0] || '';

  const likedBy = Array.isArray(p.likedBy) ? p.likedBy.map(String) : [];
  const comments = Array.isArray(p.comments)
    ? p.comments.map((comment) => normalizeComment(comment, userMap))
    : [];

  const rawCollaborators = Array.isArray(p.collaborators) ? p.collaborators : [];
  const rawCollabInvites = Array.isArray(p.collabInvites) ? p.collabInvites : [];

  const collaboratorProfiles = rawCollaborators
    .map((item, index) => normalizeProfileFromRaw(item, userMap, index))
    .filter((profile) => profile.id)
    .slice(0, 4);

  const collabInviteProfiles = rawCollabInvites
    .map((item, index) => normalizeProfileFromRaw(item, userMap, index))
    .filter((profile) => profile.id)
    .slice(0, 10);

  const createdAt = getSafeIsoDate(p.createdAt || p.timestamp || p.created_at);

  const content = clean(p.content);
  const hashtags = Array.isArray(p.hashtags)
    ? p.hashtags.filter(Boolean)
    : extractHashtags(content);

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
    is_verified: authorVerified,

    content,
    hashtags,

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

    downloadsLocked:
      p.downloadsLocked === true ||
      p.downloads_locked === true ||
      p.imagesLocked === true ||
      p.images_locked === true ||
      p.mediaLocked === true ||
      p.media_locked === true,

    mode: normalizeMode(p.mode),

    collaborators: collaboratorProfiles,
    collaboratorProfiles,

    collabInvites: collabInviteProfiles,
    collaborationRequests: collabInviteProfiles,

    likedBy,
    likes: likedBy.length,
    shares: Number(p.shares || 0),

    comments,
    createdAt,
    timestamp: createdAt,
  };
}

function idsMatch(a, b) {
  const aa = clean(a);
  const bb = clean(b);

  if (!aa || !bb) return false;

  return aa === bb;
}

function isOwner(postUserId, user) {
  const postOwnerId = clean(postUserId);
  if (!postOwnerId) return false;

  const ids = [
    getCanonicalUserId(user),
    user?._id,
    user?.id,
    user?.externalId,
    user?.supabaseId,
    user?.authId,
  ]
    .map(clean)
    .filter(Boolean);

  return ids.some((id) => idsMatch(id, postOwnerId));
}

function isCollaborator(post, user) {
  const ids = [
    getCanonicalUserId(user),
    user?._id,
    user?.id,
    user?.externalId,
    user?.supabaseId,
    user?.authId,
  ]
    .map(clean)
    .filter(Boolean);

  if (!ids.length) return false;

  const collaborators = Array.isArray(post?.collaborators) ? post.collaborators : [];

  return collaborators.some((item) => {
    const rawId =
      typeof item === 'string'
        ? item
        : clean(item?._id || item?.id || item?.userId || item?.externalId || item?.supabaseId);

    return ids.some((id) => idsMatch(id, rawId));
  });
}

function canEdit(post, user) {
  return isOwner(post?.userId, user) || isCollaborator(post, user);
}

function setDocField(doc, key, value) {
  try {
    doc.set(key, value, { strict: false });
    doc.markModified(key);
  } catch {
    doc[key] = value;
  }
}

function getPostOwnerId(post) {
  return clean(post?.userId || post?.user || post?.authorId);
}

async function getShapedPostById(id) {
  const doc = await Post.findOne({ id }).lean();
  if (!doc) return null;

  const userMap = await buildUserMapForPosts([doc]);
  const author = getUserFromMap(userMap, doc.userId);

  return shapePost(doc, author, userMap);
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
        const author = getUserFromMap(userMap, post.userId);
        return shapePost(post, author, userMap);
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
      downloadsLocked = false,
      hashtags = [],
    } = req.body || {};

    const safeImages = Array.isArray(images) ? images.filter(Boolean).slice(0, 5) : [];
    const firstImage = safeImages[0] || image || '';
    const id = `p${Date.now()}`;

    const currentUserId = getCanonicalUserId(req.user);
    const fullUser = await getUserByAnyId(currentUserId);

    const currentUserName = getUserDisplayName(fullUser || req.user, req.user?.name);
    const currentUserAvatar = getUserAvatar(fullUser || req.user, req.user?.avatar);
    const currentUserVerified = isVerifiedUser(fullUser) || isVerifiedUser(req.user);

    const safeContent = clean(content);
    const safeHashtags = Array.isArray(hashtags) && hashtags.length
      ? hashtags.filter(Boolean).slice(0, 10)
      : extractHashtags(safeContent);

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
        is_verified: currentUserVerified,

        content: safeContent,
        hashtags: safeHashtags,

        image: firstImage || '',
        images: safeImages,
        audio: audio || '',
        video: video || videoUrl || '',
        videoUrl: videoUrl || video || '',

        documents: Array.isArray(documents) ? documents : [],
        documentUrl: documentUrl || '',
        documentPages: Array.isArray(documentPages) ? documentPages : [],

        downloadsLocked: downloadsLocked === true,

        mode: normalizeMode(mode),
        collabInvites: [],
        collaborators: [],
        likedBy: [],
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
        isVerified: currentUserVerified,
        content: safeContent,
        hashtags: safeHashtags,
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
      isVerified: currentUserVerified,
      content: safeContent,
      hashtags: safeHashtags,
      image: firstImage || '',
      images: safeImages,
      audio: audio || '',
      video: video || videoUrl || '',
      videoUrl: videoUrl || video || '',
      documents: Array.isArray(documents) ? documents : [],
      documentUrl: documentUrl || '',
      documentPages: Array.isArray(documentPages) ? documentPages : [],
      downloadsLocked: downloadsLocked === true,
      likedBy: [],
      shares: 0,
      comments: [],
      createdAt: new Date().toISOString(),
      mode: normalizeMode(mode),
      collabInvites: [],
      collaborators: [],
    };

    posts.unshift(post);
    saveJSON('posts.json', posts).catch(() => {});

    return res.status(201).json(shapePost(post));
  })().catch((err) => {
    console.error('Create post error:', err?.message || err);
    res.status(500).json({ error: 'server_error' });
  });
});

router.patch('/:id/downloads-lock', requireAuth, (req, res) => {
  (async () => {
    const { id } = req.params;
    const locked = req.body?.locked === true || req.body?.downloadsLocked === true;

    if (!(await mongoReady())) {
      return res.status(501).json({ error: 'not_supported' });
    }

    const doc = await Post.findOne({ id });
    if (!doc) return res.status(404).json({ error: 'Not found' });

    if (!isOwner(doc.userId, req.user)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    setDocField(doc, 'downloadsLocked', locked);
    setDocField(doc, 'imagesLocked', locked);
    setDocField(doc, 'mediaLocked', locked);

    await doc.save();

    const shaped = await getShapedPostById(id);
    return res.json(shaped);
  })().catch((err) => {
    console.error('Downloads lock error:', err?.message || err);
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

      doc.markModified('likedBy');
      await doc.save();

      try {
        const likedNow = doc.likedBy.map(String).includes(String(userId));
        const ownerId = getPostOwnerId(doc);

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

      const shaped = await getShapedPostById(id);
      return res.json(shaped);
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

      setDocField(doc, 'shares', Number(doc.shares || 0) + 1);
      await doc.save();

      try {
        const ownerId = getPostOwnerId(doc);

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

      const shaped = await getShapedPostById(id);
      return res.json(shaped);
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

async function addCommentHandler(req, res) {
  const { id } = req.params;
  const text = clean(req.body?.text || req.body?.content);
  const voiceUrl = clean(req.body?.voiceUrl || req.body?.voice_url || req.body?.audio || req.body?.url);
  const type = voiceUrl ? 'voice' : 'text';

  const userId = getCanonicalUserId(req.user);
  const fullUser = await getUserByAnyId(userId);

  if (!text && !voiceUrl) {
    return res.status(400).json({ error: 'comment_required' });
  }

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
    doc.markModified('comments');

    await doc.save();

    try {
      const ownerId = getPostOwnerId(doc);

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
}

router.post('/:id/comment', requireAuth, (req, res) => {
  addCommentHandler(req, res).catch((err) => {
    console.error('Comment error:', err?.message || err);
    res.status(500).json({ error: 'server_error' });
  });
});

router.post('/:id/voice-comment', requireAuth, (req, res) => {
  addCommentHandler(req, res).catch((err) => {
    console.error('Voice comment error:', err?.message || err);
    res.status(500).json({ error: 'server_error' });
  });
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

      setDocField(doc, 'content', nextContent || doc.content);
      setDocField(doc, 'hashtags', extractHashtags(nextContent || doc.content));

      await doc.save();

      const shaped = await getShapedPostById(id);
      return res.json(shaped);
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
    p.hashtags = extractHashtags(p.content);

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

      return res.json({ ok: true, id });
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

      return res.json({ ok: true, id });
    }

    const idx = posts.findIndex((x) => x.id === id);

    if (idx === -1) return res.status(404).json({ error: 'Not found' });

    if (!isOwner(posts[idx].userId, req.user)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    posts.splice(idx, 1);
    saveJSON('posts.json', posts).catch(() => {});

    return res.json({ ok: true, id });
  })().catch((err) => {
    console.error('Delete post error:', err?.message || err);
    res.status(500).json({ error: 'server_error' });
  });
});

router.post('/:id/collab/invite', requireAuth, (req, res) => {
  (async () => {
    const { id } = req.params;

    if (!(await mongoReady())) {
      return res.status(501).json({ error: 'not_supported' });
    }

    const doc = await Post.findOne({ id });
    if (!doc) return res.status(404).json({ error: 'Not found' });

    const requesterId = getCanonicalUserId(req.user);
    const postOwnerId = getPostOwnerId(doc);
    const ownerRequest = isOwner(doc.userId, req.user);

    const rawTarget =
      clean(req.body?.userId) ||
      clean(req.body?.inviteeId) ||
      clean(req.body?.collaboratorId) ||
      clean(req.body?.code);

    const targetUserId = ownerRequest
      ? await resolveUserIdOrCode(rawTarget)
      : requesterId;

    if (!targetUserId) {
      return res.status(400).json({ error: 'userId_required' });
    }

    if (ownerRequest && idsMatch(targetUserId, requesterId)) {
      return res.status(400).json({ error: 'cannot_invite_self' });
    }

    const invites = Array.isArray(doc.collabInvites) ? doc.collabInvites.map(String) : [];
    const collaborators = Array.isArray(doc.collaborators) ? doc.collaborators.map(String) : [];

    if (collaborators.some((id) => idsMatch(id, targetUserId))) {
      return res.json({
        ok: true,
        status: 'already_collaborator',
        post: await getShapedPostById(id),
      });
    }

    if (collaborators.length >= 4) {
      return res.status(400).json({ error: 'collaborator_limit_reached' });
    }

    if (!invites.some((id) => idsMatch(id, targetUserId))) {
      invites.push(String(targetUserId));
    }

    setDocField(doc, 'collabInvites', invites);
    await doc.save();

    try {
      if (ownerRequest) {
        createNotification(req, {
          toUserId: String(targetUserId),
          fromUserId: String(requesterId),
          type: 'collab_invite',
          title: 'Collaboration Invite',
          message: `${clean(req.user?.name) || 'Someone'} invited you to collaborate on a post`,
          actionUrl: '/feed',
          meta: { postId: id },
        }).catch(() => {});
      } else {
        createNotification(req, {
          toUserId: String(postOwnerId),
          fromUserId: String(requesterId),
          type: 'collab_request',
          title: 'Collaboration Request',
          message: `${clean(req.user?.name) || 'Someone'} wants to be added as collaborator`,
          actionUrl: '/feed',
          meta: { postId: id, requesterId },
        }).catch(() => {});
      }
    } catch {}

    return res.json({
      ok: true,
      status: ownerRequest ? 'invite_sent' : 'request_sent',
      post: await getShapedPostById(id),
    });
  })().catch((err) => {
    console.error('Collab invite/request error:', err?.message || err);
    res.status(500).json({ error: 'server_error' });
  });
});

router.post('/:id/collab/request', requireAuth, (req, res) => {
  req.body = {
    ...(req.body || {}),
    userId: getCanonicalUserId(req.user),
  };

  return router.handle(
    {
      ...req,
      method: 'POST',
      url: `/${req.params.id}/collab/invite`,
      originalUrl: req.originalUrl,
    },
    res
  );
});

router.post('/:id/collab/accept', requireAuth, (req, res) => {
  (async () => {
    const { id } = req.params;

    if (!(await mongoReady())) {
      return res.status(501).json({ error: 'not_supported' });
    }

    const doc = await Post.findOne({ id });
    if (!doc) return res.status(404).json({ error: 'Not found' });

    const currentUserId = getCanonicalUserId(req.user);
    const ownerRequest = isOwner(doc.userId, req.user);

    const requestedTarget =
      clean(req.body?.userId) ||
      clean(req.body?.inviteeId) ||
      clean(req.body?.collaboratorId) ||
      clean(req.query?.userId);

    const targetUserId = ownerRequest
      ? await resolveUserIdOrCode(requestedTarget)
      : currentUserId;

    if (!targetUserId) {
      return res.status(400).json({ error: 'userId_required' });
    }

    const invites = Array.isArray(doc.collabInvites) ? doc.collabInvites.map(String) : [];
    const collaborators = Array.isArray(doc.collaborators) ? doc.collaborators.map(String) : [];

    const hasInvite = invites.some((item) => idsMatch(item, targetUserId));

    if (!hasInvite) {
      return res.status(403).json({ error: 'No invite' });
    }

    if (collaborators.length >= 4 && !collaborators.some((item) => idsMatch(item, targetUserId))) {
      return res.status(400).json({ error: 'collaborator_limit_reached' });
    }

    const nextInvites = invites.filter((item) => !idsMatch(item, targetUserId));

    if (!collaborators.some((item) => idsMatch(item, targetUserId))) {
      collaborators.push(String(targetUserId));
    }

    setDocField(doc, 'collabInvites', nextInvites);
    setDocField(doc, 'collaborators', collaborators);

    await doc.save();

    try {
      const postOwnerId = getPostOwnerId(doc);

      createNotification(req, {
        toUserId: ownerRequest ? String(targetUserId) : String(postOwnerId),
        fromUserId: String(currentUserId),
        type: 'collab_accept',
        title: 'Collaboration Accepted',
        message: ownerRequest
          ? `${clean(req.user?.name) || 'Post author'} added you as collaborator`
          : `${clean(req.user?.name) || 'Someone'} accepted your collaboration invite`,
        actionUrl: '/feed',
        meta: { postId: id, collaboratorId: targetUserId },
      }).catch(() => {});
    } catch {}

    return res.json({
      ok: true,
      status: 'accepted',
      post: await getShapedPostById(id),
    });
  })().catch((err) => {
    console.error('Collab accept error:', err?.message || err);
    res.status(500).json({ error: 'server_error' });
  });
});

router.post('/:id/collab/reject', requireAuth, (req, res) => {
  (async () => {
    const { id } = req.params;

    if (!(await mongoReady())) {
      return res.status(501).json({ error: 'not_supported' });
    }

    const doc = await Post.findOne({ id });
    if (!doc) return res.status(404).json({ error: 'Not found' });

    const currentUserId = getCanonicalUserId(req.user);
    const ownerRequest = isOwner(doc.userId, req.user);

    const requestedTarget =
      clean(req.body?.userId) ||
      clean(req.body?.inviteeId) ||
      clean(req.body?.collaboratorId) ||
      clean(req.query?.userId);

    const targetUserId = ownerRequest
      ? await resolveUserIdOrCode(requestedTarget)
      : currentUserId;

    if (!targetUserId) {
      return res.status(400).json({ error: 'userId_required' });
    }

    const invites = Array.isArray(doc.collabInvites) ? doc.collabInvites.map(String) : [];
    const nextInvites = invites.filter((item) => !idsMatch(item, targetUserId));

    setDocField(doc, 'collabInvites', nextInvites);
    await doc.save();

    return res.json({
      ok: true,
      status: 'rejected',
      post: await getShapedPostById(id),
    });
  })().catch((err) => {
    console.error('Collab reject error:', err?.message || err);
    res.status(500).json({ error: 'server_error' });
  });
});

router.delete('/:id/collab/:userId', requireAuth, (req, res) => {
  (async () => {
    const { id, userId } = req.params;

    if (!(await mongoReady())) {
      return res.status(501).json({ error: 'not_supported' });
    }

    const doc = await Post.findOne({ id });
    if (!doc) return res.status(404).json({ error: 'Not found' });

    if (!isOwner(doc.userId, req.user)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const targetUserId = await resolveUserIdOrCode(userId);
    const collaborators = Array.isArray(doc.collaborators) ? doc.collaborators.map(String) : [];

    const nextCollaborators = collaborators.filter((item) => !idsMatch(item, targetUserId));

    setDocField(doc, 'collaborators', nextCollaborators);
    await doc.save();

    return res.json({
      ok: true,
      status: 'removed',
      post: await getShapedPostById(id),
    });
  })().catch((err) => {
    console.error('Remove collaborator error:', err?.message || err);
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

      setDocField(doc, 'comments', comments);
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

      const commentOwnerId = clean(comments[idx].userId);
      const userOwnsComment = idsMatch(commentOwnerId, userId);
      const userOwnsPost = isOwner(doc.userId, req.user);

      if (!userOwnsComment && !userOwnsPost) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const removed = comments.splice(idx, 1)[0];

      setDocField(doc, 'comments', comments);
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

    const commentOwnerId = clean(p.comments[idx].userId);
    const userOwnsComment = idsMatch(commentOwnerId, userId);
    const userOwnsPost = isOwner(p.userId, req.user);

    if (!userOwnsComment && !userOwnsPost) {
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
