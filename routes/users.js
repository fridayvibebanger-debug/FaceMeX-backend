import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { connectDb } from '../lib/db.js';
import { User } from '../models/User.js';
import { loadJSON, saveJSON } from '../utils/jsonStore.js';
import { createNotification } from '../utils/notify.js';

const router = Router();

router.get('/me', requireAuth, async (req, res) => {
  const user = req.user;
  return res.json({
    id: user._id?.toString?.() || String(user.id || ''),
    email: user.email,
    name: user.name,
    avatar: user.avatar,
    coverPhoto: user.coverPhoto,
    bio: user.bio,
    pronouns: user.pronouns,
    mood: user.mood,
    location: user.location,
    website: user.website,
    interests: user.interests,
    tier: user.tier,
    addons: user.addons,
    mode: user.mode,
    professional: user.professional || null,
  });
});

router.patch('/me', requireAuth, async (req, res) => {
  await connectDb();
  const id = req.user?._id?.toString?.() || String(req.user?.id || '');
  const patch = req.body || {};
  const allowed = {
    name: typeof patch.name === 'string' ? patch.name : undefined,
    avatar: typeof patch.avatar === 'string' ? patch.avatar : undefined,
    coverPhoto: typeof patch.coverPhoto === 'string' ? patch.coverPhoto : undefined,
    bio: typeof patch.bio === 'string' ? patch.bio : undefined,
    pronouns: typeof patch.pronouns === 'string' ? patch.pronouns : undefined,
    mood: typeof patch.mood === 'string' ? patch.mood : undefined,
    location: typeof patch.location === 'string' ? patch.location : undefined,
    website: typeof patch.website === 'string' ? patch.website : undefined,
    interests: Array.isArray(patch.interests) ? patch.interests.map(String) : undefined,
    mode: patch.mode === 'professional' ? 'professional' : (patch.mode === 'social' ? 'social' : undefined),
  };
  Object.keys(allowed).forEach((k) => allowed[k] === undefined && delete allowed[k]);

  const updated = await User.findByIdAndUpdate(id, allowed, { new: true }).lean();
  if (!updated) return res.status(404).json({ error: 'not_found' });
  return res.json({
    id: updated._id.toString(),
    email: updated.email,
    name: updated.name,
    avatar: updated.avatar,
    coverPhoto: updated.coverPhoto,
    bio: updated.bio,
    pronouns: updated.pronouns,
    mood: updated.mood,
    location: updated.location,
    website: updated.website,
    interests: updated.interests,
    tier: updated.tier,
    addons: updated.addons,
    mode: updated.mode,
    professional: updated.professional || null,
  });
});

// Upsert professional profile fields
// body: { professional: { headline, bio, location, skills[], experience[], links[], endorsements{} } }
router.patch('/me/professional', requireAuth, async (req, res) => {
  await connectDb();
  const id = req.user?._id?.toString?.() || String(req.user?.id || '');
  const incoming = req.body?.professional || {};

  const existing = (req.user && req.user.professional) || {};
  const nextProfessional = {
    headline: incoming.headline ?? existing.headline ?? '',
    bio: incoming.bio ?? existing.bio ?? '',
    location: incoming.location ?? existing.location ?? '',
    skills: Array.isArray(incoming.skills) ? incoming.skills.map(String) : (existing.skills || []),
    experience: Array.isArray(incoming.experience) ? incoming.experience : (existing.experience || []),
    education: Array.isArray(incoming.education) ? incoming.education : (existing.education || []),
    links: Array.isArray(incoming.links) ? incoming.links : (existing.links || []),
    endorsements:
      typeof incoming.endorsements === 'object' && incoming.endorsements ? incoming.endorsements : (existing.endorsements || {}),
    openToCollab: typeof incoming.openToCollab === 'boolean' ? incoming.openToCollab : (existing.openToCollab ?? false),
    collabNote: typeof incoming.collabNote === 'string' ? incoming.collabNote : (existing.collabNote ?? ''),
    resumeSummary: typeof incoming.resumeSummary === 'string' ? incoming.resumeSummary : (existing.resumeSummary ?? ''),
  };

  const updated = await User.findByIdAndUpdate(id, { professional: nextProfessional }, { new: true }).lean();
  if (!updated) return res.status(404).json({ error: 'not_found' });
  return res.json({
    id: updated._id.toString(),
    email: updated.email,
    name: updated.name,
    avatar: updated.avatar,
    tier: updated.tier,
    addons: updated.addons,
    mode: updated.mode,
    professional: updated.professional || null,
  });
});

// Endorse a skill: body { skill }
router.post('/me/endorse', requireAuth, async (req, res) => {
  await connectDb();
  const me = req.user;
  const skill = String(req.body?.skill || '').trim();
  if (!skill) return res.status(400).json({ error: 'skill required' });
  const pro = me.professional || {};
  const endorsements = { ...(pro.endorsements || {}) };
  endorsements[skill] = (endorsements[skill] || 0) + 1;

  const id = me._id?.toString?.() || String(me.id || '');
  const nextProfessional = { ...pro, endorsements };
  await User.findByIdAndUpdate(id, { professional: nextProfessional });
  // persist and emit notification
  try {
    createNotification(req, {
      toUserId: id,
      fromUserId: id,
      type: 'endorsement',
      title: 'New endorsement',
      message: `Your skill ${skill} was endorsed`,
      actionUrl: '/profile',
      meta: { skill },
    }).catch(() => {});
  } catch {}
  res.json({ endorsements });
});

router.get('/collab', requireAuth, async (_req, res) => {
  await connectDb();
  const list = await User.find({ 'professional.openToCollab': true })
    .select('name avatar professional')
    .limit(25)
    .lean();
  const users = (list || []).map((u) => ({
    id: u._id.toString(),
    name: u.name,
    avatar: u.avatar || '',
    professional: u.professional || null,
    openToCollab: true,
  }));
  return res.json({ users });
});

// Discover professionals by skill (very simple demo implementation)
// GET /api/users/discover?skill=react
// Returns: { users: [{ id, name, avatar, professional }] }
router.get('/discover', requireAuth, async (req, res) => {
  await connectDb();
  const skill = String(req.query.skill || '').trim().toLowerCase();
  if (!skill) return res.json({ users: [] });

  const list = await User.find({ 'professional.skills': { $elemMatch: { $regex: skill, $options: 'i' } } })
    .select('name avatar professional')
    .limit(25)
    .lean();
  const users = (list || []).map((u) => ({
    id: u._id.toString(),
    name: u.name,
    avatar: u.avatar || '',
    professional: u.professional || null,
  }));
  return res.json({ users });
});

// Suggested users for sidebar: return recent distinct post authors and a few defaults
router.get('/suggested', requireAuth, async (req, res) => {
  try {
    const meId = String(req.user?._id || req.user?.id || '');
    const postsData = await loadJSON('posts.json', []);
    const posts = Array.isArray(postsData) ? postsData : (postsData.posts || []);
    const seen = new Set();
    const users = [];

    for (const p of posts) {
      const id = String(p.userId || p.user?.id || p.authorId || p.id || '');
      const name = p.userName || (p.user && p.user.name) || p.name || 'User';
      const avatar = p.userAvatar || (p.user && p.user.avatar) || p.avatar || '';
      if (!id || (meId && id === meId)) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      users.push({ id, name, avatar });
      if (users.length >= 6) break;
    }

    // Fallback sample users if not enough from posts
    if (users.length < 3) {
      const defaults = [
        { id: '2', name: 'Sarah Johnson', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=sarah' },
        { id: '3', name: 'Mike Chen', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=mike' },
        { id: '4', name: 'Emma Wilson', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=emma' },
      ];
      for (const d of defaults) {
        if (users.length >= 6) break;
        if (!seen.has(d.id)) users.push(d);
      }
    }

    res.json({ users });
  } catch (err) {
    res.status(500).json({ users: [] });
  }
});

export default router;
