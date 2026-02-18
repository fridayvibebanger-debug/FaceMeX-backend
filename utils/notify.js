import { connectDb } from '../lib/db.js';
import { Notification } from '../models/Notification.js';
import { loadJSON, saveJSON } from './jsonStore.js';

async function loadFallbackStore() {
  const data = (await loadJSON('notifications.json', { byUserId: {} })) || { byUserId: {} };
  if (data && Array.isArray(data.notifications)) {
    return { byUserId: { '1': data.notifications } };
  }
  if (!data.byUserId || typeof data.byUserId !== 'object') return { byUserId: {} };
  return data;
}

async function saveFallbackStore(store) {
  await saveJSON('notifications.json', store);
}

export async function createNotification(req, payload) {
  const toUserId = String(payload?.toUserId || '').trim();
  if (!toUserId) return null;

  const noteInput = {
    userId: toUserId,
    fromUserId: String(payload?.fromUserId || ''),
    type: String(payload?.type || 'system'),
    title: String(payload?.title || ''),
    message: String(payload?.message || ''),
    actionUrl: String(payload?.actionUrl || ''),
    meta: payload?.meta && typeof payload.meta === 'object' ? payload.meta : undefined,
    isRead: false,
  };

  let created = null;
  try {
    const conn = await connectDb();
    if (conn) {
      created = await Notification.create(noteInput);
    } else {
      const store = await loadFallbackStore();
      if (!store.byUserId) store.byUserId = {};
      if (!Array.isArray(store.byUserId[toUserId])) store.byUserId[toUserId] = [];
      const item = {
        id: `n${Date.now()}-${Math.random().toString(16).slice(2)}`,
        ...noteInput,
        timestamp: Date.now(),
      };
      store.byUserId[toUserId].unshift(item);
      await saveFallbackStore(store);
      created = item;
    }
  } catch {
    return null;
  }

  try {
    const io = req?.app?.get?.('io');
    if (io) io.to(`user:${toUserId}`).emit('notify', created);
  } catch {}

  return created;
}
