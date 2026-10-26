import { Router } from 'express';
import { Post, liveFilter } from '../models/Post.js';
import { Category } from '../models/Category.js';
import { Cta } from '../models/Cta.js';
import {
  serializeCategory,
  serializePublicPost,
  serializeSummary,
} from '../lib/postView.js';

/**
 * Read-only content for the public site. No session needed; only live posts
 * are ever returned. The Next.js site calls these from the server and caches
 * the result, so they are not on the hot path of a page view.
 */
const router = Router();

router.get('/posts', async (req, res) => {
  const filter = liveFilter();
  if (req.query.featured === '1') filter.featured = true;
  const category = String(req.query.category ?? '').trim().toLowerCase();
  try {
    if (category) {
      const c = await Category.findOne({ slug: category }).select('_id').lean();
      if (!c) return res.json({ posts: [] });
      filter.categoryId = c._id;
    }
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 100, 1), 200);
    const posts = await Post.find(filter)
      .select('-body -faqs')
      .populate('authorId', 'name')
      .populate('categoryId', 'name slug')
      .sort({ publishedAt: -1 })
      .limit(limit)
      .lean();
    res.json({ posts: posts.map(serializeSummary) });
  } catch (e) {
    console.error('GET /public/posts failed:', e?.message ?? e);
    res.status(500).json({ error: 'db_error' });
  }
});

router.get('/posts/:slug', async (req, res) => {
  const slug = String(req.params.slug).toLowerCase();
  try {
    const post = await Post.findOne({ ...liveFilter(), slug })
      .populate(['authorId', 'categoryId', 'closingCtaId']);
    if (!post) {
      const moved = await Post.findOne({ ...liveFilter(), previousSlugs: slug })
        .select('slug')
        .lean();
      if (moved) return res.json({ redirect: moved.slug });
      return res.status(404).json({ error: 'not_found' });
    }

    const [ctas, related] = await Promise.all([
      Cta.find({ _id: { $in: post.inlineCtaIds } }).lean(),
      // Same category first, then the newest of the rest.
      Post.find({ ...liveFilter(), _id: { $ne: post._id } })
        .select('-body -faqs')
        .populate('authorId', 'name')
        .populate('categoryId', 'name slug')
        .sort({ publishedAt: -1 })
        .limit(12)
        .lean(),
    ]);
    const sameCategory = (p) =>
      post.categoryId && String(p.categoryId?._id) === String(post.categoryId._id);
    const ordered = [...related.filter(sameCategory), ...related.filter((p) => !sameCategory(p))];

    res.json({
      post: serializePublicPost(post, ctas),
      related: ordered.slice(0, 3).map(serializeSummary),
    });
  } catch (e) {
    console.error('GET /public/posts/:slug failed:', e?.message ?? e);
    res.status(500).json({ error: 'db_error' });
  }
});

// Categories with at least one live post, for the listing's filter.
router.get('/categories', async (_req, res) => {
  try {
    const ids = await Post.distinct('categoryId', liveFilter());
    const categories = await Category.find({ _id: { $in: ids } }).sort({ name: 1 }).lean();
    res.json({ categories: categories.map(serializeCategory) });
  } catch (e) {
    console.error('GET /public/categories failed:', e?.message ?? e);
    res.status(500).json({ error: 'db_error' });
  }
});

export default router;
