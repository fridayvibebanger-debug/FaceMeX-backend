import { Router } from 'express';
import { getMe, setMe } from '../utils/userStore.js';

const router = Router();

function isStripeConfigured() {
  return !!process.env.STRIPE_SECRET_KEY;
}

async function getStripe() {
  if (!isStripeConfigured()) return null;
  try {
    const mod = await import('stripe');
    const Stripe = mod.default || mod;
    return new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
  } catch (_e) {
    return null;
  }
}

function isYocoConfigured() {
  return !!process.env.YOCO_SECRET_KEY;
}

// Create Checkout Session for subscriptions or one-off purchases
router.post('/checkout', async (req, res) => {
  const stripe = await getStripe();
  if (!stripe) return res.status(400).json({ error: 'stripe_not_configured' });

  const { priceId, mode = 'subscription', successUrl, cancelUrl, quantity = 1, metadata = {} } = req.body || {};
  if (!priceId || !successUrl || !cancelUrl) return res.status(400).json({ error: 'missing_params' });

  try {
    const session = await stripe.checkout.sessions.create({
      mode,
      line_items: [{ price: priceId, quantity }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata,
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
    });
    return res.status(201).json({ id: session.id, url: session.url });
  } catch (e) {
    return res.status(500).json({ error: 'stripe_error', message: e?.message || String(e) });
  }
});

router.post('/yoco/checkout', async (req, res) => {
  if (!isYocoConfigured()) return res.status(400).json({ error: 'yoco_not_configured' });

  const {
    amountZar,
    amount,
    currency = 'ZAR',
    successUrl,
    cancelUrl,
    failureUrl,
    metadata,
    externalId,
  } = req.body || {};

  const amountCents = Number.isFinite(Number(amount))
    ? Math.round(Number(amount))
    : Math.round(Number(amountZar || 0) * 100);

  if (!amountCents || amountCents <= 0) return res.status(400).json({ error: 'missing_amount' });
  if (!successUrl || !cancelUrl) return res.status(400).json({ error: 'missing_params' });

  try {
    const payload = {
      amount: amountCents,
      currency,
      successUrl,
      cancelUrl,
      failureUrl: failureUrl || cancelUrl,
      metadata: metadata || null,
      externalId: externalId || null,
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
      return res.status(500).json({ error: 'yoco_error', message: data?.message || data?.error || 'yoco_checkout_failed' });
    }

    return res.status(201).json({ id: data?.id, redirectUrl: data?.redirectUrl });
  } catch (e) {
    return res.status(500).json({ error: 'yoco_error', message: e?.message || String(e) });
  }
});

// Create Customer Portal session (manage subscription)
router.post('/portal', async (req, res) => {
  const stripe = await getStripe();
  if (!stripe) return res.status(400).json({ error: 'stripe_not_configured' });

  const { customerId, returnUrl } = req.body || {};
  if (!customerId || !returnUrl) return res.status(400).json({ error: 'missing_params' });

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return res.status(201).json({ url: session.url });
  } catch (e) {
    return res.status(500).json({ error: 'stripe_error', message: e?.message || String(e) });
  }
});

// Webhook stub (no signature verification if secret not set)
router.post('/webhook', async (req, res) => {
  if (!isStripeConfigured()) return res.status(200).send('ok');
  // In a real setup, enable raw body parsing and verify signature via STRIPE_WEBHOOK_SECRET
  // For now, accept events without processing.
  return res.status(200).send('ok');
});

export default router;

// Dev mode helpers (no Stripe required)
router.post('/dev/upgrade', (req, res) => {
  const { tier = 'pro' } = req.body || {};
  const allowed = ['free', 'pro', 'creator', 'business', 'exclusive'];
  if (!allowed.includes(tier)) return res.status(400).json({ error: 'invalid_tier' });
  const updated = setMe({ tier });
  return res.json({ ok: true, me: updated });
});

router.post('/dev/addon', (req, res) => {
  const { verified } = req.body || {};
  const me = getMe();
  const updated = setMe({ addons: { ...me.addons, ...(typeof verified === 'boolean' ? { verified } : {}) } });
  return res.json({ ok: true, me: updated });
});

router.post('/dev/reset', (_req, res) => {
  const reset = setMe({ tier: 'free', addons: { verified: false } });
  return res.json({ ok: true, me: reset });
});
