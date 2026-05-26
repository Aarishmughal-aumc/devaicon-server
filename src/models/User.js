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
