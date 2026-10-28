import { Router } from 'express';
import { Post, liveFilter } from '../models/Post.js';
import { Category } from '../models/Category.js';
import { Cta } from '../models/Cta.js';
import { Job } from '../models/Job.js';
import { Application, AREAS_OF_INTEREST } from '../models/Application.js';
import {
  serializeCategory,
  serializePublicPost,
  serializeSummary,
} from '../lib/postView.js';
import { readApplicant, readResume, serializePublicJob } from '../lib/careers.js';
import { str } from '../lib/fields.js';
import { checkRateLimit, getClientIp, recordFailure } from '../middleware/rateLimit.js';

/**
 * Content for the public site. No session needed; only live posts and roles
 * are ever returned. The Next.js site calls the reads from the server and
 * caches the result, so they are not on the hot path of a page view.
 *
 * The one write is an application from the careers page, which the browser
 * sends straight here.
 */
const router = Router();

// Applications per address in the rate limiter's window (15 minutes).
const APPLICATIONS_PER_WINDOW = 5;

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

// Open roles, newest first.
router.get('/jobs', async (_req, res) => {
  try {
    const jobs = await Job.find({ status: 'published' }).sort({ publishedAt: -1 }).lean();
    res.json({ jobs: jobs.map((j) => serializePublicJob(j)) });
  } catch (e) {
    console.error('GET /public/jobs failed:', e?.message ?? e);
    res.status(500).json({ error: 'db_error' });
  }
});

// One role. A closed one is still returned, so its page can say it's filled.
router.get('/jobs/:slug', async (req, res) => {
  const slug = String(req.params.slug).toLowerCase();
  try {
    const job = await Job.findOne({ slug, status: { $in: ['published', 'closed'] } }).lean();
    if (!job) return res.status(404).json({ error: 'not_found' });
    res.json({ job: serializePublicJob(job, { full: true }) });
  } catch (e) {
    console.error('GET /public/jobs/:slug failed:', e?.message ?? e);
    res.status(500).json({ error: 'db_error' });
  }
});

/**
 * An application: for a role when `jobSlug` is sent, otherwise a general
 * résumé with an `areaOfInterest`. The résumé comes as `{ name, data }`, data
 * in base64. `website` is a field people never see; anything in it means a
 * bot filled the form, which is thanked and dropped.
 */
router.post('/applications', async (req, res) => {
  const body = req.body ?? {};
  const ip = getClientIp(req);
  const rate = checkRateLimit(`apply:${ip}`, APPLICATIONS_PER_WINDOW);
  if (!rate.allowed) {
    res.set('Retry-After', String(rate.retryAfterSeconds));
    return res.status(429).json({
      error: 'rate_limited',
      message: 'You have sent several applications in a short time. Please try again in a few minutes.',
    });
  }
  recordFailure(`apply:${ip}`);

  if (str(body.website, 200)) return res.status(201).json({ ok: true });

  try {
    const jobSlug = str(body.jobSlug, 100).toLowerCase();
    let job = null;
    let areaOfInterest = '';
    if (jobSlug) {
      job = await Job.findOne({ slug: jobSlug }).select('title status').lean();
      if (!job || job.status !== 'published') {
        return res.status(410).json({
          error: 'job_closed',
          message: 'This role is no longer taking applications. You can still send us your résumé from the careers page.',
        });
      }
    } else {
      areaOfInterest = str(body.areaOfInterest, 60);
      if (!AREAS_OF_INTEREST.includes(areaOfInterest)) {
        return res.status(400).json({ error: 'invalid', message: 'Choose the kind of role you are interested in.' });
      }
    }

    const applicant = readApplicant(body, { coverLetterRequired: Boolean(job) });
    if (applicant.problem) return res.status(400).json({ error: 'invalid', message: applicant.problem });
    const resume = readResume(body.resume);
    if (resume.problem) return res.status(400).json({ error: 'invalid', message: resume.problem });

    await Application.create({
      ...applicant.fields,
      jobId: job?._id ?? null,
      jobTitle: job?.title ?? '',
      areaOfInterest,
      resumeName: resume.file.name,
      resumeMime: resume.file.mime,
      resumeSize: resume.file.size,
      resumeData: resume.file.data,
    });
    res.status(201).json({ ok: true });
  } catch (e) {
    console.error('POST /public/applications failed:', e?.message ?? e);
    res.status(500).json({ error: 'db_error', message: 'Your application could not be saved. Please try again.' });
  }
});

export default router;
