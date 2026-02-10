import SafetyLog from '../models/SafetyLog.js';

// Logs screenshot / recording attempts reported from the frontend.
export default async function screenshotGuard(req, res, next) {
  try {
    const { userId, kind = 'screenshot', context = {} } = req.body || {};
    await SafetyLog.create({
      type: kind === 'recording' ? 'screen_recording' : 'screenshot',
      userId: userId || null,
      details: context,
    });
    return next();
  } catch (e) {
    console.error('screenshotGuard error', e);
    return next();
  }
}
