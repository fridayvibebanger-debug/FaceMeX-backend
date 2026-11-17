import { Router, raw } from 'express';
import jwt from 'jsonwebtoken';
import { requireAuth } from '../middleware/auth.js';
import { createVoiceService, VoiceProviderError, getVoiceProviderConfig } from '../services/voice.js';

const AUDIO_MIME_TYPES = new Set([
  'audio/aac',
  'audio/flac',
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'audio/x-wav',
]);
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_LENGTH = 2500;
const LANGUAGE_PATTERN = /^[a-z]{2,3}(?:-[A-Z]{2})?$/;

function getBearerToken(req) {
  return String(req.headers.authorization || '').match(/^Bearer\s+(\S+)$/i)?.[1] || '';
}

export function createVoiceAuth({
  env = process.env,
  fetchImpl = fetch,
  localAuth = requireAuth,
} = {}) {
  return async (req, res, next) => {
    const token = getBearerToken(req);
    if (!token) return res.status(401).json({ error: 'unauthorized', message: 'Sign in to use voice mode.' });

    try {
      jwt.verify(token, env.JWT_SECRET || 'faceme-dev-secret');
      return localAuth(req, res, next);
    } catch {
      const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
      const supabaseAnonKey = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !supabaseAnonKey) {
        return localAuth(req, res, next);
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => {
        const error = new Error('Authentication request timed out.');
        error.name = 'TimeoutError';
        controller.abort(error);
      }, 5_000);
      timeout.unref?.();
      try {
        const endpoint = new URL('/auth/v1/user', supabaseUrl);
        const response = await fetchImpl(endpoint, {
          headers: {
            apikey: supabaseAnonKey,
            Authorization: `Bearer ${token}`,
          },
          signal: controller.signal,
        });
        if (response.status === 401 || response.status === 403) {
          return res.status(401).json({ error: 'unauthorized', message: 'Your FaceMeX sign-in has expired. Sign in again.' });
        }
        if (!response.ok) {
          return res.status(503).json({ error: 'authentication_unavailable', message: 'FaceMeX authentication is temporarily unavailable.' });
        }

        const user = await response.json();
        if (!user || typeof user.id !== 'string') {
          return res.status(401).json({ error: 'unauthorized', message: 'Sign in to use voice mode.' });
        }

        req.user = {
          _id: user.id,
          id: user.id,
          email: user.email || '',
          name: user.user_metadata?.full_name || user.user_metadata?.name || '',
        };
        return next();
      } catch (error) {
        if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
          return res.status(503).json({ error: 'authentication_unavailable', message: 'FaceMeX authentication is temporarily unavailable.' });
        }
        return res.status(503).json({ error: 'authentication_unavailable', message: 'FaceMeX authentication is temporarily unavailable.' });
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}

export function createUserRateLimiter({ limit, windowMs = 60_000, now = Date.now } = {}) {
  const requests = new Map();
  return (req, res, next) => {
    const userId = String(req.user?._id || req.user?.id || req.ip || 'unknown');
    const timestamp = now();
    let record = requests.get(userId);
    if (!record || timestamp - record.startedAt >= windowMs) {
      record = { startedAt: timestamp, count: 0 };
      requests.set(userId, record);
    }

    record.count += 1;
    res.set('RateLimit-Limit', String(limit));
    res.set('RateLimit-Remaining', String(Math.max(0, limit - record.count)));
    res.set('RateLimit-Reset', String(Math.ceil((record.startedAt + windowMs) / 1000)));
    if (record.count > limit) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((record.startedAt + windowMs - timestamp) / 1000))));
      return res.status(429).json({ error: 'rate_limited', message: 'Too many voice requests. Please wait and try again.' });
    }
    return next();
  };
}

function contentType(req) {
  return String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
}

function validAudioSignature(audio, mimeType) {
  if (mimeType === 'audio/webm') return audio.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (mimeType === 'audio/ogg') return audio.subarray(0, 4).toString('ascii') === 'OggS';
  if (mimeType === 'audio/flac') return audio.subarray(0, 4).toString('ascii') === 'fLaC';
  if (mimeType === 'audio/wav' || mimeType === 'audio/x-wav') {
    return audio.length >= 12 &&
      audio.subarray(0, 4).toString('ascii') === 'RIFF' &&
      audio.subarray(8, 12).toString('ascii') === 'WAVE';
  }
  if (mimeType === 'audio/mp4') return audio.length >= 8 && audio.subarray(4, 8).toString('ascii') === 'ftyp';
  if (mimeType === 'audio/mpeg') {
    return audio.subarray(0, 3).toString('ascii') === 'ID3' ||
      (audio.length >= 2 && audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0);
  }
  if (mimeType === 'audio/aac') {
    return audio.length >= 2 && audio[0] === 0xff && (audio[1] & 0xf6) === 0xf0;
  }
  return false;
}

function errorResponse(res, error) {
  if (error instanceof VoiceProviderError) {
    return res.status(error.statusCode).json({ error: error.code, message: error.message });
  }
  console.error('FaceMeX voice request failed', {
    errorName: error instanceof Error ? error.name : 'UnknownError',
  });
  return res.status(502).json({ error: 'voice_request_failed', message: 'The voice request could not be completed.' });
}

export function createVoiceRouter({
  env = process.env,
  service = createVoiceService({ env }),
  authMiddleware = createVoiceAuth({ env }),
  now,
} = {}) {
  const router = Router();
  const providersLimiter = createUserRateLimiter({ limit: 60, ...(now ? { now } : {}) });
  const transcribeLimiter = createUserRateLimiter({ limit: 10, ...(now ? { now } : {}) });
  const speakLimiter = createUserRateLimiter({ limit: 20, ...(now ? { now } : {}) });

  router.get('/providers', authMiddleware, providersLimiter, (_req, res) => {
    res.set('Cache-Control', 'no-store');
    return res.json(getVoiceProviderConfig(env));
  });

  router.post(
    '/transcribe',
    authMiddleware,
    transcribeLimiter,
    (req, res, next) => {
      if (!AUDIO_MIME_TYPES.has(contentType(req))) {
        return res.status(415).json({ error: 'unsupported_audio_type', message: 'Use a supported audio recording format.' });
      }
      return next();
    },
    raw({
      type: (req) => AUDIO_MIME_TYPES.has(contentType(req)),
      limit: MAX_AUDIO_BYTES,
    }),
    async (req, res) => {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: 'invalid_audio', message: 'The recording is empty or invalid.' });
      }
      if (req.body.length > MAX_AUDIO_BYTES) {
        return res.status(413).json({ error: 'audio_too_large', message: 'Recordings must be 8 MB or smaller.' });
      }
      if (!validAudioSignature(req.body, contentType(req))) {
        return res.status(400).json({ error: 'invalid_audio', message: 'The recording format does not match its audio content.' });
      }

      const language = typeof req.query.language === 'string' ? req.query.language : '';
      if (language && !LANGUAGE_PATTERN.test(language)) {
        return res.status(400).json({ error: 'invalid_language', message: 'Choose a supported language code.' });
      }

      try {
        const result = await service.transcribe({
          audio: req.body,
          mimeType: contentType(req),
          language: language || undefined,
        });
        res.set('Cache-Control', 'no-store');
        return res.json(result);
      } catch (error) {
        return errorResponse(res, error);
      }
    },
  );

  router.post('/speak', authMiddleware, speakLimiter, async (req, res) => {
    const { text, provider } = req.body || {};
    if (typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'invalid_text', message: 'Text is required for speech generation.' });
    }
    if (text.trim().length > MAX_TEXT_LENGTH) {
      return res.status(413).json({ error: 'text_too_long', message: `Speech text must be ${MAX_TEXT_LENGTH} characters or fewer.` });
    }
    if (provider !== undefined && !['elevenlabs', 'polly'].includes(provider)) {
      return res.status(400).json({ error: 'invalid_tts_provider', message: 'Choose ElevenLabs or Amazon Polly.' });
    }

    try {
      const result = await service.speak({ text: text.trim(), provider });
      res.set('Cache-Control', 'no-store');
      return res.json(result);
    } catch (error) {
      return errorResponse(res, error);
    }
  });

  router.use((error, _req, res, next) => {
    if (error?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'audio_too_large', message: 'Recordings must be 8 MB or smaller.' });
    }
    if (error?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'invalid_audio', message: 'The recording is invalid.' });
    }
    return next(error);
  });

  return router;
}
