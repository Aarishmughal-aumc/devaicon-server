import { Router } from 'express';
import mongoose from 'mongoose';
import { Role, permissionsOf } from '../models/Role.js';
import { User } from '../models/User.js';
import {
  requirePermission,
  requireAnyPermission,
} from '../middleware/auth.js';
import { PERMISSIONS, cleanPermissions } from '../permissions.js';

const router = Router();

function serializeRole(r, userCount) {
  return {
    id: r._id.toString(),
    name: r.name,
    description: r.description ?? '',
    permissions: permissionsOf(r),
    isOwner: Boolean(r.isOwner),
    userCount,
  };
}

function nameProblem(name) {
  if (!name) return 'Name is required.';
  if (name.length > 50) return 'Name must be at most 50 characters.';
  return null;
}

/**
 * Load a role for editing. The Owner role is locked for everyone, and a
 * non-Owner can't edit the role they hold — otherwise roles.manage could
 * grant itself every other permission. Sends the error itself and returns
 * null when the edit isn't allowed.
 */
async function loadEditable(req, res) {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(404).json({ error: 'not_found' });
    return null;
  }
  const role = await Role.findById(id);
  if (!role) {
    res.status(404).json({ error: 'not_found' });
    return null;
  }
  if (role.isOwner) {
    res.status(403).json({
      error: 'owner_locked',
      message: 'The Owner role always has every permission and can’t be changed.',
    });
    return null;
  }
  if (role._id.toString() === req.user.role.id && !req.user.role.isOwner) {
    res.status(403).json({
      error: 'own_role',
      message: 'You can’t change the role you hold. Ask an Owner.',
    });
    return null;
  }
  return role;
}

// The Team page needs the list to assign roles, so users.manage may read it.
router.get(
  '/',
  requireAnyPermission('users.manage', 'roles.manage'),
  async (_req, res) => {
    try {
      const [roles, counts] = await Promise.all([
        Role.find().lean(),
        User.aggregate([{ $group: { _id: '$roleId', n: { $sum: 1 } } }]),
      ]);
      const countOf = new Map(counts.map((c) => [String(c._id), c.n]));
      // Owner first, then alphabetical.
      roles.sort((a, b) =>
        a.isOwner !== b.isOwner
          ? a.isOwner
            ? -1
            : 1
          : a.name.localeCompare(b.name),
      );
      res.json({
        roles: roles.map((r) => serializeRole(r, countOf.get(String(r._id)) ?? 0)),
        permissions: PERMISSIONS,
      });
    } catch (e) {
      console.error('GET /roles failed:', e?.message ?? e);
      res.status(500).json({ error: 'db_error' });
    }
  },
);

router.post('/', requirePermission('roles.manage'), async (req, res) => {
  const body = req.body ?? {};
  const name = String(body.name ?? '').trim();
  const problem = nameProblem(name);
  if (problem) return res.status(400).json({ error: 'invalid_name', message: problem });
  const permissions = cleanPermissions(body.permissions ?? []);
  if (permissions === null) {
    return res.status(400).json({ error: 'invalid_permissions' });
  }

  try {
    const role = await Role.create({
      name,
      description: String(body.description ?? '').trim().slice(0, 200),
      permissions,
    });
    res.status(201).json({ role: serializeRole(role, 0) });
  } catch (e) {
    if (e?.code === 11000) {
      return res.status(409).json({
        error: 'duplicate_role',
        message: 'A role with that name already exists.',
      });
    }
    console.error('POST /roles failed:', e?.message ?? e);
    res.status(500).json({ error: 'db_error' });
  }
});

router.patch('/:id', requirePermission('roles.manage'), async (req, res) => {
  const body = req.body ?? {};
  const role = await loadEditable(req, res);
  if (!role) return;

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    const problem = nameProblem(name);
    if (problem) return res.status(400).json({ error: 'invalid_name', message: problem });
    role.name = name;
  }
  if (body.description !== undefined) {
    role.description = String(body.description).trim().slice(0, 200);
  }
  if (body.permissions !== undefined) {
    const permissions = cleanPermissions(body.permissions);
    if (permissions === null) {
      return res.status(400).json({ error: 'invalid_permissions' });
    }
    role.permissions = permissions;
  }

  try {
    await role.save();
    const userCount = await User.countDocuments({ roleId: role._id });
    res.json({ role: serializeRole(role, userCount) });
  } catch (e) {
    if (e?.code === 11000) {
      return res.status(409).json({
        error: 'duplicate_role',
        message: 'A role with that name already exists.',
      });
    }
    console.error('PATCH /roles failed:', e?.message ?? e);
    res.status(500).json({ error: 'db_error' });
  }
});

router.delete('/:id', requirePermission('roles.manage'), async (req, res) => {
  const role = await loadEditable(req, res);
  if (!role) return;

  try {
    const userCount = await User.countDocuments({ roleId: role._id });
    if (userCount > 0) {
      return res.status(409).json({
        error: 'role_in_use',
        message: `Move the ${userCount} user(s) with this role to another role first.`,
      });
    }
    await role.deleteOne();
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /roles failed:', e?.message ?? e);
    res.status(500).json({ error: 'db_error' });
  }
});

export default router;
