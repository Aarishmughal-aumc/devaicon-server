import fs from 'node:fs';
import mongoose from 'mongoose';
import { Author } from '../models/Author.js';
import { Category } from '../models/Category.js';
import { Cta } from '../models/Cta.js';
import { Post } from '../models/Post.js';
import { inlineCtaIds, readingMinutes, slugify } from './blog.js';

const SEED_FILE = new URL('../seed/insights.json', import.meta.url);
const MARKER = 'insights-seeded';

/**
 * Import the posts that used to be hard-coded in the client
 * (client/src/lib/insights-content), once, on first start. Their URLs,
 * wording, images and CTAs are kept; `src/seed/insights.json` is that content
 * converted to editor documents.
 *
 * Runs only while no posts exist and the import has never happened, so
 * deleting a post later never brings it back.
 */
export async function ensureBlogSeed() {
  const meta = mongoose.connection.db.collection('meta');
  if (await meta.findOne({ _id: MARKER })) return;

  if ((await Post.estimatedDocumentCount()) === 0) {
    const seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));

    const authorIds = new Map();
    for (const a of seed.authors) {
      const doc = await Author.create({
        name: a.name,
        type: a.type,
        jobTitle: a.jobTitle,
        avatarUrl: a.avatarUrl,
      });
      authorIds.set(a.key, doc._id);
    }

    const categoryIds = new Map();
    for (const c of seed.categories) {
      const slug = slugify(c.name);
      const doc =
        (await Category.findOne({ slug })) ??
        (await Category.create({ name: c.name, slug }));
      categoryIds.set(c.name, doc._id);
    }

    const ctaIds = new Map();
    for (const c of seed.ctas) {
      const { key, ...fields } = c;
      const doc = await Cta.create(fields);
      ctaIds.set(key, doc._id);
    }

    for (const p of seed.posts) {
      const publishedAt = new Date(p.publishedAt);
      // Saved without automatic timestamps: an imported post hasn't changed
      // since it was published, and dateModified / the sitemap's lastmod
      // must not claim otherwise.
      await new Post({
        title: p.title,
        subtitle: p.subtitle,
        slug: p.slug,
        tags: p.tags,
        categoryId: categoryIds.get(p.category) ?? null,
        authorId: authorIds.get(p.authorKey) ?? null,
        heroImage: p.heroImage,
        body: p.body,
        closingCtaId: p.closingCtaKey ? ctaIds.get(p.closingCtaKey) : null,
        inlineCtaIds: inlineCtaIds(p.body),
        readingMinutes: readingMinutes(p.body),
        status: 'published',
        publishedAt,
        createdAt: publishedAt,
        updatedAt: publishedAt,
        createdBy: 'import',
        updatedBy: 'import',
      }).save({ timestamps: false });
    }
    console.log(`[blog] imported ${seed.posts.length} existing insight posts`);
  }

  await meta.insertOne({ _id: MARKER, at: new Date() });
}
