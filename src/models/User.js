import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { PERMISSION_KEYS } from '../permissions.js';

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: /^[a-z0-9_]+$/,
    },
    passwordHash: { type: String, required: true },
    // Shown in place of the username where a person reads it. Optional.
    displayName: { type: String, default: '', trim: true, maxlength: 60 },
    roleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Role', required: true },
    // Deactivated rather than deleted, so their time logs keep an owner.
    active: { type: Boolean, default: true },
    // Part of every session token. Bumping it signs the user out everywhere.
    sessionVersion: { type: Number, default: 0 },
    lastLoginAt: { type: Date, default: null },
    // Per-person changes on top of the role — see effectivePermissions().
    // Cleared when the role changes, since a new role is a fresh start.
    permissionOverrides: {
      _id: false,
      type: {
        granted: { type: [{ type: String, enum: PERMISSION_KEYS }], default: [] },
        revoked: { type: [{ type: String, enum: PERMISSION_KEYS }], default: [] },
      },
      default: () => ({ granted: [], revoked: [] }),
    },
    // Dashboard layout, owned by the client. Absent means "never customised",
    // which is why nothing here carries a default: the client's own defaults
    // must win until the user actually chooses something.
    preferences: {
      overview: {
        _id: false,
        type: {
          pinned: { type: [String], default: undefined },
          extra: { type: [String], default: undefined },
        },
        default: undefined,
      },
    },
  },
  { timestamps: true },
);

userSchema.methods.verifyPassword = function (password) {
  return bcrypt.compare(password, this.passwordHash);
};

userSchema.statics.hashPassword = function (password) {
  return bcrypt.hash(password, 10);
};

export const User = mongoose.model('User', userSchema);
