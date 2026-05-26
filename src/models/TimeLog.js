import mongoose from 'mongoose';
import { CATEGORIES, HOURS_MAX, DESCRIPTION_MIN_LENGTH } from '../constants.js';

const timeLogSchema = new mongoose.Schema(
  {
    date: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    username: { type: String, required: true, lowercase: true, index: true },
    project: { type: String, required: true },
    category: { type: String, enum: CATEGORIES, required: true },
    hours: { type: Number, required: true, min: 0.01, max: HOURS_MAX },
    description: {
      type: String,
      required: true,
      minlength: DESCRIPTION_MIN_LENGTH,
    },
    loggedAt: { type: Date, default: () => new Date() },
    approvedAt: { type: Date, default: null },
    approvedBy: { type: String, default: '' },
    flagged: { type: Boolean, default: false, index: true },
    flaggedAt: { type: Date, default: null },
    flaggedBy: { type: String, default: '' },
    flagReason: { type: String, default: '' },
  },
  { versionKey: false },
);

timeLogSchema.set('toJSON', {
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    ret.loggedAt = ret.loggedAt instanceof Date ? ret.loggedAt.toISOString() : '';
    ret.approvedAt =
      ret.approvedAt instanceof Date ? ret.approvedAt.toISOString() : '';
    ret.flaggedAt =
      ret.flaggedAt instanceof Date ? ret.flaggedAt.toISOString() : '';
    return ret;
  },
});

export const TimeLog = mongoose.model('TimeLog', timeLogSchema);
