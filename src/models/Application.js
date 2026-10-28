import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

export const APPLICATION_STATUSES = ['new', 'reviewing', 'shortlisted', 'rejected', 'hired'];

// Choices for a résumé sent without a particular role in mind.
export const AREAS_OF_INTEREST = [
  'Engineering',
  'Data & AI',
  'Cloud & Infrastructure',
  'Product',
  'Design',
  'Business Development',
  'Marketing',
  'Other',
];

/**
 * One form sent from the careers page: for a role (`jobId` set) or a general
 * résumé (`jobId` null). The role's title is copied in, so an application
 * still reads sensibly after its role is renamed or deleted.
 *
 * The résumé itself is stored here rather than in public file storage: it is
 * personal data, and the only way to it is through the API, which checks
 * careers.applications.
 */
const applicationSchema = new mongoose.Schema(
  {
    jobId: { type: ObjectId, ref: 'Job', default: null, index: true },
    jobTitle: { type: String, default: '' },
    areaOfInterest: { type: String, default: '' },

    firstName: { type: String, required: true, trim: true, maxlength: 80 },
    lastName: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 200 },
    phone: { type: String, required: true, trim: true, maxlength: 40 },
    linkedIn: { type: String, default: '', trim: true, maxlength: 300 },
    portfolio: { type: String, default: '', trim: true, maxlength: 300 },
    coverLetter: { type: String, default: '', trim: true, maxlength: 5000 },

    resumeName: { type: String, required: true },
    resumeMime: { type: String, required: true },
    resumeSize: { type: Number, required: true },
    // Left out of every query unless asked for, so lists stay light.
    resumeData: { type: Buffer, required: true, select: false },

    status: { type: String, enum: APPLICATION_STATUSES, default: 'new', index: true },
    // Internal; never shown to the applicant.
    notes: { type: String, default: '', trim: true, maxlength: 5000 },
    statusUpdatedBy: { type: String, default: '' },
    statusUpdatedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

applicationSchema.index({ createdAt: -1 });

export const Application = mongoose.model('Application', applicationSchema);
