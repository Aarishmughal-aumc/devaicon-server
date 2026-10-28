import { Router } from 'express';
import mongoose from 'mongoose';
import { Application, APPLICATION_STATUSES } from '../models/Application.js';
import { requirePermission } from '../middleware/auth.js';
import { serializeApplication, serializeApplicationSummary } from '../lib/careers.js';
import { str } from '../lib/fields.js';

/**
 * Applications sent from the careers page. Everything here is personal data,
 * so every route needs careers.applications — managing postings alone does
 * not open it.
 */
const router = Router();

router.use(requirePermission('careers.applications'));

async function loadApplication(req, res, select) {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(404).json({ error: 'not_found' });
    return null;
  }
  const query = Application.findById(id);
  if (select) query.select(select);
  const app = await query;
  if (!app) res.status(404).json({ error: 'not_found' });
  return app;
}

/**
 * Filters, all optional: `jobId` (a role's id, or "general" for résumés sent
 * without one), `status`, and `q` matching name or email. `counts` are per
 * status within the role filter, so the tabs can show them.
 */
router.get('/', async (req, res) => {
  const scope = {};
  const jobId = String(req.query.jobId ?? '');
  if (jobId === 'general') scope.jobId = null;
  else if (mongoose.isValidObjectId(jobId)) scope.jobId = new mongoose.Types.ObjectId(jobId);

  const filter = { ...scope };
  const status = String(req.query.status ?? '');
  if (APPLICATION_STATUSES.includes(status)) filter.status = status;
  const q = String(req.query.q ?? '').trim().slice(0, 100);
  if (q) {
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ firstName: re }, { lastName: re }, { email: re }];
  }

  try {
    const [apps, grouped] = await Promise.all([
      Application.find(filter).sort({ createdAt: -1 }).limit(500).lean(),
      Application.aggregate([{ $match: scope }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    ]);
    const counts = Object.fromEntries(APPLICATION_STATUSES.map((s) => [s, 0]));
    for (const g of grouped) counts[g._id] = g.n;
    res.json({ applications: apps.map(serializeApplicationSummary), counts });
  } catch (e) {
    console.error('GET /applications failed:', e?.message ?? e);
    res.status(500).json({ error: 'db_error' });
  }
});

router.get('/:id', async (req, res) => {
  const app = await loadApplication(req, res);
  if (!app) return;
  res.json({ application: serializeApplication(app) });
});

/**
 * The résumé, always as a download: it's a file someone outside sent, so it
 * is never rendered inside the site's own origin.
 */
router.get('/:id/resume', async (req, res) => {
  const app = await loadApplication(req, res, '+resumeData resumeName resumeMime');
  if (!app) return;
  res.set({
    'Content-Type': app.resumeMime,
    'Content-Disposition': `attachment; filename="${app.resumeName.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(app.resumeName)}`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  });
  res.send(app.resumeData);
});

/** Move an application along, and keep notes on it. */
router.patch('/:id', async (req, res) => {
  const app = await loadApplication(req, res);
  if (!app) return;
  const body = req.body ?? {};
  if (body.status !== undefined) {
    if (!APPLICATION_STATUSES.includes(body.status)) {
      return res.status(400).json({ error: 'invalid', message: 'That status is not one of the choices.' });
    }
    if (body.status !== app.status) {
      app.status = body.status;
      app.statusUpdatedBy = req.user.username;
      app.statusUpdatedAt = new Date();
    }
  }
  if (body.notes !== undefined) app.notes = str(body.notes, 5000);
  try {
    await app.save();
    res.json({ application: serializeApplication(app) });
  } catch (e) {
    console.error('PATCH /applications failed:', e?.message ?? e);
    res.status(500).json({ error: 'db_error' });
  }
});

router.delete('/:id', async (req, res) => {
  const app = await loadApplication(req, res);
  if (!app) return;
  await app.deleteOne();
  res.json({ ok: true });
});

export default router;
