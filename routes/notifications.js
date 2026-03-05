import { Router } from 'express'
import { loadJSON, saveJSON } from '../utils/jsonStore.js'
import { connectDb } from '../lib/db.js'
import { Notification } from '../models/Notification.js'

const router = Router()

// In this demo, notifications are stored for the single demo user in data/notifications.json
// Shape: { notifications: [{ id, type, title, message, actionUrl, isRead, timestamp }] }

router.get('/', async (_req, res) => {
  const req = _req;
  const userId = String(req.user?._id || req.user?.id || req.headers['x-user-id'] || '').trim();
  if (!userId) {
    const data = (await loadJSON('notifications.json', { notifications: [] })) || { notifications: [] }
    return res.json({ notifications: data.notifications || [] })
  }

  try {
    const conn = await connectDb();
    if (conn) {
      const list = await Notification.find({ userId }).sort({ createdAt: -1 }).limit(200).lean();
      const shaped = (list || []).map((n) => ({
        id: String(n._id),
        type: n.type,
        title: n.title,
        message: n.message,
        actionUrl: n.actionUrl,
        isRead: !!n.isRead,
        timestamp: n.createdAt ? new Date(n.createdAt).getTime() : Date.now(),
        avatar: n.meta?.avatar || undefined,
      }));
      return res.json({ notifications: shaped });
    }
  } catch {}

  const store = (await loadJSON('notifications.json', { byUserId: {} })) || { byUserId: {} };
  const byUserId = store.byUserId && typeof store.byUserId === 'object' ? store.byUserId : {};
  const list = Array.isArray(byUserId[userId]) ? byUserId[userId] : [];
  return res.json({ notifications: list });
})

router.post('/:id/read', async (req, res) => {
  const id = String(req.params.id)
  const userId = String(req.user?._id || req.user?.id || req.headers['x-user-id'] || '').trim();

  try {
    const conn = await connectDb();
    if (conn && userId) {
      await Notification.updateOne({ _id: id, userId }, { $set: { isRead: true } });
      return res.json({ ok: true });
    }
  } catch {}

  const data = (await loadJSON('notifications.json', { byUserId: {} })) || { byUserId: {} }
  const byUserId = data.byUserId && typeof data.byUserId === 'object' ? data.byUserId : {}
  const list = Array.isArray(byUserId[userId || '1']) ? byUserId[userId || '1'] : []
  const idx = list.findIndex(n => String(n.id) === id)
  if (idx !== -1) list[idx] = { ...list[idx], isRead: true }
  byUserId[userId || '1'] = list
  await saveJSON('notifications.json', { byUserId })
  return res.json({ ok: true })
})

router.post('/read-all', async (_req, res) => {
  const req = _req;
  const userId = String(req.user?._id || req.user?.id || req.headers['x-user-id'] || '').trim();

  try {
    const conn = await connectDb();
    if (conn && userId) {
      await Notification.updateMany({ userId, isRead: false }, { $set: { isRead: true } });
      return res.json({ ok: true });
    }
  } catch {}

  const data = (await loadJSON('notifications.json', { byUserId: {} })) || { byUserId: {} }
  const byUserId = data.byUserId && typeof data.byUserId === 'object' ? data.byUserId : {}
  const key = userId || '1'
  const list = (Array.isArray(byUserId[key]) ? byUserId[key] : []).map(n => ({ ...n, isRead: true }))
  byUserId[key] = list
  await saveJSON('notifications.json', { byUserId })
  return res.json({ ok: true })
})

export default router
