import express from 'express';
import JournalEntry from '../models/JournalEntry.js';
import { generateResponse } from '../llm/deepseek.js';
import OpenAI from 'openai';

const router = express.Router();

async function callDeepseekJournaling(prompt) {
  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY or OPENAI_API_KEY missing');
  }

  const client = new OpenAI({
    baseURL: 'https://api.deepseek.com',
    apiKey,
  });

  const completion = await client.chat.completions.create({
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    messages: [{ role: 'user', content: prompt }],
  });

  return completion.choices?.[0]?.message?.content || '';
}

function getUserId(req) {
  return (
    req.user?.id ||
    req.user?._id ||
    req.auth?.id ||
    req.headers['x-user-id'] ||
    null
  );
}

// Get current user's journal entries (latest first)
router.get('/me', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ ok: false, error: 'not_authenticated' });

    const entries = await JournalEntry.find({ userId }).sort({ createdAt: -1 }).lean();
    return res.json({ ok: true, entries });
  } catch (e) {
    console.error('GET /api/journal/me error', e);
    return res.status(500).json({ ok: false, error: 'journal_fetch_failed' });
  }
});

// Create or update an entry
router.post('/', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ ok: false, error: 'not_authenticated' });

    const { id, title = '', content = '', mood = '', isPublic = false } = req.body || {};

    if (id) {
      const updated = await JournalEntry.findOneAndUpdate(
        { _id: id, userId },
        { title, content, mood, isPublic },
        { new: true }
      ).lean();
      if (!updated) return res.status(404).json({ ok: false, error: 'not_found' });
      return res.json({ ok: true, entry: updated });
    }

    const created = await JournalEntry.create({ userId, title, content, mood, isPublic });
    return res.json({ ok: true, entry: created });
  } catch (e) {
    console.error('POST /api/journal error', e);
    return res.status(500).json({ ok: false, error: 'journal_save_failed' });
  }
});

// Delete an entry
router.delete('/:id', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ ok: false, error: 'not_authenticated' });

    const { id } = req.params;
    const deleted = await JournalEntry.findOneAndDelete({ _id: id, userId }).lean();
    if (!deleted) return res.status(404).json({ ok: false, error: 'not_found' });
    return res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /api/journal/:id error', e);
    return res.status(500).json({ ok: false, error: 'journal_delete_failed' });
  }
});

// AI prompt helper using DeepSeek
router.post('/prompt', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ ok: false, error: 'not_authenticated' });

    const { mood = '', topic = '' } = req.body || {};
    const baseMood = (mood || '').toString().trim() || 'mixed';
    const baseTopic = (topic || '').toString().trim() || 'general reflection on the day';

    const journalingPrompt = `You are a gentle journaling coach for a social app called FaceMeX.
User mood: ${baseMood}
User topic: ${baseTopic}

Write ONE short journaling prompt (2–3 sentences) that invites calm reflection or goal setting.
Avoid giving answers. Speak directly to the user as "you".
Return only the prompt text, no JSON, no bullet points.`;

    const useLocal = String(process.env.USE_LOCAL_AI || 'true').toLowerCase() === 'true';

    let text = '';
    try {
      if (useLocal) {
        text = await generateResponse(journalingPrompt);
      } else {
        text = await callDeepseekJournaling(journalingPrompt);
      }
    } catch (e) {
      console.error('journal prompt DeepSeek error', e);
    }

    const cleaned = (text || '').toString().trim();
    if (!cleaned) {
      return res.json({
        ok: true,
        prompt:
          'Take a moment to write about something small that mattered to you today. Why did it matter, and what would you like to remember about it?',
        source: 'fallback',
      });
    }

    return res.json({ ok: true, prompt: cleaned, source: 'deepseek-local' });
  } catch (e) {
    console.error('POST /api/journal/prompt error', e);
    return res.status(500).json({ ok: false, error: 'journal_prompt_failed' });
  }
});

export default router;
