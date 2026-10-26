import { Post } from '../models/Post.js';
import { pathsForPost, revalidate } from './blog.js';

const EVERY_MS = 60 * 1000;

/**
 * Once a minute, turn scheduled posts whose time has come into published ones
 * and refresh their pages. A due post is already visible without this (see
 * liveFilter); the flip keeps the status honest in the editor, and the
 * refresh makes it appear without waiting for the site's cache.
 */
export function startScheduler() {
  const tick = async () => {
    try {
      const due = await Post.find({ status: 'scheduled', publishedAt: { $lte: new Date() } })
        .select('slug')
        .lean();
      if (due.length === 0) return;
      await Post.updateMany(
        { _id: { $in: due.map((p) => p._id) } },
        { $set: { status: 'published' } },
      );
      console.log(`[blog] published ${due.length} scheduled post(s)`);
      revalidate(due.flatMap((p) => pathsForPost(p.slug)));
    } catch (e) {
      console.error('[blog] scheduler tick failed:', e?.message ?? e);
    }
  };
  setInterval(tick, EVERY_MS).unref?.();
  tick();
}
