import { env } from './config/env.js';
import { connectDB } from './config/db.js';
import { createApp } from './app.js';
import { ensureRbac } from './lib/rbac.js';
import { ensureBootstrapAdmin } from './lib/bootstrapAdmin.js';
import { ensureBlogSeed } from './lib/blogSeed.js';
import { startScheduler } from './lib/scheduler.js';

async function main() {
  await connectDB();
  await ensureRbac();
  await ensureBootstrapAdmin();
  await ensureBlogSeed();
  const app = createApp();
  app.listen(env.port, () => {
    console.log(`[server] listening on http://localhost:${env.port}`);
  });
  startScheduler();
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
