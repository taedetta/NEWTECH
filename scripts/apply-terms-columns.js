'use strict';
const { Pool } = require('pg');
const { loadDotEnv, requireEnv } = require('./qa-safety');

loadDotEnv();

const p = new Pool({
  connectionString: requireEnv('DATABASE_URL', 'apply-terms-columns'),
  ssl: false,
});
p.query(`
  ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_version VARCHAR(32);
`).then(() => {
  console.log('terms columns OK');
  return p.end();
}).catch((e) => { console.error(e.message); process.exit(1); });
