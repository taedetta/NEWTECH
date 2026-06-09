'use strict';
/**
 * Resend instructor daily briefing emails immediately.
 * Usage: APP_ENV=production DATABASE_URL=... node scripts/run-briefing-now.js
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

const dbUrl = process.env.DATABASE_URL;
const pool = new Pool({
  connectionString: dbUrl,
  ssl: /localhost|127\.0\.0\.1|railway\.internal/i.test(dbUrl) ? false : { rejectUnauthorized: false },
});

(async () => {
  console.log('=== Resending instructor daily briefings ===');
  const result = await runInstructorDailyBriefings(pool);
  console.log('Result:', result);
  await pool.end();
})().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
