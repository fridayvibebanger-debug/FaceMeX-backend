import ScamReport from '../models/ScamReport.js';
import SafetyLog from '../models/SafetyLog.js';
import { getAIClient } from './helpers.js';

// AI-based ethics / abuse detection middleware for text content.
export default async function aiEthics(req, res, next) {
  try {
    const { content = '', senderId, conversationId, meta = {} } = req.body || {};
    if (!content || typeof content !== 'string') return next();

    const ai = await getAIClient();
    if (!ai) return next();

    const prompt = `You are a safety classifier. Analyse the following message and return a JSON object with keys: {"is_abusive": boolean, "is_impersonation": boolean, "is_scam": boolean, "is_extreme": boolean, "category": string, "reason": string}. Message: "${content}"`;

    const result = await ai(prompt);

    if (!result || typeof result !== 'object') return next();

    if (result.is_scam || result.is_abusive || result.is_impersonation || result.is_extreme) {
      await ScamReport.create({
        senderId: senderId || null,
        conversationId: conversationId || null,
        content,
        matchedKeyword: result.category || 'ai_flag',
        layer: 'L3-ai-ethics',
        meta: { ...meta, ai: result },
      });

      await SafetyLog.create({
        type: 'ai_ethics_block',
        userId: senderId || null,
        details: { conversationId, meta, ai: result },
      });

      // Block extreme content completely
      if (result.is_extreme) {
        return res.status(403).json({
          ok: false,
          reason: 'ai_ethics_block',
          message: 'This content violates FaceMeX safety policies and was blocked.',
        });
      }
    }

    return next();
  } catch (e) {
    console.error('aiEthics middleware error', e);
    return next();
  }
}
