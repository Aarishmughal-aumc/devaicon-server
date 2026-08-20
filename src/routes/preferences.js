import { Router } from 'express';
import { User } from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

/**
 * Per-user dashboard preferences.
 *
 * Card ids are validated for shape only, never against a list of known cards.
 * The catalogue lives in the client, and pinning the server to it would mean a
 * deploy here every time a tile is added. An id this build has never heard of
 * is inert: the client drops unknown ids when it reads them back. The caps
 * below are what actually matter — they stop a user document being used as
 * free storage.
 */

const MAX_IDS = 40;
const MAX_ID_LENGTH = 40;

function cleanIds(value) {
  if (!Array.isArray(value)) return null;
  if (value.length > MAX_IDS) return null;
  const out = [];
  for (const id of value) {
    if (typeof id !== 'string') return null;
    if (id.length === 0 || id.length > MAX_ID_LENGTH) return null;
    if (!/^[A-Za-z0-9_]+$/.test(id)) return null;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

router.get('/', requireAuth, async (req, res) => {
  const user = await User.findOne({ username: req.user.username }).select(
    'preferences',
  );
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  res.json({ preferences: user.preferences ?? null });
});

router.put('/', requireAuth, async (req, res) => {
  const overview = req.body?.overview;
  if (typeof overview !== 'object' || overview === null) {
    return res.status(400).json({
      error: 'invalid_preferences',
      message: 'Expected an "overview" object.',
    });
  }

  const pinned = cleanIds(overview.pinned);
  const extra = cleanIds(overview.extra);
  if (pinned === null || extra === null) {
    return res.status(400).json({
      error: 'invalid_preferences',
      message: 'Card lists must be arrays of at most 40 short ids.',
    });
  }

  // A card in both lanes would render twice. The visible lane wins.
  const pinnedSet = new Set(pinned);
  const dedupedExtra = extra.filter((id) => !pinnedSet.has(id));

  const user = await User.findOneAndUpdate(
    { username: req.user.username },
    { $set: { 'preferences.overview': { pinned, extra: dedupedExtra } } },
    { new: true },
  ).select('preferences');

  if (!user) return res.status(401).json({ error: 'unauthorized' });
  res.json({ preferences: user.preferences });
});

export default router;
