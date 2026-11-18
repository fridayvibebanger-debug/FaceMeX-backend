import jwt from 'jsonwebtoken';
import { connectDb } from '../lib/db.js';
import { User } from '../models/User.js';

function jwtSecret() {
  return process.env.JWT_SECRET || 'faceme-dev-secret';
}

export function signToken(user) {
  return jwt.sign({ sub: user._id.toString(), email: user.email }, jwtSecret(), { expiresIn: '7d' });
}

export function createHybridAuth({
  env = process.env,
  fetchImpl = fetch,
  localAuth = requireAuth,
  messages = {},
} = {}) {
  const responseMessages = {
    missing: 'Sign in to continue.',
    expired: 'Your sign-in has expired. Sign in again.',
    unavailable: 'Sign-in could not be verified right now. Please try again.',
    ...messages,
  };
  return async (req, res, next) => {
    const token = String(req.headers.authorization || '').match(/^Bearer\s+(\S+)$/i)?.[1] || '';
    if (!token) {
      return res.status(401).json({ error: 'unauthorized', message: responseMessages.missing });
    }

    const signingSecret = env.JWT_SECRET ||
      (env.NODE_ENV === 'production' ? '' : 'faceme-dev-secret');
    let isLocalToken = false;
    if (signingSecret) {
      try {
        jwt.verify(token, signingSecret);
        isLocalToken = true;
      } catch {}
    }
    if (isLocalToken) {
      return localAuth(req, res, next);
    }

    const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
    const supabaseAnonKey = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      return res.status(401).json({ error: 'unauthorized', message: responseMessages.expired });
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
        return res.status(401).json({ error: 'unauthorized', message: responseMessages.expired });
      }
      if (!response.ok) {
        return res.status(503).json({ error: 'authentication_unavailable', message: responseMessages.unavailable });
      }

      const user = await response.json();
      if (!user || typeof user.id !== 'string') {
        return res.status(401).json({ error: 'unauthorized', message: responseMessages.missing });
      }
      req.user = {
        _id: user.id,
        id: user.id,
        email: user.email || '',
        name: user.user_metadata?.full_name || user.user_metadata?.name || '',
      };
      return next();
    } catch {
      return res.status(503).json({
        error: 'authentication_unavailable',
        message: responseMessages.unavailable,
      });
    } finally {
      clearTimeout(timeout);
    }
  };
}

export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [, token] = header.split(' ');
    if (!token) return res.status(401).json({ error: 'unauthorized' });

    const payload = jwt.verify(token, jwtSecret());
    await connectDb();
    const user = await User.findById(payload.sub).lean();
    if (!user) return res.status(401).json({ error: 'unauthorized' });

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'unauthorized' });
  }
}
