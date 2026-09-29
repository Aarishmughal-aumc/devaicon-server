import mongoose from 'mongoose';

// A byline. Independent of login accounts: the person credited on a post
// doesn't need to be the one who typed it, or to have an account at all.
const authorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    // Person for a named individual; Organization for a team byline. Decides
    // the schema.org type, so a team is never presented as a person.
    type: { type: String, enum: ['Person', 'Organization'], default: 'Person' },
    jobTitle: { type: String, default: '', trim: true, maxlength: 100 },
    bio: { type: String, default: '', trim: true, maxlength: 600 },
    avatarUrl: { type: String, default: '', trim: true, maxlength: 500 },
    // Profiles that confirm who this is (LinkedIn, personal site). Emitted as
    // schema.org sameAs.
    links: { type: [{ type: String, trim: true, maxlength: 300 }], default: [] },
  },
  { timestamps: true, versionKey: false },
);

export const Author = mongoose.model('Author', authorSchema);
