import { Router } from 'express';
import mongoose from 'mongoose';
import { TimeLog } from '../models/TimeLog.js';
import { Project } from '../models/Project.js';
import { requireAuth } from '../middleware/auth.js';
import {
  CATEGORIES,
  HOURS_MAX,
  DESCRIPTION_MIN_LENGTH,
  DESCRIPTION_MAX_LENGTH,
  BULK_IDS_MAX,
} from '../constants.js';
import { buildLogFilter, parsePagination } from '../lib/logQuery.js';

const router = Router();

function serializeLog(d) {
  return {
    id: d._id.toString(),
    date: d.date,
    username: d.username,
    project: d.project,
    category: d.category,
    hours: d.hours,
    description: d.description ?? '',
    loggedAt: d.loggedAt ? new Date(d.loggedAt).toISOString() : '',
    approvedAt: d.approvedAt ? new Date(d.approvedAt).toISOString() : '',
    approvedBy: d.approvedBy ?? '',
    flagged: Boolean(d.flagged),
    flaggedAt: d.flaggedAt ? new Date(d.flaggedAt).toISOString() : '',
    flaggedBy: d.flaggedBy ?? '',
    flagReason: d.flagReason ?? '',
  };
}

router.get('/', requireAuth, async (req, res) => {
  const wantAll = req.query.all === '1';
  if (wantAll && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'forbidden' });
  }

  try {
    const filter = buildLogFilter(req.query);
    if (wantAll) {
      // Admins viewing everything can still narrow to a single user.
      const username = String(req.query.username ?? '').trim().toLowerCase();
      if (username) filter.username = username;
    } else {
      // Non-admins are always scoped to their own logs.
      filter.username = req.user.username;
    }

    const { page, pageSize, skip } = parsePagination(req.query);

    const [total, docs] = await Promise.all([
      TimeLog.countDocuments(filter),
      TimeLog.find(filter).sort({ loggedAt: -1 }).skip(skip).limit(pageSize).lean(),
    ]);

    res.json({
      logs: docs.map(serializeLog),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    });
  } catch (e) {
    console.error('GET /logs failed:', e?.message ?? e);
    res.status(500).json({ error: 'db_error', detail: e?.message ?? String(e) });
  }
});

router.post('/', requireAuth, async (req, res) => {
  const body = req.body ?? {};
  const date = String(body.date ?? '').trim();
  const project = String(body.project ?? '').trim();
  const category = String(body.category ?? '').trim();
  const hours = Number(body.hours);
  const description = String(body.description ?? '').trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({
      error: 'invalid_date',
      message: 'Date must be YYYY-MM-DD.',
    });
  }
  if (!project) return res.status(400).json({ error: 'project_required' });
  if (!CATEGORIES.includes(category)) {
    return res.status(400).json({ error: 'invalid_category' });
  }
  if (!Number.isFinite(hours) || hours <= 0 || hours > HOURS_MAX) {
    return res.status(400).json({
      error: 'invalid_hours',
      message: `Hours must be greater than 0 and at most ${HOURS_MAX}.`,
    });
  }
  if (description.length < DESCRIPTION_MIN_LENGTH) {
    return res.status(400).json({
      error: 'description_too_short',
      message: `Description must be at least ${DESCRIPTION_MIN_LENGTH} characters.`,
    });
  }
  if (description.length > DESCRIPTION_MAX_LENGTH) {
    return res.status(400).json({
      error: 'description_too_long',
      message: `Description must be at most ${DESCRIPTION_MAX_LENGTH} characters.`,
    });
  }

  try {
    const exists = await Project.findOne({ name: project }).lean();
    if (!exists) {
      return res.status(400).json({
        error: 'unknown_project',
        message: 'Project not found. Ask admin to add it.',
      });
    }

    const doc = await TimeLog.create({
      date,
      username: req.user.username,
      project,
      category,
      hours,
      description,
    });
    res.status(201).json({ log: doc.toJSON() });
  } catch (e) {
    console.error('POST /logs failed:', e?.message ?? e);
    res.status(500).json({ error: 'db_error', detail: e?.message ?? String(e) });
  }
});

router.delete('/', requireAuth, async (req, res) => {
  const id = req.query.id;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'id_required' });
  }
  if (!mongoose.isValidObjectId(id)) {
    return res.status(404).json({ error: 'not_found' });
  }

  try {
    const log = await TimeLog.findById(id);
    if (!log) return res.status(404).json({ error: 'not_found' });

    if (req.user.role !== 'admin') {
      if (log.username !== req.user.username) {
        return res.status(403).json({ error: 'forbidden' });
      }
      if (log.approvedAt) {
        return res.status(403).json({
          error: 'log_approved',
          message:
            'This entry has been approved by an admin and can no longer be edited. Ask an admin to unapprove it first.',
        });
      }
    }

    await log.deleteOne();
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /logs failed:', e?.message ?? e);
    res.status(500).json({ error: 'db_error', detail: e?.message ?? String(e) });
  }
});

// Multi-select: delete several logs at once.
// Devs may only delete their own un-approved logs; admins may delete anything.
router.post('/bulk-delete', requireAuth, async (req, res) => {
  const body = req.body ?? {};
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((x) => typeof x === 'string')
    : [];

  if (ids.length === 0) return res.status(400).json({ error: 'no_ids' });
  if (ids.length > BULK_IDS_MAX) {
    return res.status(400).json({ error: 'too_many_ids' });
  }

  const validIds = ids.filter((id) => mongoose.isValidObjectId(id));
  if (validIds.length === 0) return res.json({ deleted: 0 });

  try {
    const filter =
      req.user.role === 'admin'
        ? { _id: { $in: validIds } }
        : { _id: { $in: validIds }, username: req.user.username, approvedAt: null };

    const result = await TimeLog.deleteMany(filter);
    res.json({ deleted: result.deletedCount });
  } catch (e) {
    console.error('POST /logs/bulk-delete failed:', e?.message ?? e);
    res.status(500).json({ error: 'db_error', detail: e?.message ?? String(e) });
  }
});

export default router;
