import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { Payment } from '../models/Payment.js';
import { User } from '../models/User.js';
import { connectDb } from '../lib/db.js';

const router = Router();

// Helper: choose server-side YOCO link env for a tier
function getYocoEnvForTier(tier) {
  if (!tier) return process.env.YOCO_PAYMENT_URL_PROMO || process.env.YOCO_PAYMENT_URL_PROMO || '';
  const t = String(tier).toLowerCase();
  switch (t) {
    case 'pro':
      return process.env.YOCO_PAYMENT_URL_PRO || process.env.VITE_YOCO_PAYMENT_URL_PRO || '';
    case 'creator':
      return process.env.YOCO_PAYMENT_URL_CREATOR || process.env.VITE_YOCO_PAYMENT_URL_CREATOR || '';
    case 'business':
      return process.env.YOCO_PAYMENT_URL_BUSINESS || process.env.VITE_YOCO_PAYMENT_URL_BUSINESS || '';
    case 'exclusive':
      return process.env.YOCO_PAYMENT_URL_EXCLUSIVE || process.env.VITE_YOCO_PAYMENT_URL_EXCLUSIVE || '';
    case 'verified':
      return process.env.YOCO_PAYMENT_URL_VERIFIED || process.env.VITE_YOCO_PAYMENT_URL_VERIFIED || '';
    default:
      return process.env.YOCO_PAYMENT_URL_PROMO || process.env.VITE_YOCO_PAYMENT_LINK || '';
  }
}

// Initiate a payment. Creates a Payment record and returns a redirect URL.
router.post('/initiate', requireAuth, async (req, res) => {
  try {
    await connectDb();
    const user = req.user;
    const { tier, amountZar, metadata = {} } = req.body || {};

    const payment = await Payment.create({
      user: user._id,
      tier: tier || metadata?.tier || null,
      amount: amountZar || metadata?.amountZar || null,
      currency: 'ZAR',
      metadata,
      status: 'pending',
    });

    // If server has YOCO secret configured, try creating a checkout session server-side
    if (process.env.YOCO_SECRET_KEY) {
      try {
        const successUrl = `${process.env.CLIENT_ORIGIN || ''}/media-shop?promoPaid=1&paymentId=${payment._id}`;
        const cancelUrl = `${process.env.CLIENT_ORIGIN || ''}/media-shop?promoCancel=1&paymentId=${payment._id}`;
        const payload = {
          amount: Number(payment.amount) || 0,
          currency: 'ZAR',
          successUrl,
          cancelUrl,
          metadata: payment.metadata || null,
          externalId: payment._id.toString(),
        };
        const r = await fetch('https://payments.yoco.com/api/checkouts', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.YOCO_SECRET_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          // fallback to env link
          throw new Error(data?.message || 'yoco_failed');
        }
        payment.providerPaymentId = data?.id || data?.externalId || payment._id.toString();
        payment.redirectUrl = data?.redirectUrl || '';
        await payment.save();
        return res.status(201).json({ redirectUrl: payment.redirectUrl, id: payment._id });
      } catch (e) {
        // ignore and fall through to env-link fallback
      }
    }

    // Fallback: use pre-built hosted payment link env var for the tier
    const envUrl = getYocoEnvForTier(payment.tier || 'promo');
    if (!envUrl) {
      return res.status(400).json({ error: 'no_payment_provider_configured' });
    }

    const sep = envUrl.includes('?') ? '&' : '?';
    const redirectUrl = `${envUrl}${sep}paymentId=${payment._id}&userId=${user._id}`;
    payment.redirectUrl = redirectUrl;
    await payment.save();
    return res.status(201).json({ redirectUrl, id: payment._id });
  } catch (err) {
    console.error('payments/initiate error', err?.message || err);
    return res.status(500).json({ error: 'server_error', message: err?.message || String(err) });
  }
});

// Confirm endpoint: mark payment as completed when provider or client confirms
router.get('/confirm', async (req, res) => {
  try {
    await connectDb();
    const { paymentId, status } = req.query || {};
    if (!paymentId) return res.status(400).json({ error: 'missing_paymentId' });

    const payment = await Payment.findById(paymentId);
    if (!payment) return res.status(404).json({ error: 'not_found' });

    const s = String(status || '').toLowerCase();
    if (s === 'failed' || s === 'cancelled') {
      payment.status = s === 'failed' ? 'failed' : 'cancelled';
      await payment.save();
      return res.json({ ok: true, payment });
    }

    payment.status = 'completed';
    await payment.save();

    // Activate user tier/addons based on payment
    try {
      if (payment.tier && ['pro', 'creator', 'business', 'exclusive'].includes(String(payment.tier).toLowerCase())) {
        await User.findByIdAndUpdate(payment.user, { tier: payment.tier });
      }
      // Verified badge activation
      if (String(payment.tier).toLowerCase() === 'verified' || payment.metadata?.feature === 'verified-badge') {
        await User.findByIdAndUpdate(payment.user, { $set: { 'addons.verified': true } });
      }
    } catch (e) {
      console.error('Error activating user after payment confirm', e?.message || e);
    }

    return res.json({ ok: true, payment });
  } catch (err) {
    console.error('payments/confirm error', err?.message || err);
    return res.status(500).json({ error: 'server_error' });
  }
});

// Generic webhook endpoint for providers to notify us of payment events
router.post('/webhook', async (req, res) => {
  try {
    await connectDb();
    const body = req.body || {};
    // Support Yoco webhook payloads that reference an externalId or checkout id
    const paymentId = body?.externalId || body?.paymentId || body?.id || body?.data?.externalId;
    const status = (body?.status || body?.event || '').toString().toLowerCase();
    if (!paymentId) return res.status(200).send('ok');

    const payment = await Payment.findById(paymentId) || (await Payment.findOne({ providerPaymentId: paymentId }));
    if (!payment) return res.status(200).send('ok');

    if (status.includes('success') || status.includes('completed') || status.includes('paid')) {
      payment.status = 'completed';
      await payment.save();
      try {
        if (payment.tier && ['pro', 'creator', 'business', 'exclusive'].includes(String(payment.tier).toLowerCase())) {
          await User.findByIdAndUpdate(payment.user, { tier: payment.tier });
        }
        if (String(payment.tier).toLowerCase() === 'verified' || payment.metadata?.feature === 'verified-badge') {
          await User.findByIdAndUpdate(payment.user, { $set: { 'addons.verified': true } });
        }
      } catch (e) {}
    } else if (status.includes('fail') || status.includes('cancel')) {
      payment.status = 'failed';
      await payment.save();
    }

    return res.status(200).send('ok');
  } catch (err) {
    console.error('payments/webhook error', err?.message || err);
    return res.status(500).send('error');
  }
});

export default router;
