import mongoose from 'mongoose';

export const WORKPLACES = ['On-site', 'Hybrid', 'Remote'];
export const EMPLOYMENT_TYPES = ['Full-time', 'Part-time', 'Contract', 'Internship'];
export const JOB_STATUSES = ['draft', 'published', 'closed'];

const listOf = (max) => ({
  type: [{ type: String, trim: true, maxlength: max }],
  default: [],
});

/**
 * A role on the careers page. Only `published` roles are listed and take
 * applications; a `closed` role keeps its page, saying it's filled, so links
 * already shared don't break.
 */
const jobSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    // Fixed once the role has been published, since it's the page's URL.
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },

    department: { type: String, default: '', trim: true, maxlength: 60 },
    location: { type: String, default: '', trim: true, maxlength: 80 },
    workplace: { type: String, enum: WORKPLACES, default: 'On-site' },
    employmentType: { type: String, enum: EMPLOYMENT_TYPES, default: 'Full-time' },
    experience: { type: String, default: '', trim: true, maxlength: 60 },

    // One or two sentences for the listing and search results.
    summary: { type: String, default: '', trim: true, maxlength: 300 },
    // Plain text; blank lines separate paragraphs.
    description: { type: String, default: '', trim: true, maxlength: 5000 },
    responsibilities: listOf(300),
    requirements: listOf(300),
    niceToHave: listOf(300),
    benefits: listOf(300),

    status: { type: String, enum: JOB_STATUSES, default: 'draft', index: true },
    publishedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },

    createdBy: { type: String, default: '' },
    updatedBy: { type: String, default: '' },
  },
  { timestamps: true, versionKey: false },
);

jobSchema.index({ status: 1, publishedAt: -1 });

export const Job = mongoose.model('Job', jobSchema);
