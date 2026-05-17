import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { getMe, setMe } from '../utils/userStore.js';

const router = Router();

const ALLOWED_TIERS = ['free', 'pro', 'creator', 'business', 'exclusive'];
const PAID_STATUSES = ['succeeded', 'successful', 'paid', 'complete', 'completed'];

function isYocoConfigured() {
  return !!process.env.YOCO_SECRET_KEY;
}

function isStripeConfigured() {
  return !!process.env.STRIPE_SECRET_KEY;
}

function cleanTier(value = 'pro', allowFree = false) {
  const tier = String(value || 'pro').toLowerCase().trim();

  if (!ALLOWED_TIERS.includes(tier)) {
    throw new Error(`Invalid tier: ${tier}`);
  }

  if (!allowFree && tier === 'free') {
    throw new Error('Cannot upgrade to free tier');
  }

  return tier;
}

function isPaidStatus(status) {
  return PAID_STATUSES.includes(String(status || '').toLowerCase().trim());
}

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) return null;

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function getStripe() {
  if (!isStripeConfigured()) return null;

  try {
    const mod = await import('stripe');
    const Stripe = mod.default || mod;

    return new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2024-06-20',
    });
  } catch {
    return null;
  }
}

async function getUserIdFromRequest(req) {
  const userId =
    req.body?.userId ||
    req.body?.user_id ||
    req.headers['x-user-id'] ||
    req.query?.userId ||
    req.query?.user_id;

  return userId ? String(userId) : '';
}

async function upgradeTier({
  userId,
  email,
  tier,
  provider = 'manual',
  checkoutId,
  amountZar,
  metadata = {},
}) {
  const clean = cleanTier(tier);
  const supabase = getSupabaseAdmin();

  if (!userId && !email) {
    throw new Error('Missing userId or email for tier upgrade');
  }

  const updatePayload = {
    tier: clean,
    subscription_tier: clean,
    subscription_status: 'active',
    subscription_provider: provider,
    subscription_updated_at: new Date().toISOString(),
    subscription_expires_at: null,
    last_payment_checkout_id: checkoutId || null,
    last_payment_amount_zar:
      typeof amountZar === 'number' && Number.isFinite(amountZar)
        ? amountZar
        : null,
    last_payment_metadata: metadata || {},
  };

  if (supabase) {
    let query = supabase.from('profiles').update(updatePayload);

    if (userId) {
      query = query.eq('id', userId);
    } else {
      query = query.eq('email', email);
    }

    const { data, error } = await query.select('*');

    if (error) {
      throw new Error(error.message);
    }

    if (!data || data.length === 0) {
      let fallbackQuery = supabase.from('profiles').update(updatePayload);

      if (userId) {
        fallbackQuery = fallbackQuery.eq('user_id', userId);
      } else {
        fallbackQuery = fallbackQuery.eq('email', email);
      }

      const fallback = await fallbackQuery.select('*');

      if (fallback.error) {
        throw new Error(fallback.error.message);
      }

      if (!fallback.data || fallback.data.length === 0) {
        throw new Error('No matching profile found to upgrade');
      }

      return {
        ok: true,
        tier: clean,
        profile: fallback.data[0],
      };
    }

    return {
      ok: true,
      tier: clean,
      profile: data[0],
    };
  }

  const updated = setMe({ tier: clean });

  return {
    ok: true,
    tier: clean,
    profile: updated,
  };
}

router.get('/health', (_req, res) => {
  return res.json({
    ok: true,
    yocoConfigured: isYocoConfigured(),
    stripeConfigured: isStripeConfigured(),
    supabaseAdminConfigured: !!getSupabaseAdmin(),
  });
});

/**
 * Create Yoco Checkout
 * Use this for automatic tier upgrade.
 */
router.post('/yoco/checkout', async (req, res) => {
  if (!isYocoConfigured()) {
    return res.status(400).json({ error: 'yoco_not_configured' });
  }

  const {
    amountZar,
    amount,
    currency = 'ZAR',
    successUrl,
    cancelUrl,
    failureUrl,
    metadata = {},
    externalId,
  } = req.body || {};

  const amountCents = Number.isFinite(Number(amount))
    ? Math.round(Number(amount))
    : Math.round(Number(amountZar || 0) * 100);

  if (!amountCents || amountCents <= 0) {
    return res.status(400).json({ error: 'missing_amount' });
  }

  if (!successUrl || !cancelUrl) {
    return res.status(400).json({ error: 'missing_params' });
  }

  try {
    const payload = {
      amount: amountCents,
      currency,
      successUrl,
      cancelUrl,
      failureUrl: failureUrl || cancelUrl,
      metadata,
      externalId: externalId || `facemex-${Date.now()}`,
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
      return res.status(500).json({
        error: 'yoco_error',
        message: data?.message || data?.error || 'yoco_checkout_failed',
      });
    }

    return res.status(201).json({
      id: data?.id,
      redirectUrl: data?.redirectUrl,
      status: data?.status,
    });
  } catch (e) {
    return res.status(500).json({
      error: 'yoco_error',
      message: e?.message || String(e),
    });
  }
});

/**
 * Manual Yoco verification after redirect.
 * Call this from your success page if webhook is delayed.
 */
router.post('/yoco/verify', async (req, res) => {
  if (!isYocoConfigured()) {
    return res.status(400).json({ error: 'yoco_not_configured' });
  }

  const { checkoutId, tier: bodyTier, userId: bodyUserId, email } = req.body || {};

  if (!checkoutId) {
    return res.status(400).json({ error: 'missing_checkout_id' });
  }

  try {
    const r = await fetch(
      `https://payments.yoco.com/api/checkouts/${checkoutId}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${process.env.YOCO_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      return res.status(500).json({
        error: 'yoco_verify_failed',
        message:
          data?.message ||
          data?.error ||
          'could_not_verify_yoco_checkout',
      });
    }

    const metadata = data.metadata || {};

    const status =
      data.status ||
      data.paymentStatus ||
      data.payment?.status ||
      data.checkoutStatus;

    if (!isPaidStatus(status)) {
      return res.json({
        ok: false,
        status,
        message: 'payment_not_confirmed_yet',
      });
    }

    const userId =
      metadata.userId ||
      metadata.user_id ||
      bodyUserId ||
      (await getUserIdFromRequest(req));

    const tier = cleanTier(metadata.tier || bodyTier || 'pro');

    const amountZar = metadata.amountZar
      ? Number(metadata.amountZar)
      : data.amount
        ? Number(data.amount) / 100
        : undefined;

    const result = await upgradeTier({
      userId,
      email: metadata.email || email,
      tier,
      provider: 'yoco',
      checkoutId,
      amountZar,
      metadata,
    });

    return res.json({
      ok: true,
      tier: result.tier,
      profile: result.profile,
    });
  } catch (e) {
    return res.status(500).json({
      error: 'yoco_verify_failed',
      message: e?.message || String(e),
    });
  }
});

/**
 * Yoco webhook.
 * Use only if Yoco sends checkout/payment event payloads to your backend.
 */
router.post('/yoco/webhook', async (req, res) => {
  try {
    const body = req.body || {};
    const eventData = body.data || body.payload || body;
    const checkoutId =
      eventData.id ||
      eventData.checkoutId ||
      eventData.checkout_id ||
      body.checkoutId;

    const metadata = eventData.metadata || body.metadata || {};

    const status =
      eventData.status ||
      eventData.paymentStatus ||
      eventData.payment?.status ||
      body.status;

    if (!isPaidStatus(status)) {
      return res.json({
        ok: true,
        ignored: true,
        status,
      });
    }

    const userId = metadata.userId || metadata.user_id;
    const email = metadata.email;
    const tier = cleanTier(metadata.tier || 'pro');

    if (!userId && !email) {
      return res.status(400).json({
        error: 'missing_user_id_or_email_in_metadata',
      });
    }

    const result = await upgradeTier({
      userId,
      email,
      tier,
      provider: 'yoco',
      checkoutId,
      amountZar: metadata.amountZar ? Number(metadata.amountZar) : undefined,
      metadata,
    });

    return res.json({
      ok: true,
      tier: result.tier,
    });
  } catch (e) {
    return res.status(400).json({
      error: 'yoco_webhook_failed',
      message: e?.message || String(e),
    });
  }
});

/**
 * Manual admin upgrade for normal Yoco Payment Link.
 * Use this if you are using a static Yoco link and checking payment manually.
 * Do not expose BILLING_ADMIN_SECRET in frontend.
 */
router.post('/manual/upgrade', async (req, res) => {
  const adminSecret = req.headers['x-admin-secret'];

  if (!process.env.BILLING_ADMIN_SECRET) {
    return res.status(400).json({ error: 'admin_secret_not_configured' });
  }

  if (adminSecret !== process.env.BILLING_ADMIN_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { userId, email, tier = 'pro', amountZar, reference } = req.body || {};

  try {
    const result = await upgradeTier({
      userId,
      email,
      tier,
      provider: 'yoco_manual_link',
      checkoutId: reference || null,
      amountZar: amountZar ? Number(amountZar) : undefined,
      metadata: {
        manual: true,
        reference,
      },
    });

    return res.json({
      ok: true,
      tier: result.tier,
      profile: result.profile,
    });
  } catch (e) {
    return res.status(400).json({
      error: 'manual_upgrade_failed',
      message: e?.message || String(e),
    });
  }
});

/**
 * Stripe checkout.
 */
router.post('/checkout', async (req, res) => {
  const stripe = await getStripe();

  if (!stripe) {
    return res.status(400).json({ error: 'stripe_not_configured' });
  }

  const {
    priceId,
    mode = 'subscription',
    successUrl,
    cancelUrl,
    quantity = 1,
    metadata = {},
  } = req.body || {};

  if (!priceId || !successUrl || !cancelUrl) {
    return res.status(400).json({ error: 'missing_params' });
  }

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

    return res.status(201).json({
      id: session.id,
      url: session.url,
    });
  } catch (e) {
    return res.status(500).json({
      error: 'stripe_error',
      message: e?.message || String(e),
    });
  }
});

/**
 * Stripe customer portal.
 */
router.post('/portal', async (req, res) => {
  const stripe = await getStripe();

  if (!stripe) {
    return res.status(400).json({ error: 'stripe_not_configured' });
  }

  const { customerId, returnUrl } = req.body || {};

  if (!customerId || !returnUrl) {
    return res.status(400).json({ error: 'missing_params' });
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });

    return res.status(201).json({
      url: session.url,
    });
  } catch (e) {
    return res.status(500).json({
      error: 'stripe_error',
      message: e?.message || String(e),
    });
  }
});

/**
 * Dev helpers.
 */
router.post('/dev/upgrade', (req, res) => {
  const { tier = 'pro' } = req.body || {};

  try {
    const clean = cleanTier(tier, true);
    const updated = setMe({ tier: clean });

    return res.json({
      ok: true,
      me: updated,
    });
  } catch {
    return res.status(400).json({
      error: 'invalid_tier',
    });
  }
});

router.post('/dev/addon', (req, res) => {
  const { verified } = req.body || {};
  const me = getMe();

  const updated = setMe({
    addons: {
      ...me.addons,
      ...(typeof verified === 'boolean' ? { verified } : {}),
    },
  });

  return res.json({
    ok: true,
    me: updated,
  });
});

router.post('/dev/reset', (_req, res) => {
  const reset = setMe({
    tier: 'free',
    addons: { verified: false },
  });

  return res.json({
    ok: true,
    me: reset,
  });
});

export default router;
