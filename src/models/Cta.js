import mongoose from 'mongoose';

// A reusable call to action. Posts point at it rather than copying it, so
// fixing a link or an offer here updates every post that uses it.
const ctaSchema = new mongoose.Schema(
  {
    // What editors see when picking one; never shown on the site.
    name: { type: String, required: true, trim: true, maxlength: 80 },
    heading: { type: String, required: true, trim: true, maxlength: 140 },
    body: { type: String, default: '', trim: true, maxlength: 400 },
    buttonLabel: { type: String, required: true, trim: true, maxlength: 40 },
    buttonUrl: { type: String, required: true, trim: true, maxlength: 500 },
    // panel: a tinted box; banner: a full-width dark strip; inline: a
    // single line with a button, for mid-article use.
    style: { type: String, enum: ['panel', 'banner', 'inline'], default: 'panel' },
  },
  { timestamps: true, versionKey: false },
);

export const Cta = mongoose.model('Cta', ctaSchema);
