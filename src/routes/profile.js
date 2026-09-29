import { Router } from 'express';
import { User } from '../models/User.js';
import { permissionsOf } from '../models/Role.js';
import { requireAuth } from '../middleware/auth.js';
import { toSessionUser } from '../lib/rbac.js';
import { createSessionToken } from '../lib/session.js';
import { setSessionCookie } from '../lib/sessionCookie.js';
import {
  checkRateLimit,
  recordFailure,
  clearAttempts,
} from '../middleware/rateLimit.js';
import { PERMISSIONS } from '../permissions.js';
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  DISPLAY_NAME_MAX_LENGTH,
} from '../constants.js';

/**
 * The signed-in person's own account: what the Settings tab shows and edits.
 * Everything here acts on req.user and nobody else, so it needs no permission
 * beyond being signed in.
 */
const router = Router();

router.use(requireAuth);

async function loadSelf(req) {
  return User.findById(req.user.id).populate('roleId');
}

/**
 * Every permission in the catalogue, whether the person holds it, and why:
 * 'role' (their role gives it), 'personal' (added for them), 'removed' (their
 * role gives it but it was taken away for them), or null (not part of their
 * access). The whole catalogue is sent so Settings can show what is missing
 * as well as what is there.
 */
function describeAccess(user) {
  const fromRole = permissionsOf(user.roleId);
  const held = toSessionUser(user).permissions;
  return PERMISSIONS.map((p) => {
    const has = held.includes(p.key);
    const inRole = fromRole.includes(p.key);
    let source = null;
    if (has) source = inRole ? 'role' : 'personal';
    else if (inRole) source = 'removed';
    return {
      key: p.key,
      group: p.group,
      label: p.label,
      description: p.description,
      held: has,
      source,
    };
  });
}

function profileBody(user) {
  return {
    user: toSessionUser(user),
    access: describeAccess(user),
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : '',
    createdAt: user.createdAt ? user.createdAt.toISOString() : '',
  };
}

router.get('/', async (req, res) => {
  try {
    const user = await loadSelf(req);
    res.json(profileBody(user));
  } catch (e) {
    console.error('GET /profile failed:', e?.message ?? e);
    res.status(500).json({ error: 'db_error' });
  }
});

router.patch('/', async (req, res) => {
  const displayName = String(req.body?.displayName ?? '').trim();
  if (displayName.length > DISPLAY_NAME_MAX_LENGTH) {
    return res.status(400).json({
      error: 'invalid_display_name',
      message: `Name must be at most ${DISPLAY_NAME_MAX_LENGTH} characters.`,
    });
  }
  try {
    const user = await loadSelf(req);
    user.displayName = displayName;
    await user.save();
    res.json(profileBody(user));
  } catch (e) {
    console.error('PATCH /profile failed:', e?.message ?? e);
    res.status(500).json({ error: 'db_error' });
  }
});

/**
 * Change your own password. The current one is required, and wrong guesses
 * count against a per-account limit, so a session left open on a shared
 * machine can't be used to work it out. Other devices are signed out; this
 * browser gets a fresh cookie.
 */
router.post('/password', async (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  const limitKey = `password:${req.user.id}`;
  const rate = checkRateLimit(limitKey);
  if (!rate.allowed) {
    res.set('Retry-After', String(rate.retryAfterSeconds));
    return res.status(429).json({
      error: 'too_many_attempts',
      message: `Too many wrong passwords. Try again in ${Math.ceil(
        rate.retryAfterSeconds / 60,
      )} minute(s).`,
    });
  }

  if (typeof newPassword !== 'string' || newPassword.length < PASSWORD_MIN_LENGTH) {
    return res.status(400).json({
      error: 'invalid_password',
      message: `New password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
    });
  }
  if (newPassword.length > PASSWORD_MAX_LENGTH) {
    return res.status(400).json({
      error: 'invalid_password',
      message: `New password must be at most ${PASSWORD_MAX_LENGTH} characters.`,
    });
  }

  try {
    const user = await loadSelf(req);
    const ok =
      typeof currentPassword === 'string' &&
      (await user.verifyPassword(currentPassword));
    if (!ok) {
      recordFailure(limitKey);
      return res.status(400).json({
        error: 'wrong_password',
        message: 'Your current password is not right.',
      });
    }
    clearAttempts(limitKey);

    user.passwordHash = await User.hashPassword(newPassword);
    user.sessionVersion += 1;
    await user.save();
    setSessionCookie(res, await createSessionToken(user));
    res.json({ ok: true });
  } catch (e) {
    console.error('POST /profile/password failed:', e?.message ?? e);
    res.status(500).json({ error: 'db_error' });
  }
});

// Sign out every other device, keeping this one.
router.post('/sign-out-others', async (req, res) => {
  try {
    const user = await loadSelf(req);
    user.sessionVersion += 1;
    await user.save();
    setSessionCookie(res, await createSessionToken(user));
    res.json({ ok: true });
  } catch (e) {
    console.error('POST /profile/sign-out-others failed:', e?.message ?? e);
    res.status(500).json({ error: 'db_error' });
  }
});

export default router;
