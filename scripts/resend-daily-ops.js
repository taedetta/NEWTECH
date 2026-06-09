'use strict';
/**
 * Resend daily briefing emails + PDF backup / CSV export emails.
 * Usage: APP_ENV=production DATABASE_URL=... node scripts/resend-daily-ops.js
 */
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m || process.env[m[1]]) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[m[1]] = val;
  }
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL required');
  process.exit(1);
}

process.env.APP_ENV = process.env.APP_ENV || 'production';

const { Pool } = require('pg');
const { runInstructorDailyBriefings } = require('../lib/instructor-briefing');
const { runBackup } = require('../backup-service');
const { runExport } = require('../export-service');

const dbUrl = process.env.DATABASE_URL;
const pool = new Pool({
  connectionString: dbUrl,
  ssl: /localhost|127\.0\.0\.1|railway\.internal/i.test(dbUrl) ? false : { rejectUnauthorized: false },
});

(async () => {
  console.log('=== 1/3 Daily instructor briefings ===');
  const briefing = await runInstructorDailyBriefings(pool);
  console.log('Briefings sent:', briefing.sent);

  console.log('\n=== 2/3 PDF backup reports ===');
  const backup = await runBackup(pool, 'daily');
  console.log('Backup success:', backup.success);

  console.log('\n=== 3/3 CSV records export ===');
  const exp = await runExport(pool);
  console.log('Export uploaded:', exp.uploaded, 'files');

  await pool.end();
  if (!backup.success) process.exit(1);
  console.log('\nDone — check instructor inboxes and backup recipients.');
})().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
