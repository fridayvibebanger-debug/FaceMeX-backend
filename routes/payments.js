import { Router } from 'express';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth.js';
import { connectDb } from '../lib/db.js';

const router = Router();

/*
  REQUIRED RENDER BACKEND ENV VARIABLES:

  YOCO_SECRET_KEY=sk_live_xxxxxxxxx
  CLIENT_ORIGIN=https://facemexsocial.com

  OPTIONAL BUT RECOMMENDED LATER:
  YOCO_WEBHOOK_SECRET=whsec_xxxxxxxxx

  IMPORTANT:
  Never put YOCO_SECRET_KEY in Netlify frontend.
  Only Render backend must have YOCO_SECRET_KEY.
*/

const YOCO_SECRET_KEY = process.env.YOCO_SECRET_KEY || '';
const YOCO_WEBHOOK_SECRET = process.env.YOCO_WEBHOOK_SECRET || '';

const CLIENT_ORIGIN =
  process.env.CLIENT_ORIGIN ||
  process.env.FRONTEND_URL ||
  'https://facemexsocial.com';

const YOCO_CHECKOUTS_URL =
  process.env.YOCO_CHECKOUTS_URL ||
  'https://payments.yoco.com/api/checkouts';

const processedWebhookIds = new Set();

/*
  Payment model is inside this file so you do not need:
  src/models/Payment.js
*/
const PaymentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },

    tier: {
      type: String,
      enum: ['pro', 'creator', 'business', 'exclusive', 'verified', 'mexa_plus', 'mexa_pro','mexa_business', ],
      required: true,
      index: true,
    },

    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    currency: {
      type: String,
      default: 'ZAR',
      uppercase: true,
      trim: true,
    },

    provider: {
      type: String,
      default: 'yoco',
      lowercase: true,
      trim: true,
    },

    providerPaymentId: {
      type: String,
      default: '',
      index: true,
      trim: true,
    },

    redirectUrl: {
      type: String,
      default: '',
      trim: true,
    },

    status: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'cancelled'],
      default: 'pending',
      index: true,
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    providerPayload: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    completedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

PaymentSchema.index({ user: 1, status: 1 });
PaymentSchema.index({ provider: 1, providerPaymentId: 1 });
PaymentSchema.index({ createdAt: -1 });

const Payment =
  mongoose.models.Payment || mongoose.model('Payment', PaymentSchema);

/*
  Prices are in cents.
  R99.99 = 9999
  R299.99 = 29999
  R999.99 = 99999
  R1,999.99 = 199999
  R150.00 = 15000
*/
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

  mexa_plus: {
  tier: "mexa_plus",
  name: "MEXA Plus",
  amountCents: 28000, // R280.00
  type: "subscription",
},

mexa_pro: {
  tier: "mexa_pro",
  name: "MEXA Pro",
  amountCents: 57000, // R580.00
  type: "subscription",
},

mexa_business: {
  tier: "mexa_business",
  name: "MEXA Business",
  amountCents: 158000, // R1,580.00
  type: "subscription",
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
  return PLAN_CONFIG[normalizeTier(tier)] || null;
}

function addThirtyDays() {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  return date;
}

function getUserIdFromRequest(req) {
  return clean(
    req.user?._id ||
      req.user?.id ||
      req.body?.userId ||
      req.query?.userId ||
      req.headers['x-user-id']
  );
}

function isPaidStatus(status) {
  const s = clean(status).toLowerCase();

  return [
    'paid',
    'successful',
    'success',
    'succeeded',
    'completed',
    'complete',
  ].includes(s);
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

    throw new Error(
      data?.message ||
        data?.error ||
        data?.errors?.[0]?.message ||
        `Yoco API failed with ${response.status}`
    );
  }

  return data;
}

function getCheckoutStatus(checkout) {
  return clean(
    checkout?.status ||
      checkout?.paymentStatus ||
      checkout?.payment?.status ||
      checkout?.data?.status ||
      checkout?.data?.object?.status ||
      ''
  ).toLowerCase();
}

function checkoutIsPaid(checkout) {
  const status = getCheckoutStatus(checkout);

  if (isPaidStatus(status)) return true;

  if (checkout?.paymentId && !isFailedStatus(status)) return true;
  if (checkout?.payment?.id && !isFailedStatus(status)) return true;
  if (checkout?.data?.paymentId && !isFailedStatus(status)) return true;

  return false;
}

function checkoutIsFailed(checkout) {
  return isFailedStatus(getCheckoutStatus(checkout));
}

async function updateUserAccess(userId, update) {
  if (!userId) {
    throw new Error('Missing userId for user update');
  }

  const id = String(userId);

  if (mongoose.models.User) {
    return mongoose.models.User.findByIdAndUpdate(id, update, {
      new: true,
      strict: false,
    });
  }

  const queryId = mongoose.Types.ObjectId.isValid(id)
    ? new mongoose.Types.ObjectId(id)
    : id;

  return mongoose.connection.collection('users').updateOne(
    {
      _id: queryId,
    },
    update
  );
}

async function activateUserAfterPayment(payment) {
  const config = getPlanConfig(payment.tier);

  if (!config) {
    throw new Error(`Invalid payment tier: ${payment.tier}`);
  }

  if (!payment.user) {
    throw new Error('Payment has no user attached');
  }

  if (config.type === 'addon' && config.addon === 'verified') {
    await updateUserAccess(payment.user, {
      $set: {
        'addons.verified': true,
        verified: true,
        userVerified: true,
        updatedAt: new Date(),
      },
    });

    return {
      activated: true,
      type: 'addon',
      addon: 'verified',
    };
  }

  const expiresAt = addThirtyDays();

  await updateUserAccess(payment.user, {
    $set: {
      tier: config.tier,
      subscriptionTier: config.tier,
      subscriptionStatus: 'active',
      subscriptionStartedAt: new Date(),
      subscriptionExpiresAt: expiresAt,
      updatedAt: new Date(),
    },
  });

  return {
    activated: true,
    type: 'tier',
    tier: config.tier,
    expiresAt,
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
  payment.status =
    status === 'cancelled' || status === 'canceled' ? 'cancelled' : 'failed';

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

function extractWebhookSignatures(headerValue) {
  return String(headerValue || '')
    .split(/\s+/)
    .flatMap((part) => {
      const cleanPart = part.trim();

      if (!cleanPart) return [];

      if (cleanPart.includes(',')) {
        return [cleanPart.split(',').pop().trim()];
      }

      if (cleanPart.includes('=')) {
        return [cleanPart.split('=').pop().trim()];
      }

      return [cleanPart];
    })
    .filter(Boolean);
}

function verifyYocoWebhookSignature(req, rawBody) {
  /*
    Webhook is optional for now.

    If YOCO_WEBHOOK_SECRET is missing, webhook verification is skipped.
    Your main payment flow still works through /api/payments/verify.
  */
  if (!YOCO_WEBHOOK_SECRET) {
    console.warn('YOCO_WEBHOOK_SECRET missing. Webhook verification skipped.');
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

  const signedContent = `${webhookId}.${webhookTimestamp}.${rawBody}`;
  const receivedSignatures = extractWebhookSignatures(webhookSignature);

  const possibleSecrets = [];

  if (YOCO_WEBHOOK_SECRET.includes('_')) {
    possibleSecrets.push(Buffer.from(YOCO_WEBHOOK_SECRET.split('_')[1], 'base64'));
  }

  possibleSecrets.push(Buffer.from(YOCO_WEBHOOK_SECRET, 'base64'));
  possibleSecrets.push(Buffer.from(YOCO_WEBHOOK_SECRET, 'utf8'));

  return possibleSecrets.some((secretBytes) => {
    if (!secretBytes || secretBytes.length === 0) return false;

    const expectedSignature = crypto
      .createHmac('sha256', secretBytes)
      .update(signedContent)
      .digest('base64');

    return receivedSignatures.some((sig) => {
      const expected = Buffer.from(expectedSignature);
      const received = Buffer.from(sig);

      if (expected.length !== received.length) return false;

      return crypto.timingSafeEqual(expected, received);
    });
  });
}

function getWebhookPayload(event) {
  return (
    event?.payload ||
    event?.data?.object ||
    event?.data?.checkout ||
    event?.data?.payment ||
    event?.data ||
    event?.object ||
    event?.checkout ||
    event?.payment ||
    event ||
    {}
  );
}

function getWebhookMetadata(event, payload) {
  return (
    payload?.metadata ||
    event?.metadata ||
    event?.data?.metadata ||
    event?.payload?.metadata ||
    event?.data?.object?.metadata ||
    {}
  );
}

function extractWebhookInfo(event) {
  const payload = getWebhookPayload(event);
  const metadata = getWebhookMetadata(event, payload);

  const eventType = clean(event?.type || event?.event || event?.name).toLowerCase();

  const status = clean(
    payload?.status ||
      payload?.paymentStatus ||
      event?.status ||
      event?.data?.status ||
      ''
  ).toLowerCase();

  const externalId =
    clean(payload?.externalId) ||
    clean(payload?.external_id) ||
    clean(event?.externalId) ||
    clean(event?.external_id) ||
    clean(metadata?.paymentId) ||
    clean(metadata?.payment_id) ||
    clean(metadata?.externalId) ||
    clean(metadata?.external_id);

  const providerPaymentId =
    clean(payload?.id) ||
    clean(payload?.checkoutId) ||
    clean(payload?.checkout_id) ||
    clean(payload?.paymentId) ||
    clean(payload?.payment_id) ||
    clean(event?.id) ||
    clean(event?.data?.id);

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
    const byMetadataPaymentId = await Payment.findById(
      info.metadataPaymentId
    ).catch(() => null);

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

async function createCheckoutHandler(req, res) {
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
        accessDays: 30,
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
        accessDays: 30,
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
      accessDays: 30,
    });
  } catch (err) {
    console.error('payments/initiate error:', err?.message || err);

    return res.status(500).json({
      ok: false,
      error: 'server_error',
      message: err?.message || String(err),
    });
  }
}

async function verifyPaymentHandler(req, res) {
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
        accessDays: 30,
        message: 'Payment confirmed. Access activated for 30 days.',
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
}

/*
  Main routes
*/
router.post('/initiate', requireAuth, createCheckoutHandler);
router.post('/verify', requireAuth, verifyPaymentHandler);

/*
  Compatibility routes
*/
router.post('/create-checkout', requireAuth, createCheckoutHandler);
router.post('/yoco/create-checkout', requireAuth, createCheckoutHandler);
router.post('/yoco/verify', requireAuth, verifyPaymentHandler);

router.get('/confirm', requireAuth, async (req, res) => {
  req.body = {
    ...(req.body || {}),
    paymentId: req.query?.paymentId,
  };

  return verifyPaymentHandler(req, res);
});

/*
  Yoco webhook route.
  Do NOT add requireAuth here.
  This is optional until YOCO_WEBHOOK_SECRET is added.
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
