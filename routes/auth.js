import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { connectDb } from '../lib/db.js';
import { User } from '../models/User.js';
import { signToken, requireAuth } from '../middleware/auth.js';

const router = Router();

router.post('/register', async (req, res) => {
  await connectDb();
  const { email, password, name } = req.body || {};
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  const trimmedName = String(name).trim();
  const nameParts = trimmedName.split(/\s+/).filter(Boolean);
  if (nameParts.length < 2) {
    return res.status(400).json({ error: 'invalid_name' });
  }

  const emailStr = String(email).trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(emailStr)) {
    return res.status(400).json({ error: 'invalid_email' });
  }

  const passwordStr = String(password);
  if (passwordStr.length < 8) {
    return res.status(400).json({ error: 'password_too_short' });
  }
  // Simple strength check: letters + numbers or special char
  const hasLetter = /[A-Za-z]/.test(passwordStr);
  const hasNumber = /[0-9]/.test(passwordStr);
  const hasSpecial = /[^A-Za-z0-9]/.test(passwordStr);
  if (!(hasLetter && (hasNumber || hasSpecial))) {
    return res.status(400).json({ error: 'weak_password' });
  }

  const existing = await User.findOne({ email: emailStr });
  if (existing) return res.status(409).json({ error: 'email_in_use' });

  const passwordHash = await bcrypt.hash(passwordStr, 10);
  const user = await User.create({ email: emailStr, passwordHash, name: trimmedName });
  const token = signToken(user);
  return res.status(201).json({
    token,
    user: {
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      tier: user.tier,
      addons: user.addons,
      mode: user.mode,
    },
  });
});

router.post('/login', async (req, res) => {
  await connectDb();
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'missing_fields' });

  const emailStr = String(email).trim().toLowerCase();
  const user = await User.findOne({ email: emailStr });
  if (!user) return res.status(404).json({ error: 'account_not_found' });

  const ok = await bcrypt.compare(String(password), user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'invalid_credentials' });

  const token = signToken(user);
  return res.json({
    token,
    user: {
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      tier: user.tier,
      addons: user.addons,
      mode: user.mode,
    },
  });
});

router.get('/me', requireAuth, async (req, res) => {
  const user = req.user;
  return res.json({
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    avatar: user.avatar,
    tier: user.tier,
    addons: user.addons,
    mode: user.mode,
    professional: user.professional || null,
  });
});

export default router;
