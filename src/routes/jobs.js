import { Router } from 'express';
import mongoose from 'mongoose';
import { Job } from '../models/Job.js';
import { Application } from '../models/Application.js';
import { requireAnyPermission, requirePermission } from '../middleware/auth.js';
import { slugify } from '../lib/blog.js';
import {
  applyJobFields,
  jobSlugProblem,
  publishProblems,
  revalidateJob,
  serializeAdminJob,
  serializeJobSummary,
} from '../lib/careers.js';

/**
 * Job postings for the careers page. Reviewers of applications can read the
 * list too (they filter applications by role); changing anything needs
 * careers.manage.
 */
const router = Router();

router.use(requireAnyPermission('careers.manage', 'careers.applications'));

async function loadJob(req, res) {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(404).json({ error: 'not_found' });
    return null;
  }
  const job = await Job.findById(id);
  if (!job) res.status(404).json({ error: 'not_found' });
  return job;
}

async function uniqueSlug(base, exceptId) {
  const root = base || 'untitled-role';
  let slug = root;
  for (let n = 2; await Job.exists({ slug, _id: { $ne: exceptId } }); n += 1) {
    slug = `${root}-${n}`;
  }
  return slug;
}

/** { [jobId]: { total, new } } for every role with applications. */
async function applicationCounts() {
  const rows = await Application.aggregate([
    { $match: { jobId: { $ne: null } } },
    {
      $group: {
        _id: '$jobId',
        total: { $sum: 1 },
        new: { $sum: { $cond: [{ $eq: ['$status', 'new'] }, 1, 0] } },
      },
    },
  ]);
  return new Map(rows.map((r) => [String(r._id), { total: r.total, new: r.new }]));
}

router.get('/', async (_req, res) => {
  try {
    const [jobs, counts] = await Promise.all([
      Job.find().sort({ updatedAt: -1 }).lean(),
      applicationCounts(),
    ]);
    res.json({ jobs: jobs.map((j) => serializeJobSummary(j, counts.get(String(j._id)))) });
  } catch (e) {
    console.error('GET /jobs failed:', e?.message ?? e);
    res.status(500).json({ error: 'db_error' });
  }
});

router.get('/:id', async (req, res) => {
  const job = await loadJob(req, res);
  if (!job) return;
  res.json({ job: serializeAdminJob(job) });
});

/** Create a draft. The URL comes from `slug` or the title, made unique. */
router.post('/', requirePermission('careers.manage'), async (req, res) => {
  const { slug: rawSlug, status: _status, ...fields } = req.body ?? {};
  const job = new Job({
    title: 'Untitled role',
    createdBy: req.user.username,
    updatedBy: req.user.username,
  });
  const problem = applyJobFields(job, fields);
  if (problem) return res.status(problem.status).json({ error: problem.error, message: problem.message });
  try {
    const base = [slugify(rawSlug), slugify(job.title)].find((s) => !jobSlugProblem(s));
    job.slug = await uniqueSlug(base);
    await job.save();
    res.status(201).json({ job: serializeAdminJob(job) });
  } catch (e) {
    console.error('POST /jobs failed:', e?.message ?? e);
    res.status(500).json({ error: 'db_error' });
  }
});

/** Save posting fields; any subset may be sent. */
router.patch('/:id', requirePermission('careers.manage'), async (req, res) => {
  const job = await loadJob(req, res);
  if (!job) return;
  const body = req.body ?? {};

  const problem = applyJobFields(job, body);
  if (problem) return res.status(problem.status).json({ error: problem.error, message: problem.message });

  if (body.slug !== undefined) {
    const slug = String(body.slug).trim().toLowerCase();
    if (slug !== job.slug) {
      // A published role's URL may already be shared or indexed.
      if (job.publishedAt) {
        return res.status(409).json({
          error: 'slug_locked',
          message: 'The URL is fixed once a role has been published.',
        });
      }
      const slugProblem = jobSlugProblem(slug);
      if (slugProblem) return res.status(400).json({ error: 'invalid', message: slugProblem });
      if (await Job.exists({ slug, _id: { $ne: job._id } })) {
        return res.status(409).json({ error: 'slug_taken', message: 'Another role already uses that URL.' });
      }
      job.slug = slug;
    }
  }

  job.updatedBy = req.user.username;
  try {
    await job.save();
  } catch (e) {
    if (e?.code === 11000) {
      return res.status(409).json({ error: 'slug_taken', message: 'Another role already uses that URL.' });
    }
    console.error('PATCH /jobs failed:', e?.message ?? e);
    return res.status(500).json({ error: 'db_error' });
  }
  if (job.status !== 'draft') revalidateJob(job.slug);
  res.json({ job: serializeAdminJob(job) });
});

/**
 * Put a role on the careers page and open it to applications. Opening a
 * draft or a closed role dates it from now, so the listing's "posted" date
 * means what applicants think it means.
 */
router.post('/:id/publish', requirePermission('careers.manage'), async (req, res) => {
  const job = await loadJob(req, res);
  if (!job) return;
  const problems = publishProblems(job);
  if (problems.length > 0) {
    return res.status(400).json({
      error: 'not_ready',
      message: `Not ready to publish: ${problems.join(' ')}`,
      problems,
    });
  }
  if (job.status !== 'published') {
    job.status = 'published';
    job.publishedAt = new Date();
    job.closedAt = null;
  }
  job.updatedBy = req.user.username;
  await job.save();
  revalidateJob(job.slug);
  res.json({ job: serializeAdminJob(job) });
});

/** Stop taking applications. The page stays up and says the role is filled. */
router.post('/:id/close', requirePermission('careers.manage'), async (req, res) => {
  const job = await loadJob(req, res);
  if (!job) return;
  if (job.status !== 'published') {
    return res.status(400).json({ error: 'not_published', message: 'Only a published role can be closed.' });
  }
  job.status = 'closed';
  job.closedAt = new Date();
  job.updatedBy = req.user.username;
  await job.save();
  revalidateJob(job.slug);
  res.json({ job: serializeAdminJob(job) });
});

/** Take a role off the site entirely, back to a draft. */
router.post('/:id/unpublish', requirePermission('careers.manage'), async (req, res) => {
  const job = await loadJob(req, res);
  if (!job) return;
  const wasLive = job.status !== 'draft';
  job.status = 'draft';
  job.closedAt = null;
  job.updatedBy = req.user.username;
  await job.save();
  if (wasLive) revalidateJob(job.slug);
  res.json({ job: serializeAdminJob(job) });
});

/**
 * Delete a role for good. Its applications are kept — they carry the role's
 * title — so removing a posting never loses what candidates sent.
 */
router.delete('/:id', requirePermission('careers.manage'), async (req, res) => {
  const job = await loadJob(req, res);
  if (!job) return;
  const wasLive = job.status !== 'draft';
  await job.deleteOne();
  if (wasLive) revalidateJob(job.slug);
  res.json({ ok: true });
});

export default router;
