import { Router } from 'express'
import { loadJSON, saveJSON } from '../utils/jsonStore.js'

const router = Router()

// Simple JSON-backed store for real-life reaction clips
// Structure: { reactions: [{ id, postId, userId, type, mediaUrl, createdAt }] }

router.get('/', async (req, res) => {
  const postId = String(req.query.postId || '').trim()
  const data = (await loadJSON('reactions.json', { reactions: [] })) || { reactions: [] }
  const list = Array.isArray(data.reactions) ? data.reactions : []
  const filtered = postId ? list.filter(r => r.postId === postId) : list
  res.json({ reactions: filtered })
})

router.post('/media', async (req, res) => {
  const { postId, type = 'like', mediaUrl } = req.body || {}
  if (!postId || !mediaUrl) return res.status(400).json({ error: 'postId_and_mediaUrl_required' })
  const data = (await loadJSON('reactions.json', { reactions: [] })) || { reactions: [] }
  const list = Array.isArray(data.reactions) ? data.reactions : []
  const item = {
    id: `rr${Date.now()}`,
    postId: String(postId),
    userId: '1', // demo
    type: String(type || 'like'),
    mediaUrl: String(mediaUrl),
    createdAt: new Date().toISOString(),
  }
  list.unshift(item)
  await saveJSON('reactions.json', { reactions: list })
  res.status(201).json(item)
})

export default router
