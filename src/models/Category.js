import mongoose from 'mongoose';

const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String, default: '', trim: true, maxlength: 300 },
  },
  { timestamps: true, versionKey: false },
);

export const Category = mongoose.model('Category', categorySchema);
