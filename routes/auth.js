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
