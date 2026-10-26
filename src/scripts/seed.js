import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import { User } from '../models/User.js';
import { Role } from '../models/Role.js';
import { ensureRbac } from '../lib/rbac.js';

const USER_ENV_PATTERN = /^([A-Za-z0-9_]+)_PASSWORD$/;

function collectUsersFromEnv() {
  const found = [];
  for (const key of Object.keys(process.env)) {
    const m = key.match(USER_ENV_PATTERN);
    if (!m) continue;
    const username = m[1].toLowerCase();
    if (
      username === 'session' ||
      username === 'mongodb' ||
      username === 'client'
    )
      continue;
    const password = process.env[key];
    if (!password) continue;
    // Kept from the Sheets days: an `admin…` name made an admin.
    const role = username.startsWith('admin') ? 'Owner' : 'Developer';
    if (!found.find((u) => u.username === username)) {
      found.push({ username, password, role });
    }
  }
  return found;
}

async function main() {
  await connectDB();
  await ensureRbac();

  const users = collectUsersFromEnv();
  if (users.length === 0) {
    console.log(
      '[seed] No {NAME}_PASSWORD env vars found. Set e.g. DEV1_PASSWORD=... ADMIN1_PASSWORD=... and re-run.',
    );
    await mongoose.disconnect();
    return;
  }

  for (const u of users) {
    const role = await Role.findOne({ nameLower: u.role.toLowerCase() });
    if (!role) {
      console.log(`[seed] no ${u.role} role; skipped ${u.username}`);
      continue;
    }
    const passwordHash = await User.hashPassword(u.password);
    const existing = await User.findOne({ username: u.username });
    if (existing) {
      // A new password signs them out everywhere, as a reset from the panel does.
      existing.passwordHash = passwordHash;
      existing.roleId = role._id;
      existing.sessionVersion += 1;
      await existing.save();
      console.log(`[seed] updated ${u.role}:${u.username}`);
    } else {
      await User.create({
        username: u.username,
        passwordHash,
        roleId: role._id,
      });
      console.log(`[seed] created ${u.role}:${u.username}`);
    }
  }

  await mongoose.disconnect();
  console.log(`[seed] done (${users.length} user(s))`);
}

main().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
