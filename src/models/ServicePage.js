import mongoose from 'mongoose';

export const SERVICE_PAGE_STATUSES = ['draft', 'published'];

/**
 * A service page built in the dashboard from content blocks, served at
 * /services/<slug>. Blocks are checked against the catalogue in
 * lib/servicePages.js before they reach here, so the schema stores them as
 * they come.
 */
const servicePageSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    // Fixed once the page has been published, since it's the page's URL.
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },

    // The hero.
    label: { type: String, default: '', trim: true, maxlength: 60 },
    icon: { type: String, default: 'sparkles' },
    subtitle: { type: String, default: '', trim: true, maxlength: 400 },
    heroImage: { type: String, default: '', trim: true },
    heroButtonText: { type: String, default: '', trim: true, maxlength: 40 },
    heroButtonLink: { type: String, default: '', trim: true },
    // The breadcrumb between Home and this page; '' for none.
    parent: { type: String, default: '/whatwedo' },

    blocks: { type: [mongoose.Schema.Types.Mixed], default: [] },

    seo: {
      _id: false,
      type: {
        metaTitle: { type: String, default: '', trim: true, maxlength: 120 },
        metaDescription: { type: String, default: '', trim: true, maxlength: 320 },
        focusKeyphrase: { type: String, default: '', trim: true, maxlength: 100 },
        keywords: { type: [String], default: [] },
        canonicalUrl: { type: String, default: '', trim: true },
        ogTitle: { type: String, default: '', trim: true, maxlength: 120 },
        ogDescription: { type: String, default: '', trim: true, maxlength: 320 },
        ogImage: { type: String, default: '', trim: true },
        noindex: { type: Boolean, default: false },
      },
      default: () => ({}),
    },
    // Schema.org Service fields.
    serviceType: { type: String, default: '', trim: true, maxlength: 120 },
    areaServed: { type: String, default: '', trim: true, maxlength: 80 },

    status: { type: String, enum: SERVICE_PAGE_STATUSES, default: 'draft', index: true },
    publishedAt: { type: Date, default: null },

    createdBy: { type: String, default: '' },
    updatedBy: { type: String, default: '' },
  },
  { timestamps: true, versionKey: false, minimize: false },
);

export const ServicePage = mongoose.model('ServicePage', servicePageSchema);
