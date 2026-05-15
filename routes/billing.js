import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { getMe, setMe } from '../utils/userStore.js';

const router = Router();

const PAID_TIERS = ['pro', 'creator', 'business', 'exclusive'];
const ALL_TIERS = ['free', ...PAID_TIERS];

const TIER_PRICES_ZAR = {
  pro: 99,
  creator: 299,
  business: 999,
  exclusive: 1999,
};

function isStripeConfigured() {
  return !!process.env.STRIPE_SECRET_KEY;
}

async function getStripe() {
  if (!isStripeConfigured()) return null;

  try {
    const mod = await import('stripe');
    const Stripe = mod.default || mod;

    return new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2024-06-20',
    });
  } catch (_e) {
    return null;
  }
}

function isYocoConfigured() {
  return !!process.env.YOCO_SECRET_KEY;
}

function isSupabaseAdminConfigured() {
  return !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}

function getSupabaseAdmin() {
  if (!isSupabaseAdminConfigured()) return null;

  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
      },
    }
  );
}

function cleanTier(value, allowFree = false) {
  const tier = String(value || '').toLowerCase();

  const allowed = allowFree ? ALL_TIERS : PAID_TIERS;

  if (!allowed.includes(tier)) {
    throw new Error('invalid_tier');
  }

  return tier;
}

function isPaidStatus(status) {
  const clean = String(status || '').toLowerCase();

  return [
    'paid',
    'success',
    'successful',
    'succeeded',
    'complete',
    'completed',
    'checkout.succeeded',
    'payment.succeeded',
  ].includes(clean);
}

async function getSupabaseUserFromRequest(req) {
  const supabaseAdmin = getSupabaseAdmin();

  if (!supabaseAdmin) return null;

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!token) return null;

  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data?.user) return null;

  return data.user;
}

async function getUserIdFromRequest(req) {
  const authUser = await getSupabaseUserFromRequest(req);

  if (authUser?.id) return authUser.id;

  const fromBody =
    req.body?.userId ||
    req.body?.metadata?.userId ||
    req.body?.metadata?.user_id;

  if (fromBody) return String(fromBody);

  const localMe = getMe?.();

  if (localMe?.id) return String(localMe.id);

  return 'local-dev-user';
}

async function savePendingPayment(input) {
  const supabaseAdmin = getSupabaseAdmin();

  if (!supabaseAdmin) return;

  await supabaseAdmin.from('billing_payments').insert({
    user_id: input.userId,
    provider: input.provider,
    provider_checkout_id: input.checkoutId || null,
    tier: input.tier,
    amount_zar: input.amountZar || null,
    status: 'pending',
    metadata: input.metadata || {},
  });
}

async function upgradeTier(input) {
  const tier = cleanTier(input.tier);
  const now = new Date().toISOString();

  const supabaseAdmin = getSupabaseAdmin();

  if (supabaseAdmin && input.userId && input.userId !== 'local-dev-user') {
    await supabaseAdmin
      .from('profiles')
      .update({
        tier,
        subscription_tier: tier,
        subscription_status: 'active',
        subscription_provider: input.provider,
        subscription_updated_at: now,
      })
      .eq('id', input.userId);

    if (input.checkoutId) {
      await supabaseAdmin.from('billing_payments').upsert(
        {
          user_id: input.userId,
          provider: input.provider,
          provider_checkout_id: input.checkoutId,
          tier,
          amount_zar: input.amountZar || null,
          status: 'paid',
          metadata: input.metadata || {},
          updated_at: now,
        },
        {
          onConflict: 'provider_checkout_id',
        }
      );
    }
  }

  // Local/dev fallback so your UI can still unlock while testing.
  const updated = setMe({ tier });

  return {
    tier,
    me: updated,
  };
}

// Create Stripe Checkout Session
router.post('/checkout', async (req, res) => {
  const stripe = await getStripe();

  if (!stripe) {
    return res.status(400).json({ error: 'stripe_not_configured' });
  }

  const {
    priceId,
    tier: rawTier,
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
    const tier = cleanTier(rawTier || metadata?.tier || 'pro');
    const userId = await getUserIdFromRequest(req);

    const finalMetadata = {
      ...metadata,
      userId,
      tier,
      provider: 'stripe',
    };

    const sessionPayload = {
      mode,
      line_items: [{ price: priceId, quantity }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: finalMetadata,
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
    };

    if (mode === 'subscription') {
      sessionPayload.subscription_data = {
        metadata: finalMetadata,
      };
    }

    const session = await stripe.checkout.sessions.create(sessionPayload);

    await savePendingPayment({
      userId,
      provider: 'stripe',
      checkoutId: session.id,
      tier,
      metadata: finalMetadata,
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

// Create Yoco Checkout Session
router.post('/yoco/checkout', async (req, res) => {
  if (!isYocoConfigured()) {
    return res.status(400).json({ error: 'yoco_not_configured' });
  }

  const {
    tier: rawTier,
    amountZar,
    amount,
    currency = 'ZAR',
    successUrl,
    cancelUrl,
    failureUrl,
    metadata = {},
    externalId,
  } = req.body || {};

  if (!successUrl || !cancelUrl) {
    return res.status(400).json({ error: 'missing_params' });
  }

  try {
    const tier = cleanTier(rawTier || metadata?.tier || 'pro');
    const userId = await getUserIdFromRequest(req);

    const finalAmountZar = Number(amountZar || TIER_PRICES_ZAR[tier]);
    const amountCents = Number.isFinite(Number(amount))
      ? Math.round(Number(amount))
      : Math.round(finalAmountZar * 100);

    if (!amountCents || amountCents <= 0) {
      return res.status(400).json({ error: 'missing_amount' });
    }

    const finalMetadata = {
      ...metadata,
      userId,
      tier,
      provider: 'yoco',
    };

    const payload = {
      amount: amountCents,
      currency,
      successUrl,
      cancelUrl,
      failureUrl: failureUrl || cancelUrl,
      metadata: finalMetadata,
      externalId: externalId || `${userId}-${tier}-${Date.now()}`,
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

    await savePendingPayment({
      userId,
      provider: 'yoco',
      checkoutId: data?.id,
      tier,
      amountZar: finalAmountZar,
      metadata: finalMetadata,
    });

    return res.status(201).json({
      id: data?.id,
      redirectUrl: data?.redirectUrl,
    });
  } catch (e) {
    return res.status(500).json({
      error: 'yoco_error',
      message: e?.message || String(e),
    });
  }
});

// Refresh current billing tier
router.get('/me', async (req, res) => {
  try {
    const userId = await getUserIdFromRequest(req);
    const supabaseAdmin = getSupabaseAdmin();

    if (supabaseAdmin && userId && userId !== 'local-dev-user') {
      const { data, error } = await supabaseAdmin
        .from('profiles')
        .select('tier, subscription_tier, subscription_status')
        .eq('id', userId)
        .maybeSingle();

      if (error) throw error;

      return res.json({
        tier: data?.tier || data?.subscription_tier || 'free',
        subscriptionStatus: data?.subscription_status || 'inactive',
      });
    }

    const me = getMe();

    return res.json({
      tier: me?.tier || 'free',
      subscriptionStatus: me?.tier && me.tier !== 'free' ? 'active' : 'inactive',
    });
  } catch (e) {
    return res.status(500).json({
      error: 'billing_me_failed',
      message: e?.message || String(e),
    });
  }
});

// Stripe webhook: upgrades tier after checkout.session.completed
router.post('/webhook', async (req, res) => {
  const stripe = await getStripe();

  if (!stripe) return res.status(200).send('ok');

  try {
    let event = req.body;

    const sig = req.headers['stripe-signature'];

    if (
      process.env.STRIPE_WEBHOOK_SECRET &&
      sig &&
      Buffer.isBuffer(req.body)
    ) {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    }

    if (event?.type === 'checkout.session.completed') {
      const session = event.data.object;

      const userId = session?.metadata?.userId;
      const tier = cleanTier(session?.metadata?.tier || 'pro');

      if (userId) {
        await upgradeTier({
          userId,
          tier,
          provider: 'stripe',
          checkoutId: session.id,
          metadata: session.metadata || {},
        });
      }
    }

    return res.status(200).send('ok');
  } catch (e) {
    return res.status(400).json({
      error: 'stripe_webhook_failed',
      message: e?.message || String(e),
    });
  }
});

// Yoco webhook: upgrades tier when Yoco sends a paid/successful event
router.post('/yoco/webhook', async (req, res) => {
  try {
    const body = req.body || {};
    const payload = body.payload || body.data || body;

    const metadata = payload.metadata || body.metadata || {};
    const status =
      payload.status ||
      payload.paymentStatus ||
      payload.payment?.status ||
      body.status ||
      body.type;

    const checkoutId =
      payload.id ||
      payload.checkoutId ||
      payload.checkout_id ||
      body.checkoutId ||
      body.id;

    if (!isPaidStatus(status)) {
      return res.status(200).json({
        ok: true,
        ignored: true,
        status,
      });
    }

    const userId = metadata.userId || metadata.user_id;
    const tier = cleanTier(metadata.tier || 'pro');

    if (!userId) {
      return res.status(400).json({
        error: 'missing_user_id_in_metadata',
      });
    }

    const result = await upgradeTier({
      userId,
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

// Manual Yoco verification after redirect.
// Use this from your billing success page if webhook is delayed.
router.post('/yoco/verify', async (req, res) => {
  if (!isYocoConfigured()) {
    return res.status(400).json({ error: 'yoco_not_configured' });
  }

  const { checkoutId } = req.body || {};

  if (!checkoutId) {
    return res.status(400).json({ error: 'missing_checkout_id' });
  }

  try {
    const r = await fetch(`https://payments.yoco.com/api/checkouts/${checkoutId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${process.env.YOCO_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      return res.status(500).json({
        error: 'yoco_verify_failed',
        message: data?.message || data?.error || 'could_not_verify_yoco_checkout',
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

    const userId = metadata.userId || metadata.user_id || (await getUserIdFromRequest(req));
    const tier = cleanTier(metadata.tier || req.body.tier || 'pro');

    const result = await upgradeTier({
      userId,
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
    return res.status(500).json({
      error: 'yoco_verify_failed',
      message: e?.message || String(e),
    });
  }
});

// Create Stripe Customer Portal session
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

// Dev mode helpers
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
