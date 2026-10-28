import fs from 'node:fs';
import mongoose from 'mongoose';
import { Job } from '../models/Job.js';

const SEED_FILE = new URL('../seed/jobs.json', import.meta.url);
const MARKER = 'jobs-seeded';

/**
 * Import the roles that used to be hard-coded in the client
 * (client/src/lib/jobs-data.js), once, on first start, under the same URLs.
 *
 * They come in as drafts, not live: they were written as placeholders
 * (US-style benefits, no real location), so someone with careers.manage
 * should check each one before it goes back on the site.
 *
 * Runs only while no roles exist and the import has never happened, so
 * deleting a role later never brings it back.
 */
export async function ensureJobsSeed() {
  const meta = mongoose.connection.db.collection('meta');
  if (await meta.findOne({ _id: MARKER })) return;

  if ((await Job.estimatedDocumentCount()) === 0) {
    const { jobs } = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
    for (const j of jobs) {
      await Job.create({ ...j, status: 'draft', createdBy: 'import', updatedBy: 'import' });
    }
    console.log(`[careers] imported ${jobs.length} earlier roles as drafts`);
  }

  await meta.insertOne({ _id: MARKER, at: new Date() });
}
