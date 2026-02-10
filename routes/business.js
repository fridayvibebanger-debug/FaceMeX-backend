import { Router } from 'express';

const router = Router();

// Mock create campaign endpoint
router.post('/dev/campaigns', (req, res) => {
  const { name = 'Untitled Campaign', budget = 0, schedule = 'ASAP' } = req.body || {};
  const id = Math.random().toString(36).slice(2, 10);
  const createdAt = new Date().toISOString();
  return res.json({
    ok: true,
    campaign: {
      id,
      name,
      budget: Number(budget) || 0,
      schedule,
      status: 'draft',
      createdAt,
      metrics: { impressions: 0, clicks: 0, ctr: 0 },
    },
    message: 'Campaign draft created.',
  });
});

// Mock ad manager estimates endpoint
router.post('/dev/ads/estimate', (req, res) => {
  const { audience = 'general', objective = 'awareness', dailyBudget = 100 } = req.body || {};
  const reach = Math.round((Number(dailyBudget) || 100) * 1200);
  const cpm = 50 + Math.round(Math.random() * 50);
  const estimates = {
    audience,
    objective,
    dailyBudget: Number(dailyBudget) || 100,
    estimatedReach: reach,
    estimatedCPM: cpm,
    suggestions: [
      `Use short hooks tailored to ${audience}.`,
      'Test 3 creatives and rotate daily.',
      `Optimize for ${objective} after 3 days based on performance.`,
    ],
  };
  return res.json({ ok: true, estimates });
});

export default router;
