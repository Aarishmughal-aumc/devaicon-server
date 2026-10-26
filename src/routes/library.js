import { Router } from 'express';
import mongoose from 'mongoose';
import { Author } from '../models/Author.js';
import { Category } from '../models/Category.js';
import { Cta } from '../models/Cta.js';
import { Post } from '../models/Post.js';
import { requireAnyPermission, requirePermission } from '../middleware/auth.js';
import { serializeAuthor, serializeCategory, serializeCta } from '../lib/postView.js';
import { revalidate, slugify } from '../lib/blog.js';
import { safeUrl, str } from '../lib/fields.js';

/**
 * The blog library: authors, calls to action and categories. Anyone who works
 * on posts can read them (the editor's pickers need to); changing them needs
 * blog.library. An entry still used by a post can't be deleted.
 */

// Library entries show on live pages, so changing one refreshes the site.
const LIVE_PATHS = ['/', '/insights', '/sitemap.xml'];

function libraryRouter({ Model, serialize, parse, usedBy, sort, label }) {
  const router = Router();
  router.use(requireAnyPermission('posts.write', 'posts.publish', 'blog.library'));

  router.get('/', async (_req, res) => {
    try {
      const docs = await Model.find().sort(sort).lean();
      const withCounts = await Promise.all(
        docs.map(async (d) => ({
          ...serialize(d),
          postCount: await Post.countDocuments(usedBy(d._id)),
        })),
      );
      res.json({ items: withCounts });
    } catch (e) {
      console.error(`GET ${label} failed:`, e?.message ?? e);
      res.status(500).json({ error: 'db_error' });
    }
  });

  const save = async (req, res, doc) => {
    const fields = await parse(req.body ?? {}, doc);
    if (typeof fields === 'string') {
      return res.status(400).json({ error: 'invalid', message: fields });
    }
    try {
      const saved = doc ? Object.assign(doc, fields) : new Model(fields);
      await saved.save();
      if (doc) {
        // Rebuild every live post that shows this entry.
        const posts = await Post.find(usedBy(saved._id)).select('slug').lean();
        revalidate([...LIVE_PATHS, ...posts.map((p) => `/insights/${p.slug}`)]);
      }
      res.status(doc ? 200 : 201).json({ item: serialize(saved) });
    } catch (e) {
      if (e?.code === 11000) {
        return res.status(409).json({ error: 'duplicate', message: `That ${label} already exists.` });
      }
      console.error(`save ${label} failed:`, e?.message ?? e);
      res.status(500).json({ error: 'db_error' });
    }
  };

  async function load(req, res) {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(404).json({ error: 'not_found' });
      return null;
    }
    const doc = await Model.findById(req.params.id);
    if (!doc) res.status(404).json({ error: 'not_found' });
    return doc;
  }

  router.post('/', requirePermission('blog.library'), (req, res) => save(req, res, null));

  router.patch('/:id', requirePermission('blog.library'), async (req, res) => {
    const doc = await load(req, res);
    if (doc) await save(req, res, doc);
  });

  router.delete('/:id', requirePermission('blog.library'), async (req, res) => {
    const doc = await load(req, res);
    if (!doc) return;
    const inUse = await Post.countDocuments(usedBy(doc._id));
    if (inUse > 0) {
      return res.status(409).json({
        error: 'in_use',
        message: `${inUse} post${inUse === 1 ? ' uses' : 's use'} this ${label}. Change ${inUse === 1 ? 'it' : 'them'} first.`,
      });
    }
    await doc.deleteOne();
    res.json({ ok: true });
  });

  return router;
}

export const authorsRouter = libraryRouter({
  Model: Author,
  label: 'author',
  sort: { name: 1 },
  serialize: serializeAuthor,
  usedBy: (id) => ({ authorId: id }),
  parse: (b) => {
    const name = str(b.name, 80);
    if (!name) return 'The name is required.';
    const avatarUrl = safeUrl(b.avatarUrl);
    if (avatarUrl === null) return 'The photo address is not a valid link.';
    const links = [];
    for (const l of Array.isArray(b.links) ? b.links.slice(0, 8) : []) {
      const url = safeUrl(l, 300);
      if (url === null || (url && url.startsWith('/'))) {
        return `“${l}” is not a full profile link (it should start with https://).`;
      }
      if (url) links.push(url);
    }
    return {
      name,
      type: b.type === 'Organization' ? 'Organization' : 'Person',
      jobTitle: str(b.jobTitle, 100),
      bio: str(b.bio, 600),
      avatarUrl,
      links,
    };
  },
});

export const ctasRouter = libraryRouter({
  Model: Cta,
  label: 'call to action',
  sort: { name: 1 },
  serialize: serializeCta,
  usedBy: (id) => ({ $or: [{ closingCtaId: id }, { inlineCtaIds: id }] }),
  parse: (b) => {
    const heading = str(b.heading, 140);
    const buttonLabel = str(b.buttonLabel, 40);
    const buttonUrl = safeUrl(b.buttonUrl);
    if (!heading) return 'The heading is required.';
    if (!buttonLabel) return 'The button label is required.';
    if (!buttonUrl) return 'The button link must be a page on this site (/contact-us) or a full https:// link.';
    return {
      name: str(b.name, 80) || heading,
      heading,
      body: str(b.body, 400),
      buttonLabel,
      buttonUrl,
      style: ['panel', 'banner', 'inline'].includes(b.style) ? b.style : 'panel',
    };
  },
});

export const categoriesRouter = libraryRouter({
  Model: Category,
  label: 'category',
  sort: { name: 1 },
  serialize: serializeCategory,
  usedBy: (id) => ({ categoryId: id }),
  parse: async (b, existing) => {
    const name = str(b.name, 60);
    if (!name) return 'The name is required.';
    const slug = slugify(str(b.slug, 80) || name);
    if (!slug) return 'The name needs at least one letter or number.';
    const clash = await Category.exists({ slug, _id: { $ne: existing?._id } });
    if (clash) return 'A category with that name already exists.';
    return { name, slug, description: str(b.description, 300) };
  },
});
