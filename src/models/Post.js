import mongoose from 'mongoose';

const { ObjectId, Mixed } = mongoose.Schema.Types;

const faqSchema = new mongoose.Schema(
  {
    question: { type: String, required: true, trim: true, maxlength: 300 },
    answer: { type: String, required: true, trim: true, maxlength: 2000 },
  },
  { _id: false },
);

const postSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    subtitle: { type: String, default: '', trim: true, maxlength: 600 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // Old URLs of this post. /insights/<old> redirects here permanently.
    previousSlugs: { type: [String], default: [], index: true },

    categoryId: { type: ObjectId, ref: 'Category', default: null },
    tags: { type: [{ type: String, trim: true, maxlength: 40 }], default: [] },
    authorId: { type: ObjectId, ref: 'Author', default: null },
    heroImage: {
      _id: false,
      type: { url: { type: String, default: '' }, alt: { type: String, default: '' } },
      default: () => ({ url: '', alt: '' }),
    },

    // The editor's document (Tiptap JSON). Stored as-is; the site renders it
    // through a whitelist, so nothing in here is ever trusted as HTML.
    body: { type: Mixed, default: () => ({ type: 'doc', content: [{ type: 'paragraph' }] }) },
    faqs: { type: [faqSchema], default: [] },
    closingCtaId: { type: ObjectId, ref: 'Cta', default: null },
    // Every CTA the body places inline, kept in step on save so a CTA in use
    // can be found without searching every document.
    inlineCtaIds: { type: [ObjectId], default: [] },

    toc: {
      _id: false,
      type: {
        enabled: { type: Boolean, default: true },
        // 2: H2s only; 3: H2s and H3s.
        depth: { type: Number, enum: [2, 3], default: 3 },
        title: { type: String, default: 'On this page', trim: true, maxlength: 60 },
        // Replacement wording for entries, keyed by the heading's anchor id.
        labels: {
          type: [{ _id: false, id: String, text: { type: String, maxlength: 120 } }],
          default: [],
        },
      },
      default: () => ({}),
    },

    seo: {
      _id: false,
      type: {
        metaTitle: { type: String, default: '', trim: true, maxlength: 120 },
        metaDescription: { type: String, default: '', trim: true, maxlength: 320 },
        focusKeyphrase: { type: String, default: '', trim: true, maxlength: 100 },
        canonicalUrl: { type: String, default: '', trim: true, maxlength: 500 },
        ogTitle: { type: String, default: '', trim: true, maxlength: 120 },
        ogDescription: { type: String, default: '', trim: true, maxlength: 320 },
        ogImage: { type: String, default: '', trim: true, maxlength: 500 },
        noindex: { type: Boolean, default: false },
      },
      default: () => ({}),
    },

    featured: { type: Boolean, default: false },
    // A scheduled post is live once publishedAt has passed, whether or not
    // the scheduler has flipped it to 'published' yet.
    status: {
      type: String,
      enum: ['draft', 'scheduled', 'published'],
      default: 'draft',
      index: true,
    },
    publishedAt: { type: Date, default: null },
    readingMinutes: { type: Number, default: 1 },

    createdBy: { type: String, default: '' },
    updatedBy: { type: String, default: '' },
  },
  { timestamps: true, versionKey: false },
);

postSchema.index({ status: 1, publishedAt: -1 });

/** Mongo filter for posts the public may see right now. */
export function liveFilter(now = new Date()) {
  return {
    $or: [
      { status: 'published' },
      { status: 'scheduled', publishedAt: { $lte: now } },
    ],
  };
}

export const Post = mongoose.model('Post', postSchema);
