import { Router } from 'express';
import crypto from 'crypto';
import { requireAuth } from '../middleware/auth.js';
import { Payment } from '../models/Payment.js';
import { User } from '../models/User.js';
import { connectDb } from '../lib/db.js';

const router = Router();

/*
  IMPORTANT ENV VARS ON RENDER BACKEND:

  YOCO_SECRET_KEY=sk_live_xxxxxxxxx
  YOCO_WEBHOOK_SECRET=whsec_xxxxxxxxx
  CLIENT_ORIGIN=https://facemexsocial.com

  Do NOT put YOCO_SECRET_KEY on Netlify frontend.
*/

const YOCO_SECRET_KEY = process.env.YOCO_SECRET_KEY || '';
const YOCO_WEBHOOK_SECRET = process.env.YOCO_WEBHOOK_SECRET || '';
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || process.env.FRONTEND_URL || 'https://facemexsocial.com';
const YOCO_CHECKOUTS_URL = process.env.YOCO_CHECKOUTS_URL || 'https://payments.yoco.com/api/checkouts';

const processedWebhookIds = new Set();

const PLAN_CONFIG = {
  pro: {
    tier: 'pro',
    name: 'FaceMeX Pro',
    amountCents: 9999,
    type: 'tier',
  },
  creator: {
    tier: 'creator',
    name: 'FaceMeX Creator',
    amountCents: 29999,
    type: 'tier',
  },
  business: {
    tier: 'business',
    name: 'FaceMeX Business',
    amountCents: 99999,
    type: 'tier',
  },
  exclusive: {
    tier: 'exclusive',
    name: 'FaceMeX Exclusive',
    amountCents: 199999,
    type: 'tier',
  },
  verified: {
    tier: 'verified',
    name: 'FaceMeX Verified Badge',
    amountCents: 15000,
    type: 'addon',
    addon: 'verified',
  },
};

function clean(value) {
  return String(value || '').trim();
}

function normalizeTier(tier) {
  const t = clean(tier).toLowerCase();

  if (t === 'creator+') return 'creator';
  if (t === 'verified-badge') return 'verified';

  return t;
}

function getPlanConfig(tier) {
  const key = normalizeTier(tier);
  return PLAN_CONFIG[key] || null;
}

function addOneMonth() {
  const date = new Date();
  date.setMonth(date.getMonth() + 1);
  return date;
}

function getUserIdFromRequest(req) {
  return clean(req.user?._id || req.user?.id || req.body?.userId || req.query?.userId);
}

function isPaidStatus(status) {
  const s = clean(status).toLowerCase();

  return ['paid', 'successful', 'success', 'succeeded', 'completed', 'complete'].includes(s);
}

function isFailedStatus(status) {
  const s = clean(status).toLowerCase();

  return ['failed', 'cancelled', 'canceled', 'expired'].includes(s);
}

async function yocoRequest(url, options = {}) {
  if (!YOCO_SECRET_KEY) {
    throw new Error('YOCO_SECRET_KEY is missing on backend');
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${YOCO_SECRET_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const text = await response.text();

  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    console.error('Yoco API error:', response.status, data);
    throw new Error(data?.message || data?.error || `Yoco API failed with ${response.status}`);
  }

  return data;
}

function getCheckoutStatus(checkout) {
  return clean(
    checkout?.status ||
      checkout?.paymentStatus ||
      checkout?.payment?.status ||
      checkout?.data?.status ||
      ''
  ).toLowerCase();
}

function checkoutIsPaid(checkout) {
  const status = getCheckoutStatus(checkout);

  if (isPaidStatus(status)) return true;

  if (checkout?.paymentId && !isFailedStatus(status)) return true;
  if (checkout?.payment?.id && !isFailedStatus(status)) return true;

  return false;
}

function checkoutIsFailed(checkout) {
  return isFailedStatus(getCheckoutStatus(checkout));
}

async function activateUserAfterPayment(payment) {
  const planKey = normalizeTier(payment.tier);
  const config = getPlanConfig(planKey);

  if (!config) {
    throw new Error(`Invalid payment tier: ${payment.tier}`);
  }

  if (!payment.user) {
    throw new Error('Payment has no user attached');
  }

  if (config.type === 'addon' && config.addon === 'verified') {
    await User.findByIdAndUpdate(
      payment.user,
      {
        $set: {
          'addons.verified': true,
          verified: true,
          userVerified: true,
          updatedAt: new Date(),
        },
      },
      { new: true }
    );

    return {
      activated: true,
      type: 'addon',
      addon: 'verified',
    };
  }

  await User.findByIdAndUpdate(
    payment.user,
    {
      $set: {
        tier: config.tier,
        subscriptionTier: config.tier,
        subscriptionStatus: 'active',
        subscriptionExpiresAt: addOneMonth(),
        updatedAt: new Date(),
      },
    },
    { new: true }
  );

  return {
    activated: true,
    type: 'tier',
    tier: config.tier,
  };
}

async function markPaymentCompleted(payment, providerPayload = {}) {
  if (payment.status === 'completed') {
    return payment;
  }

  payment.status = 'completed';
  payment.completedAt = payment.completedAt || new Date();
  payment.providerPayload = providerPayload;

  await payment.save();

  await activateUserAfterPayment(payment);

  return payment;
}

async function markPaymentFailed(payment, status = 'failed', providerPayload = {}) {
  payment.status = status === 'cancelled' || status === 'canceled' ? 'cancelled' : 'failed';
  payment.providerPayload = providerPayload;

  await payment.save();

  return payment;
}

function getRawBody(req) {
  if (Buffer.isBuffer(req.body)) {
    return req.body.toString('utf8');
  }

  if (typeof req.rawBody === 'string') {
    return req.rawBody;
  }

  if (req.rawBody && Buffer.isBuffer(req.rawBody)) {
    return req.rawBody.toString('utf8');
  }

  return JSON.stringify(req.body || {});
}

function getWebhookHeader(req, name) {
  return clean(req.headers[name] || req.headers[name.toLowerCase()]);
}

function verifyYocoWebhookSignature(req, rawBody) {
  /*
    Yoco webhook verification uses the raw body plus webhook headers.
    Configure express.raw for this route in app.js/server.js.
  */

  if (!YOCO_WEBHOOK_SECRET) {
    console.warn('YOCO_WEBHOOK_SECRET missing. Webhook signature verification skipped.');
    return true;
  }

  const webhookId = getWebhookHeader(req, 'webhook-id');
  const webhookTimestamp = getWebhookHeader(req, 'webhook-timestamp');
  const webhookSignature = getWebhookHeader(req, 'webhook-signature');

  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    console.error('Yoco webhook missing signature headers');
    return false;
  }

  const timestamp = Number(webhookTimestamp);
  const now = Math.floor(Date.now() / 1000);

  if (!Number.isFinite(timestamp)) return false;

  const ageSeconds = Math.abs(now - timestamp);
  if (ageSeconds > 300) {
    console.error('Yoco webhook rejected: timestamp too old');
    return false;
  }

  const secretBase64 = YOCO_WEBHOOK_SECRET.includes('_')
    ? YOCO_WEBHOOK_SECRET.split('_')[1]
    : YOCO_WEBHOOK_SECRET;

  if (!secretBase64) return false;

  const secretBytes = Buffer.from(secretBase64, 'base64');
  const signedContent = `${webhookId}.${webhookTimestamp}.${rawBody}`;

  const expectedSignature = crypto
    .createHmac('sha256', secretBytes)
    .update(signedContent)
    .digest('base64');

  const receivedSignatures = String(webhookSignature)
    .split(' ')
    .map((part) => {
      if (part.includes(',')) return part.split(',')[1];
      return part;
    })
    .map((part) => part.trim())
    .filter(Boolean);

  return receivedSignatures.some((sig) => {
    const expected = Buffer.from(expectedSignature);
    const received = Buffer.from(sig);

    if (expected.length !== received.length) return false;

    return crypto.timingSafeEqual(expected, received);
  });
}

function extractWebhookInfo(event) {
  const payload =
    event?.payload ||
    event?.data ||
    event?.object ||
    event?.checkout ||
    event?.payment ||
    event ||
    {};

  const metadata =
    payload?.metadata ||
    event?.metadata ||
    event?.data?.metadata ||
    event?.payload?.metadata ||
    {};

  const eventType = clean(event?.type || event?.event || event?.name).toLowerCase();
  const status = clean(payload?.status || event?.status || payload?.paymentStatus).toLowerCase();

  const externalId =
    clean(payload?.externalId) ||
    clean(payload?.external_id) ||
    clean(event?.externalId) ||
    clean(event?.external_id) ||
    clean(metadata?.paymentId) ||
    clean(metadata?.payment_id);

  const providerPaymentId =
    clean(payload?.id) ||
    clean(payload?.checkoutId) ||
    clean(payload?.checkout_id) ||
    clean(payload?.paymentId) ||
    clean(payload?.payment_id) ||
    clean(event?.id);

  const metadataPaymentId =
    clean(metadata?.paymentId) ||
    clean(metadata?.payment_id) ||
    clean(metadata?.externalId) ||
    clean(metadata?.external_id);

  const tier =
    normalizeTier(metadata?.tier) ||
    normalizeTier(event?.tier) ||
    normalizeTier(payload?.tier);

  const paid =
    isPaidStatus(status) ||
    eventType.includes('payment.succeeded') ||
    eventType.includes('checkout.succeeded') ||
    eventType.includes('checkout.completed') ||
    eventType.includes('paid') ||
    eventType.includes('success');

  const failed =
    isFailedStatus(status) ||
    eventType.includes('payment.failed') ||
    eventType.includes('checkout.failed') ||
    eventType.includes('cancel');

  return {
    eventType,
    status,
    paid,
    failed,
    externalId,
    providerPaymentId,
    metadataPaymentId,
    tier,
    payload,
    metadata,
  };
}

async function findPaymentForWebhook(info) {
  if (info.externalId) {
    const byExternalId = await Payment.findById(info.externalId).catch(() => null);
    if (byExternalId) return byExternalId;
  }

  if (info.metadataPaymentId) {
    const byMetadataPaymentId = await Payment.findById(info.metadataPaymentId).catch(() => null);
    if (byMetadataPaymentId) return byMetadataPaymentId;
  }

  if (info.providerPaymentId) {
    const byProviderId = await Payment.findOne({
      providerPaymentId: info.providerPaymentId,
    });

    if (byProviderId) return byProviderId;
  }

  return null;
}

/*
  POST /api/payments/initiate

  Creates Mongo Payment record.
  Creates Yoco checkout session.
  Returns redirectUrl to frontend.
*/
router.post('/initiate', requireAuth, async (req, res) => {
  try {
    await connectDb();

    const user = req.user;
    const userId = getUserIdFromRequest(req);
    const tier = normalizeTier(req.body?.tier || req.body?.plan);
    const config = getPlanConfig(tier);

    if (!userId || !user?._id) {
      return res.status(401).json({
        ok: false,
        error: 'not_authenticated',
        message: 'Please log in before starting payment.',
      });
    }

    if (!config) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_tier',
        message: 'Invalid plan selected.',
      });
    }

    if (!YOCO_SECRET_KEY) {
      return res.status(500).json({
        ok: false,
        error: 'payment_provider_not_configured',
        message: 'YOCO_SECRET_KEY is missing on backend.',
      });
    }

    const payment = await Payment.create({
      user: user._id,
      tier: config.tier,
      amount: config.amountCents,
      currency: 'ZAR',
      provider: 'yoco',
      metadata: {
        ...(req.body?.metadata || {}),
        tier: config.tier,
        planName: config.name,
        userId: String(user._id),
        amountCents: config.amountCents,
      },
      status: 'pending',
    });

    const successUrl = `${CLIENT_ORIGIN}/pricing?payment=success&paymentId=${encodeURIComponent(
      String(payment._id)
    )}&plan=${encodeURIComponent(config.tier)}`;

    const cancelUrl = `${CLIENT_ORIGIN}/pricing?payment=cancelled&paymentId=${encodeURIComponent(
      String(payment._id)
    )}&plan=${encodeURIComponent(config.tier)}`;

    const failureUrl = `${CLIENT_ORIGIN}/pricing?payment=failed&paymentId=${encodeURIComponent(
      String(payment._id)
    )}&plan=${encodeURIComponent(config.tier)}`;

    const checkoutPayload = {
      amount: config.amountCents,
      currency: 'ZAR',
      successUrl,
      cancelUrl,
      failureUrl,
      externalId: String(payment._id),
      metadata: {
        paymentId: String(payment._id),
        userId: String(user._id),
        tier: config.tier,
        planName: config.name,
      },
      lineItems: [
        {
          displayName: config.name,
          quantity: 1,
          pricingDetails: {
            price: config.amountCents,
          },
        },
      ],
    };

    const yocoCheckout = await yocoRequest(YOCO_CHECKOUTS_URL, {
      method: 'POST',
      headers: {
        'Idempotency-Key': String(payment._id),
      },
      body: JSON.stringify(checkoutPayload),
    });

    if (!yocoCheckout?.redirectUrl || !yocoCheckout?.id) {
      console.error('Yoco checkout missing redirectUrl/id:', yocoCheckout);

      payment.status = 'failed';
      payment.providerPayload = yocoCheckout;
      await payment.save();

      return res.status(502).json({
        ok: false,
        error: 'missing_yoco_redirect',
        message: 'Yoco did not return a payment link.',
      });
    }

    payment.providerPaymentId = yocoCheckout.id;
    payment.redirectUrl = yocoCheckout.redirectUrl;
    payment.providerPayload = yocoCheckout;
    await payment.save();

    return res.status(201).json({
      ok: true,
      id: payment._id,
      paymentId: payment._id,
      providerPaymentId: payment.providerPaymentId,
      redirectUrl: payment.redirectUrl,
      tier: config.tier,
      amount: config.amountCents,
      currency: 'ZAR',
    });
  } catch (err) {
    console.error('payments/initiate error:', err?.message || err);

    return res.status(500).json({
      ok: false,
      error: 'server_error',
      message: err?.message || String(err),
    });
  }
});

/*
  POST /api/payments/verify

  Frontend calls this after return from Yoco success URL.
  It checks Yoco directly before activating user.
*/
router.post('/verify', requireAuth, async (req, res) => {
  try {
    await connectDb();

    const userId = getUserIdFromRequest(req);
    const paymentId = clean(req.body?.paymentId || req.body?.checkoutId);

    if (!paymentId) {
      return res.status(400).json({
        ok: false,
        error: 'missing_paymentId',
      });
    }

    const payment = await Payment.findById(paymentId);

    if (!payment) {
      return res.status(404).json({
        ok: false,
        error: 'payment_not_found',
      });
    }

    if (String(payment.user) !== String(userId)) {
      return res.status(403).json({
        ok: false,
        error: 'payment_not_for_this_user',
      });
    }

    if (payment.status === 'completed') {
      return res.json({
        ok: true,
        active: true,
        payment,
        tier: payment.tier,
        message: 'Subscription is already active.',
      });
    }

    if (!payment.providerPaymentId) {
      return res.status(400).json({
        ok: false,
        error: 'missing_provider_payment_id',
      });
    }

    const checkout = await yocoRequest(
      `${YOCO_CHECKOUTS_URL}/${encodeURIComponent(payment.providerPaymentId)}`,
      {
        method: 'GET',
      }
    );

    if (checkoutIsPaid(checkout)) {
      await markPaymentCompleted(payment, checkout);

      return res.json({
        ok: true,
        active: true,
        payment,
        tier: payment.tier,
        message: 'Payment confirmed and subscription activated.',
      });
    }

    if (checkoutIsFailed(checkout)) {
      await markPaymentFailed(payment, getCheckoutStatus(checkout), checkout);

      return res.json({
        ok: true,
        active: false,
        payment,
        status: payment.status,
        message: 'Payment was not successful.',
      });
    }

    payment.providerPayload = checkout;
    await payment.save();

    return res.json({
      ok: true,
      active: false,
      pending: true,
      payment,
      yocoStatus: getCheckoutStatus(checkout) || 'pending',
      message: 'Payment is still being confirmed.',
    });
  } catch (err) {
    console.error('payments/verify error:', err?.message || err);

    return res.status(500).json({
      ok: false,
      error: 'server_error',
      message: err?.message || String(err),
    });
  }
});

/*
  GET /api/payments/confirm?paymentId=...

  Keep this for compatibility with older frontend.
  It no longer trusts ?status=completed.
  It verifies directly with Yoco.
*/
router.get('/confirm', requireAuth, async (req, res) => {
  try {
    await connectDb();

    const userId = getUserIdFromRequest(req);
    const paymentId = clean(req.query?.paymentId);

    if (!paymentId) {
      return res.status(400).json({
        ok: false,
        error: 'missing_paymentId',
      });
    }

    const payment = await Payment.findById(paymentId);

    if (!payment) {
      return res.status(404).json({
        ok: false,
        error: 'payment_not_found',
      });
    }

    if (String(payment.user) !== String(userId)) {
      return res.status(403).json({
        ok: false,
        error: 'payment_not_for_this_user',
      });
    }

    if (payment.status === 'completed') {
      return res.json({
        ok: true,
        active: true,
        payment,
        tier: payment.tier,
      });
    }

    if (!payment.providerPaymentId) {
      return res.status(400).json({
        ok: false,
        error: 'missing_provider_payment_id',
      });
    }

    const checkout = await yocoRequest(
      `${YOCO_CHECKOUTS_URL}/${encodeURIComponent(payment.providerPaymentId)}`,
      {
        method: 'GET',
      }
    );

    if (checkoutIsPaid(checkout)) {
      await markPaymentCompleted(payment, checkout);

      return res.json({
        ok: true,
        active: true,
        payment,
        tier: payment.tier,
        message: 'Payment confirmed and subscription activated.',
      });
    }

    if (checkoutIsFailed(checkout)) {
      await markPaymentFailed(payment, getCheckoutStatus(checkout), checkout);

      return res.json({
        ok: true,
        active: false,
        payment,
        status: payment.status,
        message: 'Payment was not successful.',
      });
    }

    payment.providerPayload = checkout;
    await payment.save();

    return res.json({
      ok: true,
      active: false,
      pending: true,
      payment,
      yocoStatus: getCheckoutStatus(checkout) || 'pending',
      message: 'Payment is still being confirmed.',
    });
  } catch (err) {
    console.error('payments/confirm error:', err?.message || err);

    return res.status(500).json({
      ok: false,
      error: 'server_error',
      message: err?.message || String(err),
    });
  }
});

/*
  POST /api/payments/webhook

  Yoco calls this automatically.
  This activates the user even if they close the browser after payment.
*/
router.post('/webhook', async (req, res) => {
  try {
    await connectDb();

    const rawBody = getRawBody(req);

    const validSignature = verifyYocoWebhookSignature(req, rawBody);

    if (!validSignature) {
      return res.status(403).send('invalid_signature');
    }

    const webhookId = getWebhookHeader(req, 'webhook-id');

    if (webhookId) {
      if (processedWebhookIds.has(webhookId)) {
        return res.status(200).send('duplicate');
      }

      processedWebhookIds.add(webhookId);

      if (processedWebhookIds.size > 1000) {
        const first = processedWebhookIds.values().next().value;
        processedWebhookIds.delete(first);
      }
    }

    let event = req.body;

    if (Buffer.isBuffer(req.body) || typeof rawBody === 'string') {
      try {
        event = JSON.parse(rawBody);
      } catch {
        event = {};
      }
    }

    const info = extractWebhookInfo(event);
    const payment = await findPaymentForWebhook(info);

    if (!payment) {
      console.warn('Yoco webhook received but payment not found:', info);
      return res.status(200).send('ok');
    }

    if (info.paid) {
      await markPaymentCompleted(payment, info.payload);

      return res.status(200).send('ok');
    }

    if (info.failed) {
      await markPaymentFailed(payment, info.status || 'failed', info.payload);

      return res.status(200).send('ok');
    }

    payment.providerPayload = info.payload;
    await payment.save();

    return res.status(200).send('ok');
  } catch (err) {
    console.error('payments/webhook error:', err?.message || err);

    return res.status(500).send('error');
  }
});

export default router;
