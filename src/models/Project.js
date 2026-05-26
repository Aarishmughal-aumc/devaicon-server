import mongoose from 'mongoose';

const projectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    nameLower: { type: String, required: true, unique: true, lowercase: true },
    addedBy: { type: String, required: true, lowercase: true },
    addedAt: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);

projectSchema.pre('validate', function (next) {
  if (this.name) this.nameLower = this.name.toLowerCase();
  next();
});

projectSchema.set('toJSON', {
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.nameLower;
    if (ret.addedAt instanceof Date) ret.addedAt = ret.addedAt.toISOString();
    return ret;
  },
});

export const Project = mongoose.model('Project', projectSchema);
