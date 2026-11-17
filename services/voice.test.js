import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import express from 'express';
import {
  SynthesizeSpeechCommand,
} from '@aws-sdk/client-polly';
import {
  createVoiceService,
  getVoiceProviderConfig,
  VoiceProviderError,
} from './voice.js';
import {
  createUserRateLimiter,
  createVoiceAuth,
  createVoiceRouter,
} from '../routes/voice.js';

const serverClosers = [];

after(async () => {
  await Promise.all(serverClosers.map((close) => close()));
});

function providerEnv(overrides = {}) {
  return {
    DEEPGRAM_API_KEY: 'deepgram-test-key',
    AWS_ACCESS_KEY_ID: 'aws-test-id',
    AWS_SECRET_ACCESS_KEY: 'aws-test-secret',
    AWS_REGION: 'us-east-1',
    AWS_POLLY_VOICE_ID: 'Joanna',
    ELEVENLABS_API_KEY: 'eleven-test-key',
    ELEVENLABS_VOICE_ID: 'voice-test-id',
    ELEVENLABS_MODEL_ID: 'eleven_multilingual_v2',
    ...overrides,
  };
}

function response(status, body, contentType = 'application/json') {
  return new Response(body, {
    status,
    headers: { 'Content-Type': contentType },
  });
}

async function createTestServer(router) {
  const app = express();
  app.use((_req, res, next) => {
    res.set('Connection', 'close');
    next();
  });
  app.use(express.json());
  app.use('/api/voice', router);
  const server = app.listen(0);
  server.keepAliveTimeout = 1;
  server.headersTimeout = 2_000;
  await new Promise((resolve) => server.once('listening', resolve));
  serverClosers.push(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('Deepgram transcription posts raw audio with configured model and language', async () => {
  let request;
  const service = createVoiceService({
    env: providerEnv({ DEEPGRAM_MODEL: 'nova-3', DEEPGRAM_LANGUAGE: 'en-ZA' }),
    fetchImpl: async (url, options) => {
      request = { url: new URL(url), options };
      return response(200, JSON.stringify({
        results: { channels: [{ alternatives: [{ transcript: '  Hello FaceMeX.  ' }] }] },
      }));
    },
  });

  const result = await service.transcribe({
    audio: Buffer.from('audio'),
    mimeType: 'audio/webm',
  });

  assert.equal(result.text, 'Hello FaceMeX.');
  assert.equal(result.provider, 'deepgram');
  assert.equal(request.url.searchParams.get('model'), 'nova-3');
  assert.equal(request.url.searchParams.get('language'), 'en-ZA');
  assert.equal(request.options.headers.Authorization, 'Token deepgram-test-key');
  assert.equal(request.options.headers['Content-Type'], 'audio/webm');
  assert.deepEqual(request.options.body, Buffer.from('audio'));
});

test('Deepgram configuration and provider failures are explicit', async () => {
  const missingKey = createVoiceService({ env: {} });
  await assert.rejects(
    missingKey.transcribe({ audio: Buffer.from('audio'), mimeType: 'audio/webm' }),
    (error) => error instanceof VoiceProviderError && error.statusCode === 503,
  );

  const unavailable = createVoiceService({
    env: providerEnv(),
    fetchImpl: async () => response(503, '{}'),
  });
  await assert.rejects(
    unavailable.transcribe({ audio: Buffer.from('audio'), mimeType: 'audio/webm' }),
    (error) => error.code === 'deepgram_request_failed' && error.statusCode === 502,
  );
});

test('AWS Polly synthesizes MP3 using configured region and voice', async () => {
  let clientOptions;
  let command;
  const service = createVoiceService({
    env: providerEnv(),
    fetchImpl: async () => assert.fail('Unexpected HTTP provider call'),
    createPollyClient: (options) => {
      clientOptions = options;
      return {
        send: async (input) => {
          command = input;
          return { AudioStream: Uint8Array.from([1, 2, 3]) };
        },
      };
    },
  });

  const result = await service.speak({ text: 'Hello Polly', provider: 'polly' });

  assert.equal(clientOptions.region, 'us-east-1');
  assert.deepEqual(clientOptions.credentials, {
    accessKeyId: 'aws-test-id',
    secretAccessKey: 'aws-test-secret',
  });
  assert.ok(command instanceof SynthesizeSpeechCommand);
  assert.deepEqual(command.input, {
    Text: 'Hello Polly',
    VoiceId: 'Joanna',
    OutputFormat: 'mp3',
    Engine: 'neural',
  });
  assert.equal(result.mimeType, 'audio/mpeg');
  assert.equal(result.provider, 'polly');
  assert.equal(Buffer.from(result.audio, 'base64').toString('hex'), '010203');
});

test('ElevenLabs synthesizes MP3 with configured voice and model', async () => {
  let request;
  const service = createVoiceService({
    env: providerEnv(),
    fetchImpl: async (url, options) => {
      request = { url: new URL(url), options };
      return response(200, Uint8Array.from([4, 5, 6]), 'audio/mpeg');
    },
    createPollyClient: () => assert.fail('Unexpected Polly client creation'),
  });

  const result = await service.speak({ text: 'Hello ElevenLabs', provider: 'elevenlabs' });

  assert.match(request.url.pathname, /voice-test-id$/);
  assert.equal(request.url.searchParams.get('output_format'), 'mp3_44100_128');
  assert.equal(request.options.headers['xi-api-key'], 'eleven-test-key');
  assert.deepEqual(JSON.parse(request.options.body), {
    text: 'Hello ElevenLabs',
    model_id: 'eleven_multilingual_v2',
  });
  assert.equal(result.provider, 'elevenlabs');
  assert.equal(result.fallbackUsed, false);
  assert.equal(Buffer.from(result.audio, 'base64').toString('hex'), '040506');
});

test('TTS falls back to Polly when selected ElevenLabs fails', async () => {
  const service = createVoiceService({
    env: providerEnv(),
    fetchImpl: async () => response(500, '{}'),
    createPollyClient: () => ({
      send: async () => ({ AudioStream: Buffer.from('polly-audio') }),
    }),
  });

  const result = await service.speak({ text: 'Fallback test', provider: 'elevenlabs' });
  assert.equal(result.provider, 'polly');
  assert.equal(result.fallbackUsed, true);
  assert.equal(Buffer.from(result.audio, 'base64').toString(), 'polly-audio');
});

test('TTS falls back to ElevenLabs when selected Polly fails', async () => {
  const service = createVoiceService({
    env: providerEnv(),
    fetchImpl: async () => response(200, Uint8Array.from([7, 8]), 'audio/mpeg'),
    createPollyClient: () => ({ send: async () => { throw new Error('AWS unavailable'); } }),
  });

  const result = await service.speak({ text: 'Fallback test', provider: 'polly' });
  assert.equal(result.provider, 'elevenlabs');
  assert.equal(result.fallbackUsed, true);
});

test('TTS returns a provider error if both providers fail', async () => {
  const service = createVoiceService({
    env: providerEnv(),
    fetchImpl: async () => response(500, '{}'),
    createPollyClient: () => ({ send: async () => { throw new Error('AWS unavailable'); } }),
  });

  await assert.rejects(
    service.speak({ text: 'No success-shaped fallback', provider: 'elevenlabs' }),
    (error) => error instanceof VoiceProviderError && error.statusCode === 502,
  );
});

test('provider availability never includes credentials', () => {
  const config = getVoiceProviderConfig(providerEnv());
  const serialized = JSON.stringify(config);
  assert.equal(config.transcription.available, true);
  assert.equal(config.tts.defaultProvider, 'elevenlabs');
  assert.equal(config.tts.fallbackProvider, 'polly');
  assert.equal(serialized.includes('test-key'), false);
  assert.equal(serialized.includes('test-secret'), false);
});

test('voice auth verifies Supabase sessions and rejects absent tokens', async () => {
  let nextCalled = false;
  const auth = createVoiceAuth({
    env: { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: 'anon-test-key' },
    fetchImpl: async (_url, options) => {
      assert.equal(options.headers.Authorization, 'Bearer supabase-session');
      return response(200, JSON.stringify({ id: 'user-id', email: 'user@example.test' }));
    },
    localAuth: (_req, res) => res.status(401).json({ error: 'unauthorized' }),
  });
  const req = { headers: { authorization: 'Bearer supabase-session' } };
  const res = { status: () => res, json: () => res };
  await auth(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(req.user.id, 'user-id');

  let missingStatus;
  await auth(
    { headers: {} },
    { status: (status) => { missingStatus = status; return { json() {} }; } },
    () => assert.fail('Unauthenticated request must not continue'),
  );
  assert.equal(missingStatus, 401);
});

test('voice rate limiter rejects requests beyond per-user limit', () => {
  let timestamp = 1000;
  const limiter = createUserRateLimiter({ limit: 1, windowMs: 60_000, now: () => timestamp });
  const makeResponse = () => ({
    headers: {},
    statusCode: 200,
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  });
  let nextCalls = 0;
  const req = { user: { id: 'same-user' }, ip: '127.0.0.1' };

  const first = makeResponse();
  limiter(req, first, () => { nextCalls += 1; });
  const second = makeResponse();
  limiter(req, second, () => { nextCalls += 1; });
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 429);
  assert.equal(nextCalls, 1);

  timestamp += 60_001;
  const afterWindow = makeResponse();
  limiter(req, afterWindow, () => { nextCalls += 1; });
  assert.equal(afterWindow.statusCode, 200);
  assert.equal(nextCalls, 2);
});

test('voice routes validate audio and text and require authentication', async () => {
  const baseUrl = await createTestServer(createVoiceRouter({
    env: providerEnv(),
    service: {
      transcribe: async () => ({ text: 'recognized words', provider: 'deepgram' }),
      speak: async () => ({ audio: 'YXVkaW8=', mimeType: 'audio/mpeg', provider: 'polly' }),
    },
    authMiddleware: (req, res, next) => {
      if (req.headers.authorization !== 'Bearer valid') {
        return res.status(401).json({ error: 'unauthorized' });
      }
      req.user = { id: 'test-user' };
      return next();
    },
  }));

  const unauthenticated = await fetch(`${baseUrl}/api/voice/providers`);
  assert.equal(unauthenticated.status, 401);

  const invalidType = await fetch(`${baseUrl}/api/voice/transcribe`, {
    method: 'POST',
    headers: { Authorization: 'Bearer valid', 'Content-Type': 'text/plain' },
    body: 'not audio',
  });
  assert.equal(invalidType.status, 415);

  const invalidAudio = await fetch(`${baseUrl}/api/voice/transcribe`, {
    method: 'POST',
    headers: { Authorization: 'Bearer valid', 'Content-Type': 'audio/webm' },
    body: Buffer.from('not an audio recording'),
  });
  assert.equal(invalidAudio.status, 400);

  const invalidText = await fetch(`${baseUrl}/api/voice/speak`, {
    method: 'POST',
    headers: { Authorization: 'Bearer valid', 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '   ' }),
  });
  assert.equal(invalidText.status, 400);

  const tooLong = await fetch(`${baseUrl}/api/voice/speak`, {
    method: 'POST',
    headers: { Authorization: 'Bearer valid', 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'x'.repeat(2501) }),
  });
  assert.equal(tooLong.status, 413);

  const speak = await fetch(`${baseUrl}/api/voice/speak`, {
    method: 'POST',
    headers: { Authorization: 'Bearer valid', 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Say hello', provider: 'polly' }),
  });
  assert.equal(speak.status, 200);
  assert.equal((await speak.json()).provider, 'polly');
});

test('transcribe route enforces the audio byte limit', async () => {
  const baseUrl = await createTestServer(createVoiceRouter({
    env: providerEnv(),
    service: { transcribe: async () => assert.fail('Oversized audio must not reach provider') },
    authMiddleware: (req, res, next) => {
      req.user = { id: 'test-user' };
      return next();
    },
  }));
  const oversized = await fetch(`${baseUrl}/api/voice/transcribe`, {
    method: 'POST',
    headers: { Authorization: 'Bearer valid', 'Content-Type': 'audio/webm' },
    body: Buffer.alloc(8 * 1024 * 1024 + 1),
  });
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).error, 'audio_too_large');
});
