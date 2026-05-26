import { Router } from 'express';
import mongoose from 'mongoose';
import { TimeLog } from '../models/TimeLog.js';
import { Project } from '../models/Project.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { toCSV } from '../lib/csv.js';
import { FLAG_REASON_MAX_LENGTH } from '../constants.js';

const router = Router();

router.post('/approve', requireAuth, requireAdmin, async (req, res) => {
  const body = req.body ?? {};
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((x) => typeof x === 'string')
    : [];
  const approved = body.approved !== false;

  if (ids.length === 0) return res.status(400).json({ error: 'no_ids' });
  if (ids.length > 500) return res.status(400).json({ error: 'too_many_ids' });

  const validIds = ids.filter((id) => mongoose.isValidObjectId(id));
  if (validIds.length === 0) return res.json({ updated: 0 });

  try {
    const update = approved
      ? { approvedAt: new Date(), approvedBy: req.user.username }
      : { approvedAt: null, approvedBy: '' };

    const result = await TimeLog.updateMany(
      { _id: { $in: validIds } },
      { $set: update },
    );
    res.json({ updated: result.modifiedCount });
  } catch (e) {
    console.error('POST /admin/approve failed:', e?.message ?? e);
    res.status(500).json({ error: 'db_error', detail: e?.message ?? String(e) });
  }
});

router.post('/flag', requireAuth, requireAdmin, async (req, res) => {
  const body = req.body ?? {};
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((x) => typeof x === 'string')
    : [];
  const flagged = body.flagged !== false;
  const reason = String(body.reason ?? '').trim();

  if (ids.length === 0) return res.status(400).json({ error: 'no_ids' });
  if (ids.length > 500) return res.status(400).json({ error: 'too_many_ids' });
  if (reason.length > FLAG_REASON_MAX_LENGTH) {
    return res.status(400).json({
      error: 'reason_too_long',
      message: `Reason must be at most ${FLAG_REASON_MAX_LENGTH} characters.`,
    });
  }

  const validIds = ids.filter((id) => mongoose.isValidObjectId(id));
  if (validIds.length === 0) return res.json({ updated: 0 });

  try {
    const update = flagged
      ? {
          flagged: true,
          flaggedAt: new Date(),
          flaggedBy: req.user.username,
          flagReason: reason,
        }
      : {
          flagged: false,
          flaggedAt: null,
          flaggedBy: '',
          flagReason: '',
        };

    const result = await TimeLog.updateMany(
      { _id: { $in: validIds } },
      { $set: update },
    );
    res.json({ updated: result.modifiedCount });
  } catch (e) {
    console.error('POST /admin/flag failed:', e?.message ?? e);
    res.status(500).json({ error: 'db_error', detail: e?.message ?? String(e) });
  }
});

router.get('/export', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const [logs, projects] = await Promise.all([
      TimeLog.find().sort({ loggedAt: 1 }).lean(),
      Project.find().sort({ addedAt: 1 }).lean(),
    ]);

    const logsCSV = toCSV(
      [
        'ID',
        'Date',
        'Username',
        'Project',
        'Category',
        'Hours',
        'Description',
        'LoggedAt',
        'ApprovedAt',
        'ApprovedBy',
        'Flagged',
        'FlaggedAt',
        'FlaggedBy',
        'FlagReason',
      ],
      logs.map((l) => [
        l._id.toString(),
        l.date,
        l.username,
        l.project,
        l.category,
        l.hours,
        l.description ?? '',
        l.loggedAt ? new Date(l.loggedAt).toISOString() : '',
        l.approvedAt ? new Date(l.approvedAt).toISOString() : '',
        l.approvedBy ?? '',
        l.flagged ? 'true' : 'false',
        l.flaggedAt ? new Date(l.flaggedAt).toISOString() : '',
        l.flaggedBy ?? '',
        l.flagReason ?? '',
      ]),
    );

    const projectsCSV = toCSV(
      ['ID', 'Name', 'AddedAt', 'AddedBy'],
      projects.map((p) => [
        p._id.toString(),
        p.name,
        p.addedAt ? new Date(p.addedAt).toISOString() : '',
        p.addedBy,
      ]),
    );

    const body = `# TimeLogs\r\n${logsCSV}\r\n\r\n# Projects\r\n${projectsCSV}\r\n`;
    const filename = `devaicon-timelogs-${new Date().toISOString().slice(0, 10)}.csv`;

    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(body);
  } catch (e) {
    console.error('GET /admin/export failed:', e?.message ?? e);
    res.status(500).json({ error: 'export_failed', detail: e?.message ?? String(e) });
  }
});

export default router;
