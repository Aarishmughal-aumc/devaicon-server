import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

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
    role: { type: String, enum: ['dev', 'admin'], required: true },
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

userSchema.methods.toSessionUser = function () {
  return { username: this.username, role: this.role };
};

export const User = mongoose.model('User', userSchema);
