'use strict';
/**
 * Run PDF backup + CSV records export immediately and email recipients.
 * Usage: node scripts/run-backup-export-now.js
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

const { Pool } = require('pg');
const { runBackup } = require('../backup-service');
const { runExport } = require('../export-service');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL required');
  process.exit(1);
}

if (process.env.APP_ENV === 'staging') {
  console.error('Backup/export must run with APP_ENV=production (live site data only)');
  process.exit(1);
}

process.env.APP_ENV = process.env.APP_ENV || 'production';

const dbUrl = process.env.DATABASE_URL;
const pool = new Pool({
  connectionString: dbUrl,
  ssl: /localhost|127\.0\.0\.1|railway\.internal/i.test(dbUrl) ? false : { rejectUnauthorized: false },
});

(async () => {
  console.log('=== PDF Backup (6 reports) ===');
  const backup = await runBackup(pool, 'daily');
  console.log('Backup result:', JSON.stringify(backup, null, 2));

  console.log('\n=== Records Export (9 CSVs) ===');
  const exp = await runExport(pool);
  console.log('Export result:', JSON.stringify({ ...exp, files: exp.files?.map((f) => ({ folder: f.folder, count: f.count, url: f.url })) }, null, 2));

  await pool.end();
  if (!backup.success) process.exit(1);
  console.log('\nDone — check aviationnewtech@gmail.com (and other backup recipients).');
})().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
