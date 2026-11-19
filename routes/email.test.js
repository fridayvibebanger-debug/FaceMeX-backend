import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createEmailRouter } from './email.js';
import { requireAuth } from '../middleware/auth.js';
import { encryptToken, hashOAuthState } from '../services/emailAssistant.js';

const now = () => 1_800_000_000_000;
const env = {
  NODE_ENV: 'test',
  JWT_SECRET: 'test-secret',
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  GOOGLE_REDIRECT_URI: 'https://api.example.com/api/email/google/callback',
  GMAIL_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
  CLIENT_ORIGIN: 'https://facemexsocial.com',
};
const idempotencyKey = '00000000-0000-4000-8000-000000000001';

function createModels() {
  const states = new Map();
  const connections = new Map();
  const sends = new Map();
  let nextSendId = 0;
  const promiseQuery = (getValue) => {
    const query = Promise.resolve().then(getValue);
    query.lean = () => Promise.resolve().then(getValue);
    return query;
  };

  return {
    states,
    connections,
    sends,
    stateModel: {
      async create(record) {
        states.set(record.stateHash, record);
        return record;
      },
      findOneAndDelete(query) {
        const getValue = () => {
          const record = states.get(query.stateHash);
          if (!record || record.expiresAt <= query.expiresAt.$gt) return null;
          states.delete(query.stateHash);
          return record;
        };
        return {
          lean: () => Promise.resolve().then(getValue),
          then: (resolve, reject) => Promise.resolve().then(getValue).then(resolve, reject),
        };
      },
    },
    connectionModel: {
      findOne(query) {
        return promiseQuery(() => connections.get(query.userId) || null);
      },
      async findOneAndUpdate(query, update) {
        const record = {
          userId: query.userId,
          ...(connections.get(query.userId) || {}),
          ...update.$set,
        };
        connections.set(query.userId, record);
        return record;
      },
      async updateOne(query, update) {
        const record = connections.get(query.userId);
        if (record) Object.assign(record, update.$set);
        return { matchedCount: record ? 1 : 0 };
      },
      async deleteOne(query) {
        const deleted = connections.delete(query.userId);
        return { deletedCount: deleted ? 1 : 0 };
      },
    },
    sendModel: {
      findOne(query) {
        return promiseQuery(() => {
          if (query.payloadHash) {
            return Array.from(sends.values()).find((item) =>
              item.userId === query.userId && item.payloadHash === query.payloadHash
            ) || null;
          }
          if (query.$or) {
            return Array.from(sends.values()).find((item) =>
              item.userId === query.userId &&
              query.$or.some((condition) =>
                (condition.idempotencyKey && item.idempotencyKey === condition.idempotencyKey) ||
                (condition.payloadHash && item.payloadHash === condition.payloadHash)
              )
            ) || null;
          }
          return sends.get(`${query.userId}:${query.idempotencyKey}`) || null;
        });
      },
      async create(record) {
        const key = `${record.userId}:${record.idempotencyKey}`;
        if (sends.has(key)) {
          const error = new Error('duplicate');
          error.code = 11000;
          throw error;
        }
        const saved = { ...record, _id: String(++nextSendId) };
        sends.set(key, saved);
        return saved;
      },
      async updateOne(query, update) {
        const record = Array.from(sends.values()).find((item) => item._id === query._id);
        if (record) Object.assign(record, update.$set);
        return { matchedCount: record ? 1 : 0 };
      },
    },
  };
}

async function createHarness(t, options = {}) {
  const app = express();
  app.use(express.json());
  const models = options.models || createModels();
  const authMiddleware = options.authMiddleware || ((req, _res, next) => {
    req.user = { _id: 'face-user-1' };
    next();
  });
  const requestFetch = globalThis.fetch;
  app.use('/api/email', createEmailRouter({
    env,
    now,
    ...models,
    connectDbFn: async () => ({}),
    mongooseInstance: { connection: { readyState: 1 } },
    authMiddleware,
    generateDraft: options.useRealAiRouter
      ? undefined
      : options.generateDraft || (async () => JSON.stringify({
          recipientEmail: 'not-to-be-trusted@example.com',
          recipientName: 'Not Trusted',
          subject: 'A professional enquiry',
          body: 'I would like to learn more.',
          signature: 'Kind regards',
        })),
    randomBytesImpl: (length) => Buffer.alloc(length, 1),
    fetchImpl: options.fetchImpl || (async () => Response.json({ id: 'gmail-message-1' })),
  }));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => error ? reject(error) : resolve());
  }));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}/api/email`;
  return {
    ...models,
    baseUrl,
    async request(path, { method = 'GET', body, redirect = 'follow' } = {}) {
      const response = await requestFetch(`${baseUrl}${path}`, {
        method,
        redirect,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
      return { response, data };
    },
  };
}

test('generation is authenticated and never returns an invented recipient', async (t) => {
  const h = await createHarness(t);
  const { response, data } = await h.request('/generate', {
    method: 'POST',
    body: { prompt: 'Write a business enquiry.' },
  });
  assert.equal(response.status, 200);
  assert.equal(data.draft.recipientEmail, null);
  assert.equal(data.draft.recipientName, null);
  assert.equal(data.draft.subject, 'A professional enquiry');
});

test('generation rejects malformed recipient addresses', async (t) => {
  const h = await createHarness(t);
  const { response, data } = await h.request('/generate', {
    method: 'POST',
    body: { prompt: 'Write an email.', recipientEmail: 'invalid' },
  });
  assert.equal(response.status, 400);
  assert.equal(data.error, 'invalid_recipient');
});

test('email generation uses the existing FaceMeX AI provider router', async (t) => {
  const originalGroqKey = process.env.GROQ_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.GROQ_API_KEY = 'test-only-provider-key';
  const expectedDraft = {
    recipientEmail: '',
    recipientName: '',
    subject: 'Meeting follow-up',
    body: 'Thank you for meeting with me today.',
    signature: 'Kind regards',
  };
  let providerCalls = 0;
  globalThis.fetch = async (url, options) => {
    providerCalls += 1;
    assert.equal(String(url), 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(options.method, 'POST');
    const requestBody = JSON.parse(options.body);
    assert.ok(requestBody.messages.some((message) =>
      message.role === 'user' && message.content.includes('Write a follow-up email')
    ));
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(expectedDraft) } }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalGroqKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalGroqKey;
  });

  const h = await createHarness(t, { useRealAiRouter: true });
  const { response, data } = await h.request('/generate', {
    method: 'POST',
    body: {
      prompt: 'Write a follow-up email after my meeting.',
      recipientEmail: 'person@example.com',
    },
  });

  assert.equal(response.status, 200);
  assert.equal(providerCalls, 1);
  assert.equal(data.draft.recipientEmail, 'person@example.com');
  assert.equal(data.draft.subject, expectedDraft.subject);
  assert.equal(data.draft.body, expectedDraft.body);
  assert.equal(data.draft.signature, expectedDraft.signature);
});

test('Gmail connect requests only the sending scope and callback consumes OAuth state once', async (t) => {
  const h = await createHarness(t, {
    fetchImpl: async (url) => {
      assert.equal(String(url), 'https://oauth2.googleapis.com/token');
      return Response.json({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 3600,
      });
    },
  });
  const connect = await h.request('/google/connect');
  assert.equal(connect.response.status, 200);
  const authorizationUrl = new URL(connect.data.authorizationUrl);
  assert.equal(authorizationUrl.searchParams.get('scope'), 'https://www.googleapis.com/auth/gmail.send');
  assert.equal(authorizationUrl.searchParams.get('access_type'), 'offline');

  const state = authorizationUrl.searchParams.get('state');
  assert.ok(h.states.has(hashOAuthState(state)));
  const callback = await h.request(`/google/callback?state=${state}&code=auth-code`, { redirect: 'manual' });
  assert.equal(callback.response.status, 302, String(callback.data));
  assert.match(callback.response.headers.get('location'), /gmail=connected/);
  assert.equal(h.connections.get('face-user-1') !== undefined, true);
  const status = await h.request('/google/status');
  assert.equal(status.data.connected, true);

  const duplicateCallback = await h.request(`/google/callback?state=${state}&code=auth-code`, { redirect: 'manual' });
  assert.equal(duplicateCallback.response.status, 400);
});

test('OAuth cancellation returns to FaceMeX without connecting Gmail', async (t) => {
  const h = await createHarness(t);
  const connect = await h.request('/google/connect');
  const state = new URL(connect.data.authorizationUrl).searchParams.get('state');
  const callback = await h.request(`/google/callback?state=${state}&error=access_denied`, { redirect: 'manual' });
  assert.equal(callback.response.status, 302);
  assert.match(callback.response.headers.get('location'), /gmail=cancelled/);
  assert.equal(h.connections.has('face-user-1'), false);
});

test('unconfirmed and invalid emails are never sent', async (t) => {
  let gmailCalls = 0;
  const h = await createHarness(t, {
    fetchImpl: async () => {
      gmailCalls += 1;
      return Response.json({ id: 'unexpected' });
    },
  });
  h.connections.set('face-user-1', {
    userId: 'face-user-1',
    encryptedAccessToken: encryptToken('access', env),
    encryptedRefreshToken: encryptToken('refresh', env),
    accessTokenExpiresAt: new Date(now() + 3_600_000),
    needsReauth: false,
  });

  const unconfirmed = await h.request('/send', {
    method: 'POST',
    body: {
      to: 'person@example.com',
      subject: 'Hello',
      message: 'Hello',
      idempotencyKey,
    },
  });
  assert.equal(unconfirmed.response.status, 400);
  assert.equal(unconfirmed.data.error, 'confirmation_required');

  const invalid = await h.request('/send', {
    method: 'POST',
    body: {
      confirmed: true,
      to: 'invalid',
      subject: 'Hello',
      message: 'Hello',
      idempotencyKey,
    },
  });
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.data.error, 'invalid_recipient');
  assert.equal(gmailCalls, 0);
});

test('confirmed sends refresh expired access tokens and do not duplicate on retry', async (t) => {
  let refreshCalls = 0;
  let gmailCalls = 0;
  const h = await createHarness(t, {
    fetchImpl: async (url, options) => {
      if (String(url) === 'https://oauth2.googleapis.com/token') {
        refreshCalls += 1;
        assert.match(String(options.body), /grant_type=refresh_token/);
        return Response.json({ access_token: 'fresh-access-token', expires_in: 3600 });
      }
      gmailCalls += 1;
      assert.equal(options.headers.Authorization, 'Bearer fresh-access-token');
      return Response.json({ id: 'gmail-message-1' });
    },
  });
  h.connections.set('face-user-1', {
    userId: 'face-user-1',
    encryptedAccessToken: encryptToken('expired-access-token', env),
    encryptedRefreshToken: encryptToken('refresh-token', env),
    accessTokenExpiresAt: new Date(now() - 1_000),
    needsReauth: false,
  });
  const body = {
    confirmed: true,
    to: 'person@example.com',
    subject: 'Hello',
    message: 'Hello there.',
    idempotencyKey,
  };

  const first = await h.request('/send', { method: 'POST', body });
  const retry = await h.request('/send', { method: 'POST', body });
  const sameEmailNewKey = await h.request('/send', {
    method: 'POST',
    body: { ...body, idempotencyKey: '00000000-0000-4000-8000-000000000002' },
  });
  assert.equal(first.response.status, 200);
  assert.equal(retry.response.status, 200);
  assert.equal(retry.data.duplicate, true);
  assert.equal(sameEmailNewKey.data.duplicate, true);
  assert.equal(gmailCalls, 1);
  assert.equal(refreshCalls, 1);
  const status = await h.request(`/send/${idempotencyKey}/status`);
  assert.equal(status.response.status, 200);
  assert.equal(status.data.status, 'sent');
});

test('unauthorized requests are rejected', async (t) => {
  const h = await createHarness(t, {
    authMiddleware: requireAuth,
  });
  const { response, data } = await h.request('/google/status');
  assert.equal(response.status, 401);
  assert.equal(data.error, 'unauthorized');
});
