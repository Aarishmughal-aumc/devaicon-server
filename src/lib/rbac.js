import { Role, effectivePermissions } from '../models/Role.js';
import { User } from '../models/User.js';
import { DEFAULT_ROLES, OWNER_ROLE_NAME } from '../permissions.js';

/**
 * Run on every start; safe to repeat.
 *
 * 1. Creates the Owner role, and the default roles, if they don't exist yet.
 *    Defaults are created once and then left alone, since admins may edit them.
 * 2. Moves users from the old `role: 'dev' | 'admin'` field to a role:
 *    admins become Owners (they already had full control) and devs become
 *    Developers. It goes through the raw collection because `role` is no
 *    longer part of the schema.
 */
export async function ensureRbac() {
  let owner = await Role.findOne({ isOwner: true });
  if (!owner) {
    owner = await Role.create({
      name: OWNER_ROLE_NAME,
      description: 'Full access. Cannot be edited or deleted.',
      isOwner: true,
    });
    console.log('[rbac] created Owner role');

    for (const def of DEFAULT_ROLES) {
      const exists = await Role.findOne({ nameLower: def.name.toLowerCase() });
      if (!exists) {
        await Role.create(def);
        console.log(`[rbac] created ${def.name} role`);
      }
    }
  }

  const unmigrated = await User.collection
    .find({ roleId: { $exists: false } })
    .toArray();
  if (unmigrated.length === 0) return;

  const developer =
    (await Role.findOne({ nameLower: 'developer' })) ??
    (await Role.create(DEFAULT_ROLES.find((r) => r.name === 'Developer')));

  for (const u of unmigrated) {
    const roleId = u.role === 'admin' ? owner._id : developer._id;
    await User.collection.updateOne(
      { _id: u._id },
      {
        $set: { roleId, active: true, sessionVersion: 0, lastLoginAt: null },
        $unset: { role: '' },
      },
    );
  }
  console.log(`[rbac] migrated ${unmigrated.length} user(s) to roles`);
}

/**
 * The signed-in user as the API describes them — `req.user`, and the body of
 * /auth/me and /auth/login. `user` must have `roleId` populated.
 */
export function toSessionUser(user) {
  return {
    id: user._id.toString(),
    username: user.username,
    displayName: user.displayName ?? '',
    role: {
      id: user.roleId._id.toString(),
      name: user.roleId.name,
      isOwner: Boolean(user.roleId.isOwner),
    },
    permissions: effectivePermissions(user.roleId, user.permissionOverrides),
  };
}

/**
 * True when removing `excludeUserId` from the active Owners would leave none.
 * Used before demoting or deactivating anyone.
 */
export async function isLastActiveOwner(excludeUserId) {
  const owner = await Role.findOne({ isOwner: true }).select('_id').lean();
  if (!owner) return false;
  const others = await User.countDocuments({
    roleId: owner._id,
    active: true,
    _id: { $ne: excludeUserId },
  });
  return others === 0;
}
