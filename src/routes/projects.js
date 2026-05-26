import { Router } from 'express';
import mongoose from 'mongoose';
import { Project } from '../models/Project.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, async (_req, res) => {
  try {
    const docs = await Project.find().sort({ addedAt: 1 }).lean();
    const projects = docs.map((d) => ({
      id: d._id.toString(),
      name: d.name,
      addedAt: d.addedAt ? new Date(d.addedAt).toISOString() : '',
      addedBy: d.addedBy,
    }));
    res.json({ projects });
  } catch (e) {
    console.error('GET /projects failed:', e?.message ?? e);
    res.status(500).json({ error: 'db_error', detail: e?.message ?? String(e) });
  }
});

router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) return res.status(400).json({ error: 'name_required' });
  if (name.length > 100) return res.status(400).json({ error: 'name_too_long' });

  try {
    const existing = await Project.findOne({ nameLower: name.toLowerCase() }).lean();
    if (existing) return res.status(409).json({ error: 'duplicate_project' });

    const doc = await Project.create({ name, addedBy: req.user.username });
    res.status(201).json({ project: doc.toJSON() });
  } catch (e) {
    if (e?.code === 11000) {
      return res.status(409).json({ error: 'duplicate_project' });
    }
    console.error('POST /projects failed:', e?.message ?? e);
    res.status(500).json({ error: 'db_error', detail: e?.message ?? String(e) });
  }
});

router.delete('/', requireAuth, requireAdmin, async (req, res) => {
  const id = req.query.id;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'id_required' });
  }
  if (!mongoose.isValidObjectId(id)) {
    return res.status(404).json({ error: 'not_found' });
  }
  try {
    const out = await Project.findByIdAndDelete(id);
    if (!out) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /projects failed:', e?.message ?? e);
    res.status(500).json({ error: 'db_error', detail: e?.message ?? String(e) });
  }
});

export default router;
