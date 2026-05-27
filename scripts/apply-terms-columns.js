'use strict';
const { Pool } = require('pg');
const p = new Pool({
  connectionString: process.env.DATABASE_URL
    || 'postgresql://postgres:cxrFQ1P3ZoQgtNWCIQn_c1a4sQIkaPij@shortline.proxy.rlwy.net:26871/railway',
  ssl: false,
});
p.query(`
  ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_version VARCHAR(32);
`).then(() => {
  console.log('terms columns OK');
  return p.end();
}).catch((e) => { console.error(e.message); process.exit(1); });
