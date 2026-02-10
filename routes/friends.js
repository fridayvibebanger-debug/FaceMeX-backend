import { Router } from 'express';
import { loadJSON, saveJSON } from '../utils/jsonStore.js';

const router = Router();

function getCurrentUserId(req) {
  return String(req.headers['x-user-id'] || req.user?._id || req.user?.id || '1');
}

function normalizeUser(u, fallbackId) {
  if (!u) return { id: fallbackId, name: 'User' };
  if (typeof u === 'string') return { id: u, name: 'User' };
  return {
    id: String(u.id || u.userId || fallbackId),
    name: String(u.name || u.full_name || u.fullName || 'User'),
  };
}

function createId() {
  return `fr-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function loadStore() {
  return (
    (await loadJSON('friends.json', { requests: [], friends: {} })) || {
      requests: [],
      friends: {},
    }
  );
}

function addFriendEdge(store, a, b) {
  if (!store.friends) store.friends = {};
  if (!Array.isArray(store.friends[a])) store.friends[a] = [];
  if (!Array.isArray(store.friends[b])) store.friends[b] = [];
  if (!store.friends[a].includes(b)) store.friends[a].push(b);
  if (!store.friends[b].includes(a)) store.friends[b].push(a);
}

router.get('/requests', async (req, res) => {
  const userId = getCurrentUserId(req);
  const store = await loadStore();
  const incoming = (store.requests || []).filter((r) => r.toUserId === userId && r.status === 'pending');
  const outgoing = (store.requests || []).filter((r) => r.fromUserId === userId && r.status === 'pending');
  res.json({ incoming, outgoing });
});

router.post('/request', async (req, res) => {
  const fromUserId = getCurrentUserId(req);
  const fromUser = normalizeUser(req.body?.fromUser, fromUserId);
  const toUser = normalizeUser(req.body?.toUser, '');

  if (!toUser.id) return res.status(400).json({ error: 'to_user_required' });
  if (toUser.id === fromUserId) return res.status(400).json({ error: 'cannot_request_self' });

  const store = await loadStore();
  const requests = Array.isArray(store.requests) ? store.requests : [];

  const existing = requests.find(
    (r) =>
      r.status === 'pending' &&
      ((r.fromUserId === fromUserId && r.toUserId === toUser.id) ||
        (r.fromUserId === toUser.id && r.toUserId === fromUserId))
  );
  if (existing) return res.status(409).json({ error: 'request_already_exists', request: existing });

  const request = {
    id: createId(),
    fromUserId,
    fromName: fromUser.name,
    toUserId: toUser.id,
    toName: toUser.name,
    status: 'pending',
    createdAt: Date.now(),
  };

  requests.unshift(request);
  store.requests = requests;
  await saveJSON('friends.json', store);

  const io = req.app.get('io');
  if (io) {
    io.to(`user:${toUser.id}`).emit('friend:request', request);
    io.to(`user:${fromUserId}`).emit('friend:request', request);
  }

  res.status(201).json({ request });
});

router.post('/request/:id/accept', async (req, res) => {
  const userId = getCurrentUserId(req);
  const id = String(req.params.id);
  const store = await loadStore();
  const requests = Array.isArray(store.requests) ? store.requests : [];

  const idx = requests.findIndex((r) => r.id === id);
  if (idx === -1) return res.status(404).json({ error: 'not_found' });

  const r = requests[idx];
  if (r.toUserId !== userId) return res.status(403).json({ error: 'forbidden' });

  const updated = { ...r, status: 'accepted', respondedAt: Date.now() };
  requests[idx] = updated;
  store.requests = requests;
  addFriendEdge(store, r.fromUserId, r.toUserId);

  await saveJSON('friends.json', store);

  const io = req.app.get('io');
  if (io) {
    io.to(`user:${r.fromUserId}`).emit('friend:request:updated', updated);
    io.to(`user:${r.toUserId}`).emit('friend:request:updated', updated);
  }

  res.json({ request: updated });
});

router.post('/request/:id/decline', async (req, res) => {
  const userId = getCurrentUserId(req);
  const id = String(req.params.id);
  const store = await loadStore();
  const requests = Array.isArray(store.requests) ? store.requests : [];

  const idx = requests.findIndex((r) => r.id === id);
  if (idx === -1) return res.status(404).json({ error: 'not_found' });

  const r = requests[idx];
  if (r.toUserId !== userId) return res.status(403).json({ error: 'forbidden' });

  const updated = { ...r, status: 'declined', respondedAt: Date.now() };
  requests[idx] = updated;
  store.requests = requests;

  await saveJSON('friends.json', store);

  const io = req.app.get('io');
  if (io) {
    io.to(`user:${r.fromUserId}`).emit('friend:request:updated', updated);
    io.to(`user:${r.toUserId}`).emit('friend:request:updated', updated);
  }

  res.json({ request: updated });
});

export default router;
