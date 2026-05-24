/**
 * Pull CMS content from the live New Tech Aviation site into data/live-cms.json.
 * Used by setup-local.js to seed site_content when bootstrapping a fresh database.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const LIVE_URL = process.env.LIVE_SITE_URL || 'https://www.newtechaviation.com';
const OUT = path.join(__dirname, '..', 'data', 'live-cms.json');

async function main() {
  const res = await fetch(`${LIVE_URL}/api/site-content?full=1`);
  if (!res.ok) throw new Error(`Failed to fetch CMS: HTTP ${res.status}`);
  const data = await res.json();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(data, null, 2));
  console.log(`Saved ${Object.keys(data).length} CMS keys to ${OUT}`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
