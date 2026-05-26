import { Router } from 'express';
import { User } from '../models/User.js';
import { createSessionToken } from '../lib/session.js';
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
} from '../constants.js';
import {
  checkRateLimit,
  recordFailure,
  clearAttempts,
  getClientIp,
} from '../middleware/rateLimit.js';
import { requireAuth } from '../middleware/auth.js';
import { isProd } from '../config/env.js';

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

  const user = await User.findOne({ username });
  if (!user) {
    recordFailure(`login:${ip}`);
    return res.status(401).json({ error: 'invalid_username' });
  }

  const ok = await user.verifyPassword(password);
  if (!ok) {
    recordFailure(`login:${ip}`);
    return res.status(401).json({ error: 'invalid_password' });
  }

  clearAttempts(`login:${ip}`);
  const sessionUser = user.toSessionUser();
  const token = await createSessionToken(sessionUser);

  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS * 1000,
  });
  res.json({ user: sessionUser });
});

router.post('/logout', (_req, res) => {
  res.cookie(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;
