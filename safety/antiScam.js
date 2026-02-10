import ScamReport from '../models/ScamReport.js';
import SafetyLog from '../models/SafetyLog.js';

// Basic keyword and rate-based anti-scam middleware.
// Expects req.body.{content, senderId, conversationId, meta}
export default async function antiScam(req, res, next) {
  try {
    const { content = '', senderId, conversationId, meta = {} } = req.body || {};
    if (!content || typeof content !== 'string') return next();

    const lower = content.toLowerCase();

    // Layer 1: simple spam / keyword checks
    const highRiskKeywords = [
      'urgent help',
      'urgent assistance',
      'investment',
      'wire transfer',
      'bank transfer',
      'western union',
      'moneygram',
      'crypto',
      'bitcoin',
      'forex',
      'wallet address',
      'gift card',
      'steam card',
      'itunes card',
      'google play card',
      'giveaway',
      'lottery',
      'winning prize',
      'you have won',
      'guaranteed profit',
      'blackmail',
    ];

    const keywordHit = highRiskKeywords.find((k) => lower.includes(k));

    // Layer 1b: explicit scam patterns using regex so we recognise structures
    // inside longer messages, not only exact keywords.
    const patternTests = [
      /send\s+(me\s+)?money/i,
      /(transfer|wire)\s+.*\s+money/i,
      /double\s+.*\s+(money|investment|returns?)/i,
      /pay\s+.*\s+(fee|charge|cost)/i,
      /(processing|transaction)\s+fee/i,
      /(winning|winner|prize).*(fee|charge|tax)/i,
      /(crypto|bitcoin|forex).*(investment|profit|return|roi)/i,
      /(gift|steam|itunes|google\s*play)\s+card/i,
      /(threaten|expose|leak).*(pictures|photos|videos|secrets)/i, // basic blackmail shape
      // Job scam shapes: paying fees for jobs or unrealistic pay
      /(pay|send).*(fee|money).*(job|position|interview|application)/i,
      /(guaranteed|secure|100%|certain).*(job|position|hiring)/i,
      /(work\s*from\s*home|remote\s*job).*(earn|make).*(per\s*(day|week|month)|\$\d+)/i,
      /(training|registration|processing).*(fee|charge).*(before|to)\s+start\s+(work|job)/i,
    ];

    const patternHit = patternTests.find((re) => re.test(content));

    // Links + money language are especially risky
    const hasUrl = /https?:\/\//i.test(content) || /www\./i.test(content);
    const hasMoneyWord = /money|fee|payment|deposit|profit|payout|bank|wallet|crypto|bitcoin/i.test(content);

    const matchedKeyword = keywordHit || (patternHit ? patternHit.source : null);

    if (matchedKeyword || patternHit || (hasUrl && hasMoneyWord)) {
      // Best-effort: try to persist reports, but do not depend on DB for safety.
      try {
        await ScamReport.create({
          senderId: senderId || null,
          conversationId: conversationId || null,
          content,
          matchedKeyword,
          layer: 'L1-keyword',
          meta,
        });

        await SafetyLog.create({
          type: 'scam_keyword_block',
          userId: senderId || null,
          details: { matchedKeyword, conversationId, meta },
        });
      } catch (err) {
        console.error('antiScam DB logging error', err);
      }

      return res.status(403).json({
        ok: false,
        reason: 'potential_scam',
        message: 'This message looks like a potential scam and was blocked for your safety.',
      });
    }

    // TODO: more advanced layers (behaviour patterns, AI model, etc.)
    return next();
  } catch (e) {
    console.error('antiScam middleware error', e);
    return next();
  }
}
