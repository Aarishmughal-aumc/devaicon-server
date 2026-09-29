import { Router } from 'express';
import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { Role, permissionsOf, effectivePermissions } from '../models/Role.js';
import { PERMISSION_KEYS } from '../permissions.js';
import { requirePermission } from '../middleware/auth.js';
import { isLastActiveOwner } from '../lib/rbac.js';
import { createSessionToken } from '../lib/session.js';
import { setSessionCookie } from '../lib/sessionCookie.js';
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  DISPLAY_NAME_MAX_LENGTH,
} from '../constants.js';

const router = Router();

router.use(requirePermission('users.manage'));

function serializeUser(u) {
  const overrides = {
    granted: [...(u.permissionOverrides?.granted ?? [])],
    revoked: [...(u.permissionOverrides?.revoked ?? [])],
  };
  return {
    id: u._id.toString(),
    username: u.username,
    displayName: u.displayName ?? '',
    permissions: u.roleId ? effectivePermissions(u.roleId, overrides) : [],
    overrides,
    role: u.roleId
      ? {
          id: u.roleId._id.toString(),
          name: u.roleId.name,
          isOwner: Boolean(u.roleId.isOwner),
        }
      : null,
    active: u.active !== false,
    lastLoginAt: u.lastLoginAt ? new Date(u.lastLoginAt).toISOString() : '',
    createdAt: u.createdAt ? new Date(u.createdAt).toISOString() : '',
  };
}

function passwordProblem(password) {
  if (typeof password !== 'string') return 'Password is required.';
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
  }
  return null;
}

async function findRole(roleId) {
  if (typeof roleId !== 'string' || !mongoose.isValidObjectId(roleId)) {
    return null;
  }
  return Role.findById(roleId).lean();
}

/**
 * Load the target user for an edit, applying the rules every edit shares:
 * Owner accounts can only be changed by an Owner. Sends the error response
 * itself and returns null when the edit isn't allowed.
 */
async function loadTarget(req, res) {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(404).json({ error: 'not_found' });
    return null;
  }
  const target = await User.findById(id).populate('roleId');
  if (!target) {
    res.status(404).json({ error: 'not_found' });
    return null;
  }
  if (target.roleId?.isOwner && !req.user.role.isOwner) {
    res.status(403).json({
      error: 'owner_protected',
      message: 'Only an Owner can change an Owner’s account.',
    });
    return null;
  }
  return target;
}

router.get('/', async (_req, res) => {
  try {
    const users = await User.find()
      .select(
        'username displayName roleId active lastLoginAt createdAt permissionOverrides',
      )
      .populate('roleId')
      .sort({ username: 1 })
      .lean();
    res.json({ users: users.map(serializeUser) });
  } catch (e) {
    console.error('GET /users failed:', e?.message ?? e);
    res.status(500).json({ error: 'db_error' });
  }
});

router.post('/', async (req, res) => {
  const body = req.body ?? {};
  const username = String(body.username ?? '').trim().toLowerCase();
  if (!/^[a-z0-9_]{2,32}$/.test(username)) {
    return res.status(400).json({
      error: 'invalid_username',
      message:
        'Username must be 2–32 characters: lowercase letters, numbers and underscores.',
    });
  }
  const problem = passwordProblem(body.password);
  if (problem) {
    return res.status(400).json({ error: 'invalid_password', message: problem });
  }
  const role = await findRole(body.roleId);
  if (!role) {
    return res.status(400).json({ error: 'invalid_role', message: 'Pick a role.' });
  }
  if (role.isOwner && !req.user.role.isOwner) {
    return res.status(403).json({
      error: 'owner_protected',
      message: 'Only an Owner can create another Owner.',
    });
  }

  const displayName = String(body.displayName ?? '').trim();
  if (displayName.length > DISPLAY_NAME_MAX_LENGTH) {
    return res.status(400).json({
      error: 'invalid_display_name',
      message: `Name must be at most ${DISPLAY_NAME_MAX_LENGTH} characters.`,
    });
  }

  try {
    const user = await User.create({
      username,
      displayName,
      passwordHash: await User.hashPassword(body.password),
      roleId: role._id,
    });
    await user.populate('roleId');
    res.status(201).json({ user: serializeUser(user) });
  } catch (e) {
    if (e?.code === 11000) {
      return res.status(409).json({
        error: 'duplicate_username',
        message: 'That username is already taken.',
      });
    }
    console.error('POST /users failed:', e?.message ?? e);
    res.status(500).json({ error: 'db_error' });
  }
});

// Change display name, role and/or active state.
router.patch('/:id', async (req, res) => {
  const body = req.body ?? {};
  const target = await loadTarget(req, res);
  if (!target) return;

  if (body.displayName !== undefined) {
    const displayName = String(body.displayName).trim();
    if (displayName.length > DISPLAY_NAME_MAX_LENGTH) {
      return res.status(400).json({
        error: 'invalid_display_name',
        message: `Name must be at most ${DISPLAY_NAME_MAX_LENGTH} characters.`,
      });
    }
    target.displayName = displayName;
  }

  const isSelf = target._id.toString() === req.user.id;
  const wantsRole = body.roleId !== undefined;
  const wantsActive = body.active !== undefined;

  if (isSelf && (wantsRole || wantsActive)) {
    return res.status(403).json({
      error: 'self_edit',
      message: 'You can’t change your own role or deactivate yourself.',
    });
  }

  let nextRole = target.roleId;
  if (wantsRole) {
    nextRole = await findRole(body.roleId);
    if (!nextRole) {
      return res.status(400).json({ error: 'invalid_role', message: 'Pick a role.' });
    }
    if (nextRole.isOwner && !req.user.role.isOwner) {
      return res.status(403).json({
        error: 'owner_protected',
        message: 'Only an Owner can make someone an Owner.',
      });
    }
  }
  const nextActive = wantsActive ? Boolean(body.active) : target.active;

  const losesOwner =
    target.roleId?.isOwner &&
    target.active &&
    (!nextRole?.isOwner || !nextActive);
  if (losesOwner && (await isLastActiveOwner(target._id))) {
    return res.status(409).json({
      error: 'last_owner',
      message: 'There must always be at least one active Owner.',
    });
  }

  try {
    // A new role is a fresh start: personal overrides were made against the
    // old one and would mean something different on top of the new one.
    if (String(nextRole._id) !== String(target.roleId?._id ?? target.roleId)) {
      target.permissionOverrides = { granted: [], revoked: [] };
    }
    target.roleId = nextRole._id;
    if (target.active && !nextActive) target.sessionVersion += 1;
    target.active = nextActive;
    await target.save();
    await target.populate('roleId');
    res.json({ user: serializeUser(target) });
  } catch (e) {
    console.error('PATCH /users failed:', e?.message ?? e);
    res.status(500).json({ error: 'db_error' });
  }
});

/**
 * Replace one person's overrides. Send `{ granted, revoked }`; anything that
 * matches the role anyway is dropped, so the stored lists only ever hold real
 * differences. Rules on top of loadTarget's:
 *  - not on yourself, and not on an Owner (they always hold everything);
 *  - a non-Owner may only change permissions they hold themselves, so no one
 *    hands out more than they have.
 */
router.put('/:id/permissions', async (req, res) => {
  const body = req.body ?? {};
  const clean = (v) =>
    Array.isArray(v) ? [...new Set(v.filter((k) => PERMISSION_KEYS.includes(k)))] : null;
  const granted = clean(body.granted);
  const revoked = clean(body.revoked);
  if (!granted || !revoked) {
    return res.status(400).json({ error: 'invalid_permissions' });
  }

  const target = await loadTarget(req, res);
  if (!target) return;
  if (target._id.toString() === req.user.id) {
    return res.status(403).json({
      error: 'self_edit',
      message: 'You can’t change your own permissions.',
    });
  }
  if (target.roleId?.isOwner) {
    return res.status(409).json({
      error: 'owner_all',
      message: 'Owners always have every permission.',
    });
  }

  const fromRole = permissionsOf(target.roleId);
  const next = {
    granted: granted.filter((k) => !fromRole.includes(k)),
    revoked: revoked.filter((k) => fromRole.includes(k) && !granted.includes(k)),
  };

  if (!req.user.role.isOwner) {
    const before = effectivePermissions(target.roleId, target.permissionOverrides);
    const after = effectivePermissions(target.roleId, next);
    const changed = PERMISSION_KEYS.filter(
      (k) => before.includes(k) !== after.includes(k),
    );
    const beyond = changed.filter((k) => !req.user.permissions.includes(k));
    if (beyond.length > 0) {
      return res.status(403).json({
        error: 'beyond_own_access',
        message: 'You can only change permissions you have yourself.',
      });
    }
  }

  try {
    target.permissionOverrides = next;
    await target.save();
    res.json({ user: serializeUser(target) });
  } catch (e) {
    console.error('PUT /users/:id/permissions failed:', e?.message ?? e);
    res.status(500).json({ error: 'db_error' });
  }
});

// Set a new password. Signs the user out everywhere — except, when it's your
// own, this browser, which gets a fresh cookie.
router.post('/:id/password', async (req, res) => {
  const problem = passwordProblem(req.body?.password);
  if (problem) {
    return res.status(400).json({ error: 'invalid_password', message: problem });
  }
  const target = await loadTarget(req, res);
  if (!target) return;

  try {
    target.passwordHash = await User.hashPassword(req.body.password);
    target.sessionVersion += 1;
    await target.save();
    if (target._id.toString() === req.user.id) {
      setSessionCookie(res, await createSessionToken(target));
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('POST /users/:id/password failed:', e?.message ?? e);
    res.status(500).json({ error: 'db_error' });
  }
});

export default router;
