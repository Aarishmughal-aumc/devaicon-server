import mongoose from 'mongoose';
import { readSessionFromToken } from '../lib/session.js';
import { clearSessionCookie } from '../lib/sessionCookie.js';
import { User } from '../models/User.js';
import { toSessionUser } from '../lib/rbac.js';
import { SESSION_COOKIE_NAME } from '../constants.js';

/**
 * Resolve the session cookie to a live user. `req.user` is
 * `{ id, username, displayName, role: { id, name, isOwner }, permissions }`
 * (see toSessionUser), or null.
 *
 * A cookie that fails here is cleared in the response. The Next proxy only
 * checks the token's signature, so a signed-but-revoked cookie left in place
 * would have it send /login to /dashboard and the dashboard back to /login.
 */
export async function loadUser(req, res, next) {
  req.user = null;
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  if (!token) return next();

  try {
    const session = await readSessionFromToken(token);
    if (session && mongoose.isValidObjectId(session.userId)) {
      const user = await User.findById(session.userId)
        .select(
          'username displayName roleId active sessionVersion permissionOverrides',
        )
        .populate('roleId')
        .lean();
      if (
        user &&
        user.active &&
        user.roleId &&
        (user.sessionVersion ?? 0) === session.version
      ) {
        req.user = toSessionUser(user);
      }
    }
  } catch (e) {
    return next(e);
  }

  if (!req.user) clearSessionCookie(res);
  next();
}

export function can(user, permission) {
  return Boolean(user?.permissions.includes(permission));
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  next();
}

/** Every listed permission is required. Implies requireAuth. */
export function requirePermission(...permissions) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'unauthorized' });
    if (!permissions.every((p) => can(req.user, p))) {
      return res.status(403).json({ error: 'forbidden' });
    }
    next();
  };
}

/** At least one of the listed permissions is required. Implies requireAuth. */
export function requireAnyPermission(...permissions) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'unauthorized' });
    if (!permissions.some((p) => can(req.user, p))) {
      return res.status(403).json({ error: 'forbidden' });
    }
    next();
  };
}
