'use strict';
const https = require('https');
const { Pool } = require('pg');

const TOKEN = process.env.RAILWAY_API_TOKEN;
const PROJECT_ID = '33507e47-1ddd-4db0-a42e-f8c818770dd7';
const ENV_ID = '709b9ddb-cc38-44bf-b533-d677ed619584';
const STAGING_DB = '1159c76d-017d-4361-91b4-65c4adf09856';

const DOWNTIME_PATCH = `
ALTER TABLE aircraft_downtime ADD COLUMN IF NOT EXISTS start_time TIME;
ALTER TABLE aircraft_downtime ADD COLUMN IF NOT EXISTS end_time TIME;
ALTER TABLE aircraft_downtime ADD COLUMN IF NOT EXISTS all_day BOOLEAN DEFAULT TRUE;
UPDATE aircraft_downtime SET all_day = TRUE WHERE all_day IS NULL;
ALTER TABLE aircraft ADD COLUMN IF NOT EXISTS maintenance_reason TEXT;
`;

function gql(query, variables) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, variables });
    const req = https.request({
      hostname: 'backboard.railway.com', path: '/graphql/v2', method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve(JSON.parse(d)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

(async () => {
  const r = await gql(`
    query($projectId: String!, $environmentId: String!, $serviceId: String!) {
      variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
    }
  `, { projectId: PROJECT_ID, environmentId: ENV_ID, serviceId: STAGING_DB });
  const v = r.data?.variables || {};
  const url = `postgresql://postgres:${encodeURIComponent(v.POSTGRES_PASSWORD)}@${v.RAILWAY_TCP_PROXY_DOMAIN}:${v.RAILWAY_TCP_PROXY_PORT}/railway?sslmode=disable`;
  const pool = new Pool({ connectionString: url, ssl: false });

  console.log('Applying downtime window columns to staging DB...');
  await pool.query(DOWNTIME_PATCH);
  console.log('Done.');

  const cols = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name='aircraft_downtime' ORDER BY ordinal_position"
  );
  console.log('aircraft_downtime columns:', cols.rows.map((x) => x.column_name));

  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
