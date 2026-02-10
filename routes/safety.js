import express from 'express';
import ScamReport from '../models/ScamReport.js';
import SafetyLog from '../models/SafetyLog.js';
import UserSafety from '../models/UserSafety.js';
import IdentityVerification from '../models/IdentityVerification.js';
import { safetyMiddleware } from '../safety/index.js';

const router = express.Router();

// Helper to get user id from auth middleware if present
function getUserId(req) {
  // Your existing auth uses JWT + middleware/ auth.js; here we just
  // check common locations without breaking if unauthenticated.
  return (
    req.user?.id ||
    req.user?._id ||
    req.auth?.id ||
    req.headers['x-user-id'] ||
    null
  );
}

// Scan a message via antiScam + aiEthics layers
router.post('/scan-message', safetyMiddleware.antiScam, safetyMiddleware.aiEthics, async (req, res) => {
  // If we reached here, message passed safety checks.
  return res.json({ ok: true, safe: true });
});

// Log screenshot / recording attempts
router.post('/screenshot-log', safetyMiddleware.screenshotGuard, async (req, res) => {
  return res.json({ ok: true });
});

// Identity verification endpoint
router.post('/verify-identity', safetyMiddleware.verifyIdentity);

// Simple trust summary for current user
router.get('/trust', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ ok: false, error: 'not_authenticated' });

    const safety = await UserSafety.findOne({ userId }).lean();
    const verifications = await IdentityVerification.find({ userId }).sort({ createdAt: -1 }).lean();

    const accountAgeDays = safety?.createdAt
      ? Math.floor((Date.now() - new Date(safety.createdAt).getTime()) / (1000 * 60 * 60 * 24))
      : null;

    const trustScoreBase = 80;
    const penaltyWarnings = (safety?.warningsCount || 0) * 5;
    const penaltyBans = (safety?.bansCount || 0) * 20;
    const trustScore = Math.max(0, trustScoreBase - penaltyWarnings - penaltyBans);

    res.json({
      ok: true,
      trust: {
        userId,
        accountAgeDays,
        scamFreeHistory: safety?.scamFreeCount || 0,
        warnings: safety?.warningsCount || 0,
        bans: safety?.bansCount || 0,
        trustScore,
        devices: safety?.devices || [],
        lastVerification: verifications[0] || null,
      },
    });
  } catch (e) {
    console.error('GET /api/safety/trust error', e);
    res.status(500).json({ ok: false, error: 'trust_fetch_failed' });
  }
});

// Recent safety logs for current user
router.get('/logs', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ ok: false, error: 'not_authenticated' });

    const logs = await SafetyLog.find({ userId }).sort({ createdAt: -1 }).limit(100).lean();
    res.json({ ok: true, logs });
  } catch (e) {
    console.error('GET /api/safety/logs error', e);
    res.status(500).json({ ok: false, error: 'logs_fetch_failed' });
  }
});

// Community report endpoint for Layer 4 (Community Shield)
router.post('/report-scam', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { content = '', conversationId, meta = {} } = req.body || {};

    await ScamReport.create({
      senderId: userId,
      conversationId: conversationId || null,
      content,
      layer: 'L4-community',
      meta,
    });

    await SafetyLog.create({
      type: 'user_report_scam',
      userId: userId || null,
      details: { conversationId, meta },
    });

    res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/safety/report-scam error', e);
    res.status(500).json({ ok: false, error: 'report_failed' });
  }
});

export default router;
