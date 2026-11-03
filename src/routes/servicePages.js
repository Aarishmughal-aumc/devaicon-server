import { Router } from 'express';
import mongoose from 'mongoose';
import { ServicePage } from '../models/ServicePage.js';
import { requirePermission } from '../middleware/auth.js';
import { slugify } from '../lib/blog.js';
import {
  applyServicePageFields,
  publishProblems,
  revalidateServicePage,
  serializeAdminServicePage,
  serializeServicePageSummary,
  serviceSlugProblem,
} from '../lib/servicePages.js';

/** Service pages built from content blocks. Everything needs services.manage. */
const router = Router();

router.use(requirePermission('services.manage'));

async function loadPage(req, res) {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(404).json({ error: 'not_found' });
    return null;
  }
  const page = await ServicePage.findById(id);
  if (!page) res.status(404).json({ error: 'not_found' });
  return page;
}

async function uniqueSlug(base, exceptId) {
  const root = base || 'untitled-service';
  let slug = root;
  for (let n = 2; await ServicePage.exists({ slug, _id: { $ne: exceptId } }); n += 1) {
    slug = `${root}-${n}`;
  }
  return slug;
}

const send = (res, problem) =>
  res.status(problem.status).json({ error: problem.error, message: problem.message });

// `?full=1` sends whole pages rather than summaries, for exporting.
router.get('/', async (req, res) => {
  const serialize = req.query.full === '1' ? serializeAdminServicePage : serializeServicePageSummary;
  try {
    const pages = await ServicePage.find().sort({ updatedAt: -1 }).lean();
    res.json({ pages: pages.map(serialize) });
  } catch (e) {
    console.error('GET /service-pages failed:', e?.message ?? e);
    res.status(500).json({ error: 'db_error' });
  }
});

// The whole page, drafts included; the preview renders from this too.
router.get('/:id', async (req, res) => {
  const page = await loadPage(req, res);
  if (!page) return;
  res.json({ page: serializeAdminServicePage(page) });
});

/**
 * Create a draft, from a blank form or an imported file. The URL comes from
 * `slug` or the title, made unique rather than refused.
 */
router.post('/', async (req, res) => {
  const { slug: rawSlug, status: _status, ...fields } = req.body ?? {};
  const page = new ServicePage({
    title: 'Untitled service page',
    createdBy: req.user.username,
    updatedBy: req.user.username,
  });
  const problem = applyServicePageFields(page, fields);
  if (problem) return send(res, problem);
  try {
    const base = [slugify(rawSlug), slugify(page.title)].find((s) => !serviceSlugProblem(s));
    page.slug = await uniqueSlug(base);
    await page.save();
    res.status(201).json({ page: serializeAdminServicePage(page) });
  } catch (e) {
    console.error('POST /service-pages failed:', e?.message ?? e);
    res.status(500).json({ error: 'db_error' });
  }
});

/** Save page fields; any subset may be sent. A live page updates at once. */
router.patch('/:id', async (req, res) => {
  const page = await loadPage(req, res);
  if (!page) return;
  const body = req.body ?? {};

  const problem = applyServicePageFields(page, body);
  if (problem) return send(res, problem);

  if (body.slug !== undefined) {
    const slug = String(body.slug).trim().toLowerCase();
    if (slug !== page.slug) {
      // A published page's URL may already be shared, linked or indexed.
      if (page.publishedAt) {
        return res.status(409).json({
          error: 'slug_locked',
          message: 'The URL is fixed once a page has been published.',
        });
      }
      const slugProblem = serviceSlugProblem(slug);
      if (slugProblem) return res.status(400).json({ error: 'invalid', message: slugProblem });
      if (await ServicePage.exists({ slug, _id: { $ne: page._id } })) {
        return res.status(409).json({ error: 'slug_taken', message: 'Another service page already uses that URL.' });
      }
      page.slug = slug;
    }
  }

  page.updatedBy = req.user.username;
  try {
    await page.save();
  } catch (e) {
    if (e?.code === 11000) {
      return res.status(409).json({ error: 'slug_taken', message: 'Another service page already uses that URL.' });
    }
    console.error('PATCH /service-pages failed:', e?.message ?? e);
    return res.status(500).json({ error: 'db_error' });
  }
  if (page.status === 'published') revalidateServicePage(page.slug);
  res.json({ page: serializeAdminServicePage(page) });
});

/** Put a page on the site, once it has everything it needs. */
router.post('/:id/publish', async (req, res) => {
  const page = await loadPage(req, res);
  if (!page) return;
  const problems = publishProblems(page);
  if (problems.length > 0) {
    return res.status(400).json({
      error: 'not_ready',
      message: `Not ready to publish: ${problems.join(' ')}`,
      problems,
    });
  }
  if (page.status !== 'published') {
    page.status = 'published';
    // The first publish dates the page; later ones keep that date.
    page.publishedAt ??= new Date();
  }
  page.updatedBy = req.user.username;
  await page.save();
  revalidateServicePage(page.slug);
  res.json({ page: serializeAdminServicePage(page) });
});

/** Take a page off the site, back to a draft. Its URL stays reserved. */
router.post('/:id/unpublish', async (req, res) => {
  const page = await loadPage(req, res);
  if (!page) return;
  const wasLive = page.status === 'published';
  page.status = 'draft';
  page.updatedBy = req.user.username;
  await page.save();
  if (wasLive) revalidateServicePage(page.slug);
  res.json({ page: serializeAdminServicePage(page) });
});

router.delete('/:id', async (req, res) => {
  const page = await loadPage(req, res);
  if (!page) return;
  const wasLive = page.status === 'published';
  await page.deleteOne();
  if (wasLive) revalidateServicePage(page.slug);
  res.json({ ok: true });
});

export default router;
