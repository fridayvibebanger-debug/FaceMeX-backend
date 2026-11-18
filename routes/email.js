import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { createHybridAuth } from '../middleware/auth.js';
import { connectDb, mongoose } from '../lib/db.js';
import { EmailOAuthState } from '../models/EmailOAuthState.js';
import { EmailSend } from '../models/EmailSend.js';
import { GmailConnection } from '../models/GmailConnection.js';
import { generateEmailAssistantText } from './ai.js';
import {
  buildEmailGenerationPrompt,
  buildRawEmail,
  decryptToken,
  EmailAssistantError,
  encryptToken,
  hashEmailPayload,
  hashOAuthState,
  normalizeEmailPayload,
  normalizeGeneratedDraft,
  validateIdempotencyKey,
  validateRecipientEmail,
} from '../services/emailAssistant.js';

const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const MAX_PROMPT_LENGTH = 4_000;

function userId(req) {
  const id = req.user?._id || req.user?.id;
  return id == null ? '' : String(id);
}

function publicError(error) {
  if (error instanceof EmailAssistantError) {
    return { statusCode: error.statusCode, body: { error: error.code, message: error.message } };
  }
  console.error('FaceMeX email assistant request failed', {
    errorName: error instanceof Error ? error.name : 'UnknownError',
  });
  return {
    statusCode: 503,
    body: { error: 'email_service_unavailable', message: 'The email service is temporarily unavailable.' },
  };
}

function rateLimiter({ limit, windowMs, now = Date.now }) {
  const records = new Map();
  return (req, res, next) => {
    const id = userId(req);
    const timestamp = now();
    if (records.size > 2_000) {
      for (const [recordId, record] of records) {
        if (timestamp - record.startedAt >= windowMs) records.delete(recordId);
      }
    }
    let record = records.get(id);
    if (!record || timestamp - record.startedAt >= windowMs) {
      record = { startedAt: timestamp, count: 0 };
      records.set(id, record);
    }
    record.count += 1;
    res.set('RateLimit-Limit', String(limit));
    res.set('RateLimit-Remaining', String(Math.max(0, limit - record.count)));
    if (record.count > limit) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((record.startedAt + windowMs - timestamp) / 1000))));
      return res.status(429).json({ error: 'rate_limited', message: 'Too many email requests. Please wait and try again.' });
    }
    return next();
  };
}

function createDbGuard(connectDbFn, mongooseInstance, models) {
  let indexesReady;
  return async () => {
    const connection = await connectDbFn();
    if (!connection || mongooseInstance.connection.readyState !== 1) {
      throw new EmailAssistantError('email_storage_unavailable', 'Email services are not configured.', 503);
    }
    if (!indexesReady) {
      indexesReady = Promise.all(models.map((model) => {
        if (typeof model.createIndexes === 'function') return model.createIndexes();
        if (typeof model.init === 'function') return model.init();
        return undefined;
      })).catch((error) => {
        indexesReady = null;
        throw error;
      });
    }
    await indexesReady;
  };
}

function googleConfig(env) {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  const redirectUri = env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new EmailAssistantError('gmail_not_configured', 'Gmail connection is not configured on the server.', 503);
  }
  let parsedRedirect;
  try {
    parsedRedirect = new URL(redirectUri);
  } catch {
    throw new EmailAssistantError('gmail_not_configured', 'The Gmail callback URL is not configured correctly.', 503);
  }
  if (
    parsedRedirect.protocol !== 'https:' &&
    !(env.NODE_ENV !== 'production' && parsedRedirect.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsedRedirect.hostname))
  ) {
    throw new EmailAssistantError('gmail_not_configured', 'The Gmail callback URL must use HTTPS.', 503);
  }
  return { clientId, clientSecret, redirectUri };
}

function frontendRedirect(env, gmailStatus) {
  const origin = String(
    (env.CLIENT_ORIGIN || 'https://facemexsocial.netlify.app').split(',')[0]
  ).trim();
  let target;
  try {
    const parsedOrigin = new URL(origin);
    if (
      parsedOrigin.protocol !== 'https:' &&
      !(env.NODE_ENV !== 'production' && parsedOrigin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsedOrigin.hostname))
    ) {
      throw new Error('insecure origin');
    }
    target = new URL('/email-assistant', parsedOrigin.origin);
  } catch {
    throw new EmailAssistantError('email_redirect_not_configured', 'The email assistant redirect is not configured.', 503);
  }
  target.searchParams.set('gmail', gmailStatus);
  return target.toString();
}

function getErrorCode(payload) {
  return typeof payload?.error === 'string' ? payload.error : '';
}

function googleStatus(status) {
  if (status === 401) return 401;
  if (status === 403) return 403;
  if (status === 429) return 429;
  return 502;
}

export function createEmailRouter({
  env = process.env,
  fetchImpl = fetch,
  connectDbFn = connectDb,
  mongooseInstance = mongoose,
  stateModel = EmailOAuthState,
  connectionModel = GmailConnection,
  sendModel = EmailSend,
  generateDraft = generateEmailAssistantText,
  authMiddleware = createHybridAuth({
    env,
    fetchImpl,
    messages: {
      missing: 'Sign in to use the email assistant.',
      expired: 'Your FaceMeX sign-in has expired. Sign in again.',
      unavailable: 'FaceMeX authentication is temporarily unavailable.',
    },
  }),
  now = Date.now,
  randomBytesImpl = randomBytes,
} = {}) {
  const router = Router();
  const ensureDb = createDbGuard(connectDbFn, mongooseInstance, [stateModel, connectionModel, sendModel]);
  const generationLimit = rateLimiter({ limit: 20, windowMs: 60_000, now });
  const connectionLimit = rateLimiter({ limit: 10, windowMs: 60_000, now });
  const sendLimit = rateLimiter({ limit: 10, windowMs: 60 * 60_000, now });

  router.post('/generate', authMiddleware, generationLimit, async (req, res) => {
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
    const recipientEmail = typeof req.body?.recipientEmail === 'string'
      ? req.body.recipientEmail.trim()
      : '';
    const recipientName = typeof req.body?.recipientName === 'string'
      ? req.body.recipientName.trim()
      : '';
    if (!prompt || prompt.length > MAX_PROMPT_LENGTH) {
      return res.status(400).json({ error: 'invalid_prompt', message: 'Describe the email in 1–4,000 characters.' });
    }
    if (recipientName.length > 120 || /[\r\n]/.test(recipientName)) {
      return res.status(400).json({ error: 'invalid_recipient_name', message: 'The recipient name is not valid.' });
    }

    try {
      const email = recipientEmail ? validateRecipientEmail(recipientEmail) : '';
      const generationPrompt = buildEmailGenerationPrompt({
        prompt,
        recipientEmail: email,
        recipientName,
      });
      const generated = await generateDraft(generationPrompt);
      const draft = normalizeGeneratedDraft(generated, {
        recipientEmail: email,
        recipientName,
      });
      res.set('Cache-Control', 'no-store');
      return res.json({ success: true, draft });
    } catch (error) {
      const result = publicError(error);
      return res.status(result.statusCode).json(result.body);
    }
  });

  router.get('/google/connect', authMiddleware, connectionLimit, async (req, res) => {
    try {
      await ensureDb();
      const { clientId, redirectUri } = googleConfig(env);
      const state = randomBytesImpl(32).toString('base64url');
      await stateModel.create({
        userId: userId(req),
        stateHash: hashOAuthState(state),
        expiresAt: new Date(now() + 10 * 60_000),
      });

      const url = new URL(GOOGLE_AUTH_URL);
      url.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: GMAIL_SEND_SCOPE,
        access_type: 'offline',
        prompt: 'consent',
        state,
      }).toString();
      res.set('Cache-Control', 'no-store');
      return res.json({ authorizationUrl: url.toString() });
    } catch (error) {
      const result = publicError(error);
      return res.status(result.statusCode).json(result.body);
    }
  });

  router.get('/google/callback', async (req, res) => {
    try {
      await ensureDb();
      const state = typeof req.query.state === 'string' ? req.query.state : '';
      if (!/^[\w-]{32,100}$/.test(state)) {
        return res.status(400).send('Invalid or expired Gmail connection request. Return to FaceMeX and try again.');
      }

      const savedState = await stateModel.findOneAndDelete({
        stateHash: hashOAuthState(state),
        expiresAt: { $gt: new Date(now()) },
      }).lean();
      if (!savedState) {
        return res.status(400).send('Invalid or expired Gmail connection request. Return to FaceMeX and try again.');
      }

      if (typeof req.query.error === 'string') {
        return res.redirect(302, frontendRedirect(env, 'cancelled'));
      }
      const code = typeof req.query.code === 'string' ? req.query.code : '';
      if (!code || code.length > 2_048) {
        return res.redirect(302, frontendRedirect(env, 'connection_error'));
      }

      const config = googleConfig(env);
      const tokenResponse = await fetchImpl(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: config.redirectUri,
          grant_type: 'authorization_code',
        }),
      });
      const tokenData = await tokenResponse.json().catch(() => ({}));
      if (!tokenResponse.ok || typeof tokenData.access_token !== 'string') {
        console.warn('FaceMeX Gmail OAuth token exchange failed', { status: tokenResponse.status });
        return res.redirect(302, frontendRedirect(env, 'connection_error'));
      }

      const existing = await connectionModel.findOne({ userId: savedState.userId });
      const refreshToken = tokenData.refresh_token ||
        (existing ? decryptToken(existing.encryptedRefreshToken, env) : '');
      if (!refreshToken) {
        return res.redirect(302, frontendRedirect(env, 'connection_error'));
      }

      const expiresIn = Number(tokenData.expires_in);
      if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
        return res.redirect(302, frontendRedirect(env, 'connection_error'));
      }
      await connectionModel.findOneAndUpdate(
        { userId: savedState.userId },
        {
          $set: {
            encryptedAccessToken: encryptToken(tokenData.access_token, env, randomBytesImpl),
            encryptedRefreshToken: encryptToken(refreshToken, env, randomBytesImpl),
            accessTokenExpiresAt: new Date(now() + expiresIn * 1000),
            needsReauth: false,
            connectedAt: new Date(now()),
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      return res.redirect(302, frontendRedirect(env, 'connected'));
    } catch (error) {
      const result = publicError(error);
      if (result.statusCode >= 500) {
        return res.redirect(302, frontendRedirect(env, 'connection_error'));
      }
      return res.status(result.statusCode).send(result.body.message);
    }
  });

  router.get('/google/status', authMiddleware, connectionLimit, async (req, res) => {
    try {
      await ensureDb();
      const connection = await connectionModel.findOne({ userId: userId(req) }).lean();
      res.set('Cache-Control', 'no-store');
      return res.json({
        connected: Boolean(connection && !connection.needsReauth),
        needsReauth: Boolean(connection?.needsReauth),
        connectedAt: connection?.connectedAt || null,
      });
    } catch (error) {
      const result = publicError(error);
      return res.status(result.statusCode).json(result.body);
    }
  });

  router.post('/google/disconnect', authMiddleware, connectionLimit, async (req, res) => {
    try {
      await ensureDb();
      const id = userId(req);
      const connection = await connectionModel.findOne({ userId: id });
      if (!connection) return res.json({ disconnected: true });

      let revocationWarning = false;
      try {
        const refreshToken = decryptToken(connection.encryptedRefreshToken, env);
        const response = await fetchImpl(GOOGLE_REVOKE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: refreshToken }),
        });
        if (!response.ok) {
          revocationWarning = true;
          console.warn('FaceMeX Gmail token revocation was not confirmed', { status: response.status });
        }
      } catch (error) {
        revocationWarning = true;
        console.warn('FaceMeX Gmail token revocation failed', {
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
      }

      await connectionModel.deleteOne({ userId: id });
      return res.json({ disconnected: true, revocationWarning });
    } catch (error) {
      const result = publicError(error);
      return res.status(result.statusCode).json(result.body);
    }
  });

  async function getAccessToken(connection, { forceRefresh = false } = {}) {
    const expiry = new Date(connection.accessTokenExpiresAt).getTime();
    if (!forceRefresh && Number.isFinite(expiry) && expiry > now() + 60_000) {
      return decryptToken(connection.encryptedAccessToken, env);
    }

    const refreshToken = decryptToken(connection.encryptedRefreshToken, env);
    const { clientId, clientSecret } = googleConfig(env);
    const response = await fetchImpl(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const tokenData = await response.json().catch(() => ({}));
    if (!response.ok || typeof tokenData.access_token !== 'string') {
      if (getErrorCode(tokenData) === 'invalid_grant') {
        await connectionModel.updateOne({ userId: connection.userId }, { $set: { needsReauth: true } });
        throw new EmailAssistantError('gmail_reconnect_required', 'Reconnect your Gmail account to continue.', 401);
      }
      throw new EmailAssistantError('gmail_refresh_failed', 'Gmail could not refresh its connection. Try again shortly.', googleStatus(response.status));
    }

    const expiresIn = Number(tokenData.expires_in);
    if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new EmailAssistantError('gmail_refresh_failed', 'Gmail returned an invalid token expiration.', 502);
    }
    const updates = {
      encryptedAccessToken: encryptToken(tokenData.access_token, env, randomBytesImpl),
      accessTokenExpiresAt: new Date(now() + expiresIn * 1000),
      needsReauth: false,
    };
    if (typeof tokenData.refresh_token === 'string' && tokenData.refresh_token) {
      updates.encryptedRefreshToken = encryptToken(tokenData.refresh_token, env, randomBytesImpl);
    }
    await connectionModel.updateOne({ userId: connection.userId }, { $set: updates });
    Object.assign(connection, updates);
    return tokenData.access_token;
  }

  async function sendWithGmail(payload, connection) {
    let accessToken = await getAccessToken(connection);
    let response = await fetchImpl(GMAIL_SEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: buildRawEmail(payload) }),
    });

    if (response.status === 401) {
      accessToken = await getAccessToken(connection, { forceRefresh: true });
      response = await fetchImpl(GMAIL_SEND_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw: buildRawEmail(payload) }),
      });
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok || typeof data.id !== 'string') {
      if (response.status === 401) {
        await connectionModel.updateOne({ userId: connection.userId }, { $set: { needsReauth: true } });
        throw new EmailAssistantError('gmail_reconnect_required', 'Reconnect your Gmail account to continue.', 401);
      }
      throw new EmailAssistantError(
        response.status === 429 ? 'gmail_rate_limited' : 'gmail_send_failed',
        response.status === 429
          ? 'Gmail is temporarily rate limiting requests. Please try again later.'
          : 'Gmail could not send this message.',
        googleStatus(response.status)
      );
    }
    return data.id;
  }

  router.post('/send', authMiddleware, sendLimit, async (req, res) => {
    let sendRecord;
    let id;
    try {
      if (req.body?.confirmed !== true) {
        return res.status(400).json({ error: 'confirmation_required', message: 'Confirm the reviewed email before sending.' });
      }
      const payload = normalizeEmailPayload(req.body);
      const idempotencyKey = validateIdempotencyKey(req.body?.idempotencyKey);
      id = userId(req);
      await ensureDb();

      const connection = await connectionModel.findOne({ userId: id });
      if (!connection || connection.needsReauth) {
        return res.status(409).json({ error: 'gmail_not_connected', message: 'Connect or reconnect Gmail before sending.' });
      }
      const payloadHash = hashEmailPayload(payload);
      const priorContent = await sendModel.findOne({ userId: id, payloadHash });
      if (priorContent) {
        if (priorContent.status === 'sent') {
          return res.json({ success: true, status: 'sent', messageId: priorContent.gmailMessageId, duplicate: true });
        }
        return res.status(409).json({
          error: 'send_already_attempted',
          status: priorContent.status,
          message: 'This exact email was already processed and will not be sent again.',
        });
      }
      const existing = await sendModel.findOne({ userId: id, idempotencyKey });
      if (existing) {
        if (existing.payloadHash !== payloadHash) {
          return res.status(409).json({ error: 'confirmation_changed', message: 'This confirmation is for different email content. Review and confirm again.' });
        }
        if (existing.status === 'sent') {
          return res.json({ success: true, status: 'sent', messageId: existing.gmailMessageId, duplicate: true });
        }
        return res.status(409).json({
          error: 'send_already_attempted',
          status: existing.status,
          message: 'This email confirmation was already processed and will not be sent again.',
        });
      }

      try {
        sendRecord = await sendModel.create({
          userId: id,
          idempotencyKey,
          payloadHash,
          status: 'sending',
          expiresAt: new Date(now() + 90 * 24 * 60 * 60_000),
        });
      } catch (error) {
        if (error?.code !== 11000) throw error;
        const racedRecord = await sendModel.findOne({
          userId: id,
          $or: [{ idempotencyKey }, { payloadHash }],
        });
        if (racedRecord?.payloadHash === payloadHash && racedRecord.status === 'sent') {
          return res.json({ success: true, status: 'sent', messageId: racedRecord.gmailMessageId, duplicate: true });
        }
        return res.status(409).json({
          error: racedRecord?.payloadHash !== payloadHash ? 'confirmation_changed' : 'send_already_attempted',
          message: 'This email confirmation was already processed and will not be sent again.',
        });
      }

      const messageId = await sendWithGmail(payload, connection);
      await sendModel.updateOne(
        { _id: sendRecord._id, userId: id },
        { $set: { status: 'sent', gmailMessageId: messageId, failureCode: null } }
      );
      return res.json({ success: true, status: 'sent', messageId });
    } catch (error) {
      if (sendRecord) {
        try {
          const result = publicError(error);
          await sendModel.updateOne(
            { _id: sendRecord._id, userId: id },
            { $set: { status: 'failed', failureCode: result.body.error } }
          );
        } catch (trackingError) {
          console.error('FaceMeX email send status update failed', {
            errorName: trackingError instanceof Error ? trackingError.name : 'UnknownError',
          });
        }
      }
      const result = publicError(error);
      return res.status(result.statusCode).json(result.body);
    }
  });

  router.get('/send/:idempotencyKey/status', authMiddleware, connectionLimit, async (req, res) => {
    try {
      const key = validateIdempotencyKey(req.params.idempotencyKey);
      await ensureDb();
      const record = await sendModel.findOne({
        userId: userId(req),
        idempotencyKey: key,
      }).lean();
      if (!record) {
        return res.status(404).json({ error: 'send_status_not_found', message: 'No send attempt was found for this confirmation.' });
      }
      res.set('Cache-Control', 'no-store');
      return res.json({
        status: record.status,
        messageId: record.gmailMessageId || null,
        failureCode: record.failureCode || null,
        updatedAt: record.updatedAt || null,
      });
    } catch (error) {
      const result = publicError(error);
      return res.status(result.statusCode).json(result.body);
    }
  });

  return router;
}

export default createEmailRouter();
