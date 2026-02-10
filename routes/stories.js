import express from 'express';
import StoryRoom from '../models/StoryRoom.js';
import { connectDb } from '../lib/db.js';

const router = express.Router();

let inMemoryRooms = [];

function getUserId(req) {
  return (
    req.user?.id ||
    req.user?._id ||
    req.auth?.id ||
    req.headers['x-user-id'] ||
    null
  );
}

// List recent rooms
router.get('/', async (_req, res) => {
  try {
    const conn = await connectDb();
    if (!conn) {
      const rooms = [...inMemoryRooms].sort((a, b) => b.createdAt - a.createdAt).slice(0, 50);
      return res.json({ ok: true, rooms });
    }

    const rooms = await StoryRoom.find().sort({ createdAt: -1 }).limit(50).lean();
    res.json({ ok: true, rooms });
  } catch (e) {
    console.error('GET /api/stories error', e);
    res.status(500).json({ ok: false, error: 'stories_fetch_failed' });
  }
});

// Create a new room
router.post('/', async (req, res) => {
  try {
    const conn = await connectDb();
    const { title = '' } = req.body || {};
    const trimmed = title.toString().trim() || 'Untitled Story';
    const code = `S${Date.now().toString(36).toUpperCase()}`;

    if (!conn) {
      const room = {
        _id: Date.now().toString(),
        title: trimmed,
        code,
        createdBy: getUserId(req) || null,
        steps: [],
        createdAt: new Date(),
      };
      inMemoryRooms.unshift(room);
      return res.json({ ok: true, room });
    }

    const room = await StoryRoom.create({
      title: trimmed,
      code,
      createdBy: getUserId(req) || null,
      steps: [],
    });

    res.json({ ok: true, room });
  } catch (e) {
    console.error('POST /api/stories error', e);
    res.status(500).json({ ok: false, error: 'stories_create_failed' });
  }
});

// Get single room
router.get('/:code', async (req, res) => {
  try {
    const conn = await connectDb();
    const { code } = req.params;
    if (!conn) {
      const room = inMemoryRooms.find((r) => r.code === code);
      if (!room) return res.status(404).json({ ok: false, error: 'not_found' });
      return res.json({ ok: true, room });
    }

    const room = await StoryRoom.findOne({ code }).lean();
    if (!room) return res.status(404).json({ ok: false, error: 'not_found' });
    res.json({ ok: true, room });
  } catch (e) {
    console.error('GET /api/stories/:code error', e);
    res.status(500).json({ ok: false, error: 'stories_room_failed' });
  }
});

// Append a new step (line) to a story
router.post('/:code/steps', async (req, res) => {
  try {
    const conn = await connectDb();
    const { code } = req.params;
    const { text = '' } = req.body || {};
    const line = text.toString().trim();
    if (!line) return res.status(400).json({ ok: false, error: 'text_required' });

    const step = { userId: getUserId(req) || null, text: line, createdAt: new Date() };

    if (!conn) {
      const roomIndex = inMemoryRooms.findIndex((r) => r.code === code);
      if (roomIndex === -1) return res.status(404).json({ ok: false, error: 'not_found' });
      const room = inMemoryRooms[roomIndex];
      room.steps.push(step);
      return res.json({ ok: true, room, step });
    }

    const room = await StoryRoom.findOneAndUpdate(
      { code },
      { $push: { steps: step } },
      { new: true }
    ).lean();

    if (!room) return res.status(404).json({ ok: false, error: 'not_found' });
    res.json({ ok: true, room, step });
  } catch (e) {
    console.error('POST /api/stories/:code/steps error', e);
    res.status(500).json({ ok: false, error: 'stories_step_failed' });
  }
});

export default router;
