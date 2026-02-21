import jwt from 'jsonwebtoken';
import { connectDb } from '../lib/db.js';
import { User } from '../models/User.js';

const JWT_SECRET = process.env.JWT_SECRET || 'faceme-dev-secret';

export function signToken(user) {
  return jwt.sign({ sub: user._id.toString(), email: user.email }, JWT_SECRET, { expiresIn: '7d' });
}

export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [, token] = header.split(' ');
    await connectDb();

    // 1) Preferred: our own JWT
    if (token) {
      try {
        const payload = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(payload.sub).lean();
        if (user) {
          req.user = user;
          return next();
        }
      } catch {
        // fall through
      }
    }

    // 2) Fallback: x-user-id (used by frontend for Supabase auth)
    const externalIdRaw = req.headers['x-user-id'];
    const externalId = Array.isArray(externalIdRaw) ? externalIdRaw[0] : externalIdRaw;
    const externalIdStr = String(externalId || '').trim();
    if (externalIdStr) {
      let user = await User.findOne({ externalId: externalIdStr }).lean();
      if (!user) {
        const created = await User.create({ externalId: externalIdStr, name: 'FaceMe User' });
        user = created.toObject();
      }
      req.user = user;
      return next();
    }

    return res.status(401).json({ error: 'unauthorized' });
  } catch (err) {
    return res.status(401).json({ error: 'unauthorized' });
  }
}
