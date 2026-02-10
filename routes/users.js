import { Router } from 'express';
import { getMe, setMe } from '../utils/userStore.js';
import { loadJSON, saveJSON } from '../utils/jsonStore.js';

const router = Router();

// In-memory mock via shared store

router.get('/me', (_req, res) => {
  res.json(getMe());
});

router.patch('/me', (req, res) => {
  const updated = setMe(req.body || {});
  res.json(updated);
});

// Upsert professional profile fields
// body: { professional: { headline, bio, location, skills[], experience[], links[], endorsements{} } }
router.patch('/me/professional', (req, res) => {
  const me = getMe();
  const incoming = req.body?.professional || {};
  const next = {
    ...me,
    professional: {
      headline: incoming.headline ?? me.professional?.headline ?? '',
      bio: incoming.bio ?? me.professional?.bio ?? '',
      location: incoming.location ?? me.professional?.location ?? '',
      skills: Array.isArray(incoming.skills) ? incoming.skills.map(String) : (me.professional?.skills || []),
      experience: Array.isArray(incoming.experience) ? incoming.experience : (me.professional?.experience || []),
      education: Array.isArray(incoming.education) ? incoming.education : (me.professional?.education || []),
      links: Array.isArray(incoming.links) ? incoming.links : (me.professional?.links || []),
      endorsements: typeof incoming.endorsements === 'object' && incoming.endorsements ? incoming.endorsements : (me.professional?.endorsements || {}),
      openToCollab: typeof incoming.openToCollab === 'boolean' ? incoming.openToCollab : (me.professional?.openToCollab ?? false),
      collabNote: typeof incoming.collabNote === 'string' ? incoming.collabNote : (me.professional?.collabNote ?? ''),
      resumeSummary: typeof incoming.resumeSummary === 'string' ? incoming.resumeSummary : (me.professional?.resumeSummary ?? ''),
    }
  };
  const updated = setMe(next);
  res.json(updated);
});

// Endorse a skill: body { skill }
router.post('/me/endorse', async (req, res) => {
  const me = getMe();
  const skill = String(req.body?.skill || '').trim();
  if (!skill) return res.status(400).json({ error: 'skill required' });
  const pro = me.professional || {};
  const endorsements = { ...(pro.endorsements || {}) };
  endorsements[skill] = (endorsements[skill] || 0) + 1;
  const next = setMe({ professional: { ...pro, endorsements } });
  // persist and emit notification
  try {
    const data = (await loadJSON('notifications.json', { notifications: [] })) || { notifications: [] };
    const list = Array.isArray(data.notifications) ? data.notifications : [];
    const note = {
      id: String(Date.now()),
      type: 'endorsement',
      title: 'New endorsement',
      message: `Your skill ${skill} was endorsed`,
      isRead: false,
      timestamp: Date.now(),
      actionUrl: '/profile',
    };
    list.unshift(note);
    await saveJSON('notifications.json', { notifications: list });
    const io = req.app.get('io');
    if (io) io.emit('notify', note);
  } catch {}
  res.json({ endorsements: next.professional.endorsements });
});

router.get('/collab', (_req, res) => {
  const me = getMe();
  const pro = me.professional || {};
  const users = pro.openToCollab
    ? [
        {
          id: me.id,
          name: me.name,
          avatar: me.avatar,
          professional: pro,
          openToCollab: true,
        },
      ]
    : [];
  res.json({ users });
});

// Discover professionals by skill (very simple demo implementation)
// GET /api/users/discover?skill=react
// Returns: { users: [{ id, name, avatar, professional }] }
router.get('/discover', (req, res) => {
  const skill = String(req.query.skill || '').trim().toLowerCase();
  const me = getMe();
  const pro = me.professional || {};
  const skills = Array.isArray(pro.skills) ? pro.skills : [];

  if (!skill) {
    return res.json({ users: [] });
  }

  const hasSkill = skills.some((s) => String(s).toLowerCase() === skill || String(s).toLowerCase().includes(skill));
  const users = hasSkill
    ? [
        {
          id: me.id,
          name: me.name,
          avatar: me.avatar,
          professional: pro,
        },
      ]
    : [];

  res.json({ users });
});

export default router;
