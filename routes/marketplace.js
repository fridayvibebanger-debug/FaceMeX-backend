import express from 'express';
import { loadJSON, saveJSON } from '../utils/jsonStore.js';

const router = express.Router();

const tierOrder = { free: 0, pro: 1, creator: 2, business: 3, exclusive: 4 };
function toStr(v) {
  return v == null ? '' : String(v);
}

function getUserId(req) {
  return toStr(req.headers['x-user-id'] || '').trim();
}

function getUserTier(req) {
  return toStr(req.headers['x-user-tier'] || 'free').trim();
}

function hasTier(tier, min) {
  return (tierOrder[tier] ?? 0) >= (tierOrder[min] ?? 0);
}

function sanitizeAdMedia(media) {
  const arr = Array.isArray(media) ? media : [];
  return arr
    .map((m) => {
      const url = toStr(m?.url).trim();
      const type = m?.type === 'video' ? 'video' : 'image';
      if (!url) return null;
      const ok =
        url.startsWith('https://') ||
        url.startsWith('http://') ||
        url.startsWith('data:image/') ||
        url.startsWith('data:video/');
      if (!ok) return null;
      return { type, url };
    })
    .filter(Boolean)
    .slice(0, 8);
}

async function loadAds() {
  return (await loadJSON('marketplace_ads.json', { ads: [] })) || { ads: [] };
}

async function saveAds(data) {
  await saveJSON('marketplace_ads.json', data);
}

router.get('/ads', async (_req, res) => {
  const data = await loadAds();
  const ads = Array.isArray(data.ads) ? data.ads : [];
  const active = ads.filter((a) => a.status === 'active');
  active.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  res.json(active.slice(0, 50));
});

router.get('/ads/mine', async (req, res) => {
  const userId = getUserId(req);
  const tier = getUserTier(req);
  if (!hasTier(tier, 'business')) return res.status(403).json({ error: 'tier_required', required: 'business' });
  if (!userId) return res.status(401).json({ error: 'unauthorized', message: 'missing x-user-id' });

  const data = await loadAds();
  const ads = Array.isArray(data.ads) ? data.ads : [];
  const mine = ads.filter((a) => a.creatorId === userId && a.status !== 'deleted');
  mine.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  res.json(mine);
});

router.post('/ads', async (req, res) => {
  const userId = getUserId(req);
  const tier = getUserTier(req);
  if (!hasTier(tier, 'business')) return res.status(403).json({ error: 'tier_required', required: 'business' });
  if (!userId) return res.status(401).json({ error: 'unauthorized', message: 'missing x-user-id' });

  const title = toStr(req.body?.title).trim();
  const description = toStr(req.body?.description).trim();
  const websiteUrl = toStr(req.body?.websiteUrl || req.body?.website_url).trim();
  const media = sanitizeAdMedia(req.body?.media);

  if (!title || !description) return res.status(400).json({ error: 'missing_fields' });

  const now = new Date().toISOString();
  const ad = {
    id: `mad${Date.now()}`,
    creatorId: userId,
    creatorTier: tier,
    title,
    description,
    websiteUrl: websiteUrl || null,
    media,
    status: 'active',
    createdAt: now,
  };

  const data = await loadAds();
  const ads = Array.isArray(data.ads) ? data.ads : [];
  const next = { ads: [ad, ...ads] };
  await saveAds(next);

  res.status(201).json(ad);
});

router.patch('/ads/:id', async (req, res) => {
  const userId = getUserId(req);
  const tier = getUserTier(req);
  if (!hasTier(tier, 'business')) return res.status(403).json({ error: 'tier_required', required: 'business' });
  if (!userId) return res.status(401).json({ error: 'unauthorized', message: 'missing x-user-id' });

  const id = toStr(req.params?.id).trim();
  const desired = toStr(req.body?.status).trim();
  const nextStatus = desired === 'paused' ? 'paused' : desired === 'active' ? 'active' : '';
  if (!id) return res.status(400).json({ error: 'missing_fields' });
  if (!nextStatus) return res.status(400).json({ error: 'invalid_status', allowed: ['active', 'paused'] });

  const data = await loadAds();
  const ads = Array.isArray(data.ads) ? data.ads : [];
  const idx = ads.findIndex((a) => a.id === id);
  if (idx === -1 || ads[idx].status === 'deleted') return res.status(404).json({ error: 'not_found' });
  if (ads[idx].creatorId !== userId) return res.status(403).json({ error: 'forbidden' });

  ads[idx] = { ...ads[idx], status: nextStatus };
  await saveAds({ ads });
  res.json({ id, status: nextStatus });
});

router.delete('/ads/:id', async (req, res) => {
  const userId = getUserId(req);
  const tier = getUserTier(req);
  if (!hasTier(tier, 'business')) return res.status(403).json({ error: 'tier_required', required: 'business' });
  if (!userId) return res.status(401).json({ error: 'unauthorized', message: 'missing x-user-id' });

  const id = toStr(req.params?.id).trim();
  if (!id) return res.status(400).json({ error: 'missing_fields' });

  const data = await loadAds();
  const ads = Array.isArray(data.ads) ? data.ads : [];
  const idx = ads.findIndex((a) => a.id === id);
  if (idx === -1 || ads[idx].status === 'deleted') return res.status(404).json({ error: 'not_found' });
  if (ads[idx].creatorId !== userId) return res.status(403).json({ error: 'forbidden' });

  ads[idx] = { ...ads[idx], status: 'deleted' };
  await saveAds({ ads });
  res.status(204).send();
});

export default router;
