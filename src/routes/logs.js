import { Router } from 'express';
import mongoose from 'mongoose';
import { TimeLog } from '../models/TimeLog.js';
import { Project } from '../models/Project.js';
import { requireAuth } from '../middleware/auth.js';
import { CATEGORIES } from '../constants.js';

const router = Router();

router.get('/', requireAuth, async (req, res) => {
  const wantAll = req.query.all === '1';
  if (wantAll && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'forbidden' });
  }

  try {
    const filter = wantAll ? {} : { username: req.user.username };
    const docs = await TimeLog.find(filter).sort({ loggedAt: -1 }).lean();
    const logs = docs.map((d) => ({
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
    }));
    res.json({ logs });
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
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
    return res.status(400).json({
      error: 'invalid_hours',
      message: 'Hours must be between 0 and 24.',
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

export default router;
