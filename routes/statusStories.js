import express from 'express';
import StatusStory from '../models/StatusStory.js';
import { connectDb } from '../lib/db.js';

const router = express.Router();

function getUserId(req) {
  return (
    req.user?.id ||
    req.user?._id ||
    req.auth?.id ||
    req.headers['x-user-id'] ||
    null
  );
}

function getUserName(req) {
  return (
    req.user?.name ||
    req.user?.username ||
    req.headers['x-user-name'] ||
    'User'
  );
}

function getUserAvatar(req) {
  return req.user?.avatar || req.headers['x-user-avatar'] || '';
}

// GET /api/status-stories - list non-expired stories
router.get('/', async (_req, res) => {
  try {
    const conn = await connectDb();
    if (!conn) {
      return res.json({ ok: false, error: 'db_unavailable', stories: [] });
    }

    const now = new Date();
    const stories = await StatusStory.find({ expiresAt: { $gt: now } })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    res.json({ ok: true, stories });
  } catch (e) {
    console.error('GET /api/status-stories error', e);
    res.status(500).json({ ok: false, error: 'status_stories_fetch_failed' });
  }
});

// POST /api/status-stories - create a new status story
router.post('/', async (req, res) => {
  try {
    const conn = await connectDb();
    if (!conn) {
      return res.status(500).json({ ok: false, error: 'db_unavailable' });
    }

    const { mediaUrl, mediaType } = req.body || {};
    if (!mediaUrl || !mediaType) {
      return res.status(400).json({ ok: false, error: 'media_required' });
    }

    const userId = getUserId(req) || '1';
    const userName = getUserName(req);
    const userAvatar = getUserAvatar(req);

    const ttlMs = 24 * 60 * 60 * 1000; // 24 hours
    const expiresAt = new Date(Date.now() + ttlMs);

    const story = await StatusStory.create({
      userId,
      userName,
      userAvatar,
      mediaUrl,
      mediaType,
      expiresAt,
    });

    res.json({ ok: true, story });
  } catch (e) {
    console.error('POST /api/status-stories error', e);
    res.status(500).json({ ok: false, error: 'status_stories_create_failed' });
  }
});

export default router;
