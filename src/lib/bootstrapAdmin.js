import { User } from '../models/User.js';
import { Role } from '../models/Role.js';
import { PASSWORD_MIN_LENGTH } from '../constants.js';

/**
 * Creates the first Owner from BOOTSTRAP_ADMIN=username:password, for a host
 * where `npm run seed` can't be run by hand.
 *
 * Does nothing while any active Owner exists, so leaving the variable set
 * can't reset anyone's password later; remove it once you've signed in all
 * the same. If the username is already taken, that account is promoted to
 * Owner and given this password.
 */
export async function ensureBootstrapAdmin() {
  const raw = process.env.BOOTSTRAP_ADMIN?.trim();
  if (!raw) return;

  const sep = raw.indexOf(':');
  const username = raw.slice(0, sep).trim().toLowerCase();
  const password = raw.slice(sep + 1);
  if (sep < 1 || !/^[a-z0-9_]+$/.test(username)) {
    console.error('[bootstrap] BOOTSTRAP_ADMIN must be username:password (username: a-z, 0-9, _)');
    return;
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    console.error(`[bootstrap] BOOTSTRAP_ADMIN password must be at least ${PASSWORD_MIN_LENGTH} characters`);
    return;
  }

  const owner = await Role.findOne({ isOwner: true });
  if (!owner) return; // ensureRbac() runs first and creates it
  const owners = await User.find({ roleId: owner._id, active: true }, { username: 1 });
  if (owners.length > 0) {
    const names = owners.map((u) => u.username).join(', ');
    console.log(`[bootstrap] skipped: Owner already exists (${names}); remove BOOTSTRAP_ADMIN`);
    return;
  }

  const passwordHash = await User.hashPassword(password);
  const existing = await User.findOne({ username });
  if (existing) {
    existing.passwordHash = passwordHash;
    existing.roleId = owner._id;
    existing.active = true;
    existing.sessionVersion += 1;
    await existing.save();
    console.log(`[bootstrap] promoted ${username} to Owner`);
  } else {
    await User.create({ username, passwordHash, roleId: owner._id });
    console.log(`[bootstrap] created Owner ${username}`);
  }
}
