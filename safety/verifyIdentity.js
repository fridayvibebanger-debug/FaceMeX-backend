import IdentityVerification from '../models/IdentityVerification.js';
import { getAIClient } from './helpers.js';

// Simple identity verification handler middleware used by /api/safety/verify-identity
export default async function verifyIdentity(req, res, next) {
  try {
    const { userId, imageUrl, documentType } = req.body || {};
    if (!userId || !imageUrl) return res.status(400).json({ ok: false, error: 'user_id_and_image_required' });

    const ai = await getAIClient();
    let aiResult = null;
    if (ai) {
      const prompt = `You are an identity verification assistant. A user uploaded an ID image at URL: ${imageUrl}. You cannot access the URL, but classify based on the description only: is this likely a real ID document photo or manipulated / fake? Respond as JSON: {"is_valid": boolean, "is_fake": boolean, "reason": string}.`;
      try {
        aiResult = await ai(prompt);
      } catch (err) {
        console.error('verifyIdentity AI error', err);
        aiResult = null;
      }
    }

    const record = await IdentityVerification.create({
      userId,
      imageUrl,
      documentType: documentType || 'id',
      // DEV/DEMO: auto-approve unless AI explicitly flags as fake
      status: aiResult?.is_fake ? 'rejected' : 'approved',
      aiResult,
    });

    return res.json({ ok: true, verification: record });
  } catch (e) {
    console.error('verifyIdentity error', e);
    return res.status(500).json({ ok: false, error: 'verify_identity_failed' });
  }
}
