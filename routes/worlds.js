import { Router } from 'express';
import { getMe } from '../utils/userStore.js';
import { initWorlds, listWorlds, getWorld, addWorld, updateWorld as storeUpdateWorld, removeWorld } from '../utils/worldsStore.js';

const router = Router();

// Ensure worlds initialized
initWorlds().catch(() => {});

function requireCreator(req, res, world) {
  const me = getMe();
  if (!world) return res.status(404).json({ error: 'not_found' });
  if (world.creatorId !== me.id) return res.status(403).json({ error: 'forbidden' });
  return null;
}

router.get('/', (_req, res) => {
  return res.json({ items: listWorlds() });
});

router.post('/', async (req, res) => {
  const me = getMe();
  const { name, description, thumbnail, maxParticipants = 50, isPublic = true, theme = 'beach', priceCents = 0, mods = [] } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name_required' });
  const world = {
    id: String(Date.now()),
    name,
    description: description || '',
    thumbnail: thumbnail || '',
    creatorId: me.id,
    creatorName: me.name || 'Creator',
    participants: 1,
    maxParticipants: Math.max(1, Number(maxParticipants) || 50),
    isPublic: !!isPublic,
    theme,
    priceCents: Math.max(0, Number(priceCents) || 0),
    mods: Array.isArray(mods) ? mods : [],
  };
  await addWorld(world);
  return res.status(201).json({ world });
});

router.patch('/:id', async (req, res) => {
  const world = getWorld(req.params.id);
  const err = requireCreator(req, res, world); if (err) return;
  const patch = req.body || {};
  const cleaned = { ...patch };
  if (cleaned.maxParticipants) cleaned.maxParticipants = Math.max(1, Number(cleaned.maxParticipants));
  if (cleaned.priceCents) cleaned.priceCents = Math.max(0, Number(cleaned.priceCents));
  const updated = await storeUpdateWorld(world.id, cleaned);
  return res.json({ world: updated });
});

router.delete('/:id', async (req, res) => {
  const world = getWorld(req.params.id);
  const err = requireCreator(req, res, world); if (err) return;
  const ok = await removeWorld(world.id);
  return res.json({ ok });
});

// Join with checks: capacity + paywall via tier (pro or higher if paid/private)
router.post('/:id/join', async (req, res) => {
  const me = getMe();
  const world = getWorld(req.params.id);
  if (!world) return res.status(404).json({ error: 'not_found' });
  const requiresTier = (world.priceCents || 0) > 0 || !world.isPublic;
  const order = { free: 0, pro: 1, creator: 2, business: 3, exclusive: 4 };
  const hasTier = order[(me.tier || 'free')] >= order['pro'];
  if (requiresTier && !hasTier) return res.status(402).json({ error: 'payment_required' });
  if ((world.participants || 0) >= (world.maxParticipants || 0)) return res.status(409).json({ error: 'full' });
  const updated = await storeUpdateWorld(world.id, { participants: (world.participants || 0) + 1 });
  return res.json({ world: updated });
});

router.post('/:id/leave', async (req, res) => {
  const world = getWorld(req.params.id);
  if (!world) return res.status(404).json({ error: 'not_found' });
  const updated = await storeUpdateWorld(world.id, { participants: Math.max(0, (world.participants || 0) - 1) });
  return res.json({ world: updated });
});

export default router;
