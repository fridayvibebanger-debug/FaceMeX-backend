import mongoose from 'mongoose';
import { connectDb } from '../lib/db.js';

function clean(value) {
  return String(value || '').trim();
}

function getBearerToken(req) {
  const header = clean(req.headers.authorization || req.headers.Authorization);

  if (!header) return '';

  if (header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim();
  }

  return header;
}

function getSupabaseEnv() {
  return {
    url:
      process.env.SUPABASE_URL ||
      process.env.VITE_SUPABASE_URL ||
      '',

    anonKey:
      process.env.SUPABASE_ANON_KEY ||
      process.env.VITE_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      '',
  };
}

async function getSupabaseUserFromToken(token) {
  const { url, anonKey } = getSupabaseEnv();

  if (!url || !anonKey) {
    throw new Error('SUPABASE_URL or SUPABASE_ANON_KEY missing on backend');
  }

  const response = await fetch(`${url.replace(/\/+$/, '')}/auth/v1/user`, {
    method: 'GET',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.id) {
    throw new Error('invalid_supabase_token');
  }

  return data;
}

function getNameFromSupabaseUser(user) {
  return clean(
    user?.user_metadata?.full_name ||
      user?.user_metadata?.name ||
      user?.user_metadata?.username ||
      user?.email ||
      'FaceMeX user'
  );
}

async function findOrCreateMongoUserFromSupabase(supaUser) {
  await connectDb();

  const supabaseId = clean(supaUser.id);
  const email = clean(supaUser.email);
  const name = getNameFromSupabaseUser(supaUser);

  if (!mongoose.connection?.db) {
    throw new Error('MongoDB not connected');
  }

  const users = mongoose.connection.collection('users');

  const existing = await users.findOne({
    $or: [
      { supabaseId },
      { supabase_id: supabaseId },
      { id: supabaseId },
      ...(email ? [{ email }] : []),
    ],
  });

  if (existing?._id) {
    await users.updateOne(
      { _id: existing._id },
      {
        $set: {
          supabaseId,
          supabase_id: supabaseId,
          id: existing.id || supabaseId,
          email: existing.email || email,
          name: existing.name || name,
          fullName: existing.fullName || name,
          updatedAt: new Date(),
        },
      }
    );

    return {
      ...existing,
      _id: existing._id,
      id: existing.id || supabaseId,
      supabaseId,
      email: existing.email || email,
      name: existing.name || name,
      tier: existing.tier || 'free',
      addons: existing.addons || { verified: false },
    };
  }

  const now = new Date();

  const insert = await users.insertOne({
    supabaseId,
    supabase_id: supabaseId,
    id: supabaseId,
    email,
    name,
    fullName: name,
    avatar: clean(supaUser?.user_metadata?.avatar_url || ''),
    tier: 'free',
    subscriptionTier: 'free',
    subscriptionStatus: 'inactive',
    addons: {
      verified: false,
    },
    createdAt: now,
    updatedAt: now,
  });

  return {
    _id: insert.insertedId,
    id: supabaseId,
    supabaseId,
    email,
    name,
    tier: 'free',
    addons: { verified: false },
  };
}

export async function requireAuth(req, res, next) {
  try {
    const token = getBearerToken(req);

    if (!token) {
      return res.status(401).json({
        ok: false,
        error: 'unauthorized',
        message: 'Missing login token.',
      });
    }

    const supaUser = await getSupabaseUserFromToken(token);
    const mongoUser = await findOrCreateMongoUserFromSupabase(supaUser);

    req.user = {
      _id: mongoUser._id,
      id: mongoUser.id || supaUser.id,
      supabaseId: supaUser.id,
      email: mongoUser.email || supaUser.email || '',
      name: mongoUser.name || getNameFromSupabaseUser(supaUser),
      tier: mongoUser.tier || 'free',
      addons: mongoUser.addons || { verified: false },
    };

    return next();
  } catch (err) {
    console.error('requireAuth error:', err?.message || err);

    return res.status(401).json({
      ok: false,
      error: 'unauthorized',
      message: err?.message || 'Unauthorized',
    });
  }
}

export function optionalAuth(req, _res, next) {
  try {
    return next();
  } catch {
    return next();
  }
}
