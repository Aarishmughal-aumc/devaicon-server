import { readSessionFromToken } from '../lib/session.js';
import { SESSION_COOKIE_NAME } from '../constants.js';

export async function loadUser(req, _res, next) {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  req.user = await readSessionFromToken(token);
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'forbidden' });
  }
  next();
}
