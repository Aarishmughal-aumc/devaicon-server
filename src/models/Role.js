import mongoose from 'mongoose';
import { PERMISSION_KEYS } from '../permissions.js';

const roleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 50 },
    nameLower: { type: String, required: true, unique: true, lowercase: true },
    description: { type: String, default: '', trim: true, maxlength: 200 },
    // Ignored for the Owner role, which always holds every permission — see
    // permissionsOf(). Storing nothing there means a permission added later
    // reaches Owners without a migration.
    permissions: {
      type: [{ type: String, enum: PERMISSION_KEYS }],
      default: [],
    },
    // Exactly one role has this set. It can't be renamed, edited or deleted.
    isOwner: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

roleSchema.pre('validate', function (next) {
  if (this.name) this.nameLower = this.name.toLowerCase();
  next();
});

export function permissionsOf(role) {
  if (!role) return [];
  if (role.isOwner) return [...PERMISSION_KEYS];
  return role.permissions.filter((k) => PERMISSION_KEYS.includes(k));
}

/**
 * What one person may actually do: their role's permissions, plus any granted
 * to them personally, minus any taken away. The role is a starting profile —
 * editing it still reaches everyone holding it, except where a person has an
 * override for that particular permission. Owners always hold everything.
 */
export function effectivePermissions(role, overrides) {
  const base = permissionsOf(role);
  if (!role || role.isOwner) return base;
  const granted = overrides?.granted ?? [];
  const revoked = overrides?.revoked ?? [];
  return PERMISSION_KEYS.filter(
    (k) => (base.includes(k) || granted.includes(k)) && !revoked.includes(k),
  );
}

export const Role = mongoose.model('Role', roleSchema);
