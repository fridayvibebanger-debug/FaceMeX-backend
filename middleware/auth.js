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
    if (!token) return res.status(401).json({ error: 'unauthorized' });

    const payload = jwt.verify(token, JWT_SECRET);
    await connectDb();
    const user = await User.findById(payload.sub).lean();
    if (!user) return res.status(401).json({ error: 'unauthorized' });

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'unauthorized' });
  }
}
