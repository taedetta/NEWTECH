'use strict';
const { Pool } = require('pg');
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}
const p = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
});
p.query(`
  ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_version VARCHAR(32);
`).then(() => {
  console.log('terms columns OK');
  return p.end();
}).catch((e) => { console.error(e.message); process.exit(1); });
