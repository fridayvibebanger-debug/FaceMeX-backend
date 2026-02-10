import { Router } from 'express'
import { loadJSON, saveJSON } from '../utils/jsonStore.js'

const router = Router()

// In this demo, notifications are stored for the single demo user in data/notifications.json
// Shape: { notifications: [{ id, type, title, message, actionUrl, isRead, timestamp }] }

router.get('/', async (_req, res) => {
  const data = (await loadJSON('notifications.json', { notifications: [] })) || { notifications: [] }
  res.json({ notifications: data.notifications || [] })
})

router.post('/:id/read', async (req, res) => {
  const id = String(req.params.id)
  const data = (await loadJSON('notifications.json', { notifications: [] })) || { notifications: [] }
  const list = Array.isArray(data.notifications) ? data.notifications : []
  const idx = list.findIndex(n => String(n.id) === id)
  if (idx !== -1) list[idx] = { ...list[idx], isRead: true }
  await saveJSON('notifications.json', { notifications: list })
  res.json({ ok: true })
})

router.post('/read-all', async (_req, res) => {
  const data = (await loadJSON('notifications.json', { notifications: [] })) || { notifications: [] }
  const list = (Array.isArray(data.notifications) ? data.notifications : []).map(n => ({ ...n, isRead: true }))
  await saveJSON('notifications.json', { notifications: list })
  res.json({ ok: true })
})

export default router
