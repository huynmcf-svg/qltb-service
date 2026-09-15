'use strict';

/**
 * Chạy migration khi Vercel build Production (push lên nhánh main).
 * Preview / local `npm run build` bỏ qua — không đụng DB production từ PR.
 */
const { spawnSync } = require('node:child_process');

if (!process.env.VERCEL) {
  process.exit(0);
}

const env = process.env.VERCEL_ENV;
const ref = process.env.VERCEL_GIT_COMMIT_REF;
const run = env === 'production' || ref === 'main';

if (!run) {
  console.log(`[migrate] bỏ qua (VERCEL_ENV=${env ?? '?'} ref=${ref ?? '?'})`);
  process.exit(0);
}

console.log('[migrate] production — npm run db:migrate');
const result = spawnSync('npm', ['run', 'db:migrate'], {
  stdio: 'inherit',
  env: process.env,
});
process.exit(result.status === null ? 1 : result.status);
