import { Router } from 'express';
import { User } from '../models/User.js';
import { toSessionUser } from '../lib/rbac.js';
import { createSessionToken } from '../lib/session.js';
import {
  setSessionCookie,
  clearSessionCookie,
} from '../lib/sessionCookie.js';
import {
  checkRateLimit,
  recordFailure,
  clearAttempts,
  getClientIp,
} from '../middleware/rateLimit.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.post('/login', async (req, res) => {
  const ip = getClientIp(req);
  const rate = checkRateLimit(`login:${ip}`);
  if (!rate.allowed) {
    res.set('Retry-After', String(rate.retryAfterSeconds));
    return res.status(429).json({
      error: 'too_many_attempts',
      message: `Too many failed attempts. Try again in ${Math.ceil(
        rate.retryAfterSeconds / 60,
      )} minute(s).`,
    });
  }

  const { username: rawUsername, password } = req.body ?? {};
  if (typeof rawUsername !== 'string' || typeof password !== 'string') {
    recordFailure(`login:${ip}`);
    return res.status(401).json({ error: 'invalid_username' });
  }

  const username = rawUsername.trim().toLowerCase();
  if (!/^[a-z0-9_]+$/.test(username)) {
    recordFailure(`login:${ip}`);
    return res.status(401).json({ error: 'invalid_username' });
  }

  const user = await User.findOne({ username }).populate('roleId');
  if (!user) {
    recordFailure(`login:${ip}`);
    return res.status(401).json({ error: 'invalid_username' });
  }

  const ok = await user.verifyPassword(password);
  if (!ok) {
    recordFailure(`login:${ip}`);
    return res.status(401).json({ error: 'invalid_password' });
  }

  // Checked after the password, so a wrong guess can't learn which accounts
  // are switched off.
  if (!user.active || !user.roleId) {
    return res.status(403).json({
      error: 'account_disabled',
      message: 'This account has been deactivated. Ask an admin to restore it.',
    });
  }

  clearAttempts(`login:${ip}`);
  user.lastLoginAt = new Date();
  await user.save();

  setSessionCookie(res, await createSessionToken(user));
  res.json({ user: toSessionUser(user) });
});

router.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;
