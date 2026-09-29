import { Router } from 'express';
import mongoose from 'mongoose';
import { Post } from '../models/Post.js';
import { Author } from '../models/Author.js';
import { Category } from '../models/Category.js';
import { Cta } from '../models/Cta.js';
import { can, requireAnyPermission, requirePermission } from '../middleware/auth.js';
import {
  docProblem,
  docText,
  inlineCtaIds,
  pathsForPost,
  readingMinutes,
  revalidate,
  slugify,
  slugProblem,
} from '../lib/blog.js';
import {
  serializeAdminPost,
  serializePublicPost,
  serializeSummary,
} from '../lib/postView.js';
import { safeUrl, str } from '../lib/fields.js';

const router = Router();

const MAX_FEATURED = 3;

router.use(requireAnyPermission('posts.write', 'posts.publish', 'posts.delete'));

const isLive = (p) =>
  p.status === 'published' ||
  (p.status === 'scheduled' && p.publishedAt && p.publishedAt <= new Date());

async function loadPost(req, res) {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(404).json({ error: 'not_found' });
    return null;
  }
  const post = await Post.findById(id);
  if (!post) res.status(404).json({ error: 'not_found' });
  return post;
}

async function slugTaken(slug, exceptId) {
  return Boolean(
    await Post.exists({
      _id: { $ne: exceptId },
      $or: [{ slug }, { previousSlugs: slug }],
    }),
  );
}

async function uniqueSlug(base, exceptId) {
  const root = base || 'untitled-post';
  let slug = root;
  for (let n = 2; await slugTaken(slug, exceptId); n += 1) slug = `${root}-${n}`;
  return slug;
}

async function refExists(Model, id) {
  return mongoose.isValidObjectId(id) && Boolean(await Model.exists({ _id: id }));
}

router.get('/', async (req, res) => {
  const filter = {};
  const status = String(req.query.status ?? '');
  if (['draft', 'scheduled', 'published'].includes(status)) filter.status = status;
  const q = String(req.query.q ?? '').trim();
  if (q) {
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ title: re }, { slug: re }, { tags: re }];
  }
  try {
    const posts = await Post.find(filter)
      .select('-body -faqs')
      .populate('authorId', 'name')
      .populate('categoryId', 'name slug')
      .sort({ updatedAt: -1 })
      .lean();
    res.json({ posts: posts.map(serializeSummary) });
  } catch (e) {
    console.error('GET /posts failed:', e?.message ?? e);
    res.status(500).json({ error: 'db_error' });
  }
});

router.get('/:id', async (req, res) => {
  const post = await loadPost(req, res);
  if (!post) return;
  res.json({ post: serializeAdminPost(post) });
});

// The same view a reader gets, for the editor's preview — drafts included.
router.get('/:id/preview', async (req, res) => {
  const post = await loadPost(req, res);
  if (!post) return;
  await post.populate(['authorId', 'categoryId', 'closingCtaId']);
  const ctas = await Cta.find({ _id: { $in: post.inlineCtaIds } }).lean();
  res.json({ post: serializePublicPost(post, ctas) });
});

router.post('/', requirePermission('posts.write'), async (req, res) => {
  const title = str(req.body?.title, 200) || 'Untitled post';
  try {
    const post = await Post.create({
      title,
      slug: await uniqueSlug(slugify(title)),
      createdBy: req.user.username,
      updatedBy: req.user.username,
    });
    res.status(201).json({ post: serializeAdminPost(post) });
  } catch (e) {
    console.error('POST /posts failed:', e?.message ?? e);
    res.status(500).json({ error: 'db_error' });
  }
});

/**
 * Save editor fields. Any subset may be sent. Editing a post that is live or
 * scheduled changes what readers see, so it needs posts.publish as well.
 */
router.patch('/:id', requirePermission('posts.write'), async (req, res) => {
  const body = req.body ?? {};
  const post = await loadPost(req, res);
  if (!post) return;

  if (post.status !== 'draft' && !can(req.user, 'posts.publish')) {
    return res.status(403).json({
      error: 'needs_publish',
      message: 'This post is live or scheduled. Only someone who can publish may edit it.',
    });
  }

  const bad = (message) => res.status(400).json({ error: 'invalid', message });
  const oldSlug = post.slug;

  if (body.title !== undefined) {
    const title = str(body.title, 200);
    if (!title) return bad('The title is required.');
    post.title = title;
  }
  if (body.subtitle !== undefined) post.subtitle = str(body.subtitle, 600);

  if (body.slug !== undefined) {
    const slug = String(body.slug).trim().toLowerCase();
    const problem = slugProblem(slug);
    if (problem) return bad(problem);
    if (slug !== post.slug) {
      if (await slugTaken(slug, post._id)) {
        return res.status(409).json({
          error: 'slug_taken',
          message: 'Another post already uses (or used) that URL.',
        });
      }
      // Once a URL has been public, keep it working as a redirect.
      if (post.publishedAt && !post.previousSlugs.includes(post.slug)) {
        post.previousSlugs.push(post.slug);
      }
      post.previousSlugs = post.previousSlugs.filter((s) => s !== slug);
      post.slug = slug;
    }
  }

  if (body.categoryId !== undefined) {
    if (body.categoryId && !(await refExists(Category, body.categoryId))) {
      return bad('That category no longer exists.');
    }
    post.categoryId = body.categoryId || null;
  }
  if (body.authorId !== undefined) {
    if (body.authorId && !(await refExists(Author, body.authorId))) {
      return bad('That author no longer exists.');
    }
    post.authorId = body.authorId || null;
  }
  if (body.closingCtaId !== undefined) {
    if (body.closingCtaId && !(await refExists(Cta, body.closingCtaId))) {
      return bad('That call to action no longer exists.');
    }
    post.closingCtaId = body.closingCtaId || null;
  }

  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags)) return bad('Tags must be a list.');
    post.tags = [...new Set(body.tags.map((t) => str(t, 40)).filter(Boolean))].slice(0, 20);
  }

  if (body.heroImage !== undefined) {
    const url = safeUrl(body.heroImage?.url);
    if (url === null) return bad('The hero image address is not a valid link.');
    post.heroImage = { url, alt: str(body.heroImage?.alt, 200) };
  }

  if (body.body !== undefined) {
    const problem = docProblem(body.body);
    if (problem) return bad(problem);
    post.body = body.body;
    post.markModified('body');
    post.inlineCtaIds = inlineCtaIds(body.body);
    post.readingMinutes = readingMinutes(body.body);
  }

  if (body.faqs !== undefined) {
    if (!Array.isArray(body.faqs) || body.faqs.length > 30) {
      return bad('FAQs must be a list of at most 30.');
    }
    post.faqs = body.faqs
      .map((f) => ({ question: str(f?.question, 300), answer: str(f?.answer, 2000) }))
      .filter((f) => f.question && f.answer);
  }

  if (body.toc !== undefined) {
    const t = body.toc ?? {};
    post.toc = {
      enabled: t.enabled !== false,
      depth: t.depth === 2 ? 2 : 3,
      title: str(t.title, 60) || 'On this page',
      labels: (Array.isArray(t.labels) ? t.labels : [])
        .map((l) => ({ id: str(l?.id, 120), text: str(l?.text, 120) }))
        .filter((l) => l.id && l.text)
        .slice(0, 100),
    };
  }

  if (body.seo !== undefined) {
    const s = body.seo ?? {};
    const canonicalUrl = safeUrl(s.canonicalUrl);
    const ogImage = safeUrl(s.ogImage);
    if (canonicalUrl === null) return bad('The canonical URL is not a valid link.');
    if (ogImage === null) return bad('The social image address is not a valid link.');
    post.seo = {
      metaTitle: str(s.metaTitle, 120),
      metaDescription: str(s.metaDescription, 320),
      focusKeyphrase: str(s.focusKeyphrase, 100),
      canonicalUrl,
      ogTitle: str(s.ogTitle, 120),
      ogDescription: str(s.ogDescription, 320),
      ogImage,
      noindex: Boolean(s.noindex),
    };
  }

  if (body.featured !== undefined) {
    const featured = Boolean(body.featured);
    if (featured && !post.featured) {
      const others = await Post.countDocuments({ featured: true, _id: { $ne: post._id } });
      if (others >= MAX_FEATURED) {
        return res.status(409).json({
          error: 'too_many_featured',
          message: `Only ${MAX_FEATURED} posts can be featured. Un-feature one first.`,
        });
      }
    }
    post.featured = featured;
  }

  post.updatedBy = req.user.username;
  try {
    await post.save();
  } catch (e) {
    if (e?.code === 11000) {
      return res.status(409).json({ error: 'slug_taken', message: 'Another post already uses that URL.' });
    }
    console.error('PATCH /posts failed:', e?.message ?? e);
    return res.status(500).json({ error: 'db_error' });
  }

  if (isLive(post)) revalidate([...pathsForPost(post.slug), `/insights/${oldSlug}`]);
  res.json({ post: serializeAdminPost(post) });
});

/** What stops a post going live, in words an editor can act on. */
function publishProblems(post) {
  const problems = [];
  if (!post.title?.trim()) problems.push('Add a title.');
  if (slugProblem(post.slug)) problems.push('Fix the URL slug.');
  if (!post.authorId) problems.push('Choose an author.');
  if (!docText(post.body).trim()) problems.push('Write the post body.');
  if (post.heroImage?.url && !post.heroImage?.alt?.trim()) {
    problems.push('Describe the hero image (alt text).');
  }
  return problems;
}

/**
 * Publish now, or schedule with `publishAt` (ISO, in the future). Publishing
 * again keeps the original publish date, so an unpublish-and-fix doesn't
 * make an old post look new.
 */
router.post('/:id/publish', requirePermission('posts.publish'), async (req, res) => {
  const post = await loadPost(req, res);
  if (!post) return;

  const problems = publishProblems(post);
  if (problems.length > 0) {
    return res.status(400).json({
      error: 'not_ready',
      message: `Not ready to publish: ${problems.join(' ')}`,
      problems,
    });
  }

  const now = new Date();
  const at = req.body?.publishAt ? new Date(req.body.publishAt) : null;
  if (at && Number.isNaN(at.getTime())) {
    return res.status(400).json({ error: 'invalid_date', message: 'That publish date is not valid.' });
  }

  if (at && at > now) {
    post.status = 'scheduled';
    post.publishedAt = at;
  } else {
    // Keep a real past publish date (re-publishing after an unpublish, or a
    // second click); a schedule being brought forward starts from now.
    const keepDate =
      post.status !== 'scheduled' && post.publishedAt && post.publishedAt <= now;
    post.status = 'published';
    post.publishedAt = keepDate ? post.publishedAt : now;
  }
  post.updatedBy = req.user.username;
  await post.save();

  if (isLive(post)) revalidate(pathsForPost(post.slug));
  res.json({ post: serializeAdminPost(post) });
});

router.post('/:id/unpublish', requirePermission('posts.publish'), async (req, res) => {
  const post = await loadPost(req, res);
  if (!post) return;
  const wasLive = isLive(post);
  post.status = 'draft';
  // A schedule that never happened isn't a publish date worth keeping.
  if (!wasLive) post.publishedAt = null;
  post.updatedBy = req.user.username;
  await post.save();
  if (wasLive) revalidate(pathsForPost(post.slug));
  res.json({ post: serializeAdminPost(post) });
});

router.delete('/:id', requirePermission('posts.delete'), async (req, res) => {
  const post = await loadPost(req, res);
  if (!post) return;
  const wasLive = isLive(post);
  await post.deleteOne();
  if (wasLive) revalidate(pathsForPost(post.slug));
  res.json({ ok: true });
});

export default router;
