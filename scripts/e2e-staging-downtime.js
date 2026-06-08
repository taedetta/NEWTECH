'use strict';
/** Staging downtime API test using staging DB user + staging JWT secret. */
const https = require('https');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const BASE = 'https://flightslate-staging-production.up.railway.app';
const TOKEN = process.env.RAILWAY_API_TOKEN;
const PROJECT_ID = '33507e47-1ddd-4db0-a42e-f8c818770dd7';
const ENV_ID = '709b9ddb-cc38-44bf-b533-d677ed619584';
const STAGING_DB = '1159c76d-017d-4361-91b4-65c4adf09856';
const STAGING_WEB = '5f3e71e8-7fdf-4f08-b6ba-04a349e30264';

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

async function serviceVars(serviceId) {
  const r = await gql(`
    query($projectId: String!, $environmentId: String!, $serviceId: String!) {
      variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
    }
  `, { projectId: PROJECT_ID, environmentId: ENV_ID, serviceId });
  return r.data?.variables || {};
}

async function api(token, path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function main() {
  const failures = [];
  const ok = (name, cond, detail = '') => {
    if (cond) console.log('  OK', name);
    else { failures.push(name); console.log('  FAIL', name, detail); }
  };

  console.log('Staging downtime E2E —', BASE);
  const webVars = await serviceVars(STAGING_WEB);
  const dbVars = await serviceVars(STAGING_DB);
  const dbUrl = `postgresql://postgres:${encodeURIComponent(dbVars.POSTGRES_PASSWORD)}@${dbVars.RAILWAY_TCP_PROXY_DOMAIN}:${dbVars.RAILWAY_TCP_PROXY_PORT}/railway?sslmode=disable`;
  const pool = new Pool({ connectionString: dbUrl, ssl: false });
  const user = (await pool.query("SELECT id, email, role, name FROM users WHERE email='qa-maintenance@test.local' LIMIT 1")).rows[0];
  await pool.end();

  const token = jwt.sign({ id: user.id, email: user.email, role: user.role, name: user.name }, webVars.JWT_SECRET, { expiresIn: '1h' });

  const acRes = await api(token, '/api/aircraft');
  ok('GET aircraft', acRes.status === 200);
  const aircraftId = acRes.data[0]?.id;

  const listRes = await api(token, `/api/downtime?aircraft_id=${aircraftId}`);
  ok('GET downtime', listRes.status === 200 && Array.isArray(listRes.data), JSON.stringify(listRes.data).slice(0, 120));

  const today = new Date().toLocaleDateString('en-CA');
  const postRes = await api(token, '/api/downtime', {
    method: 'POST',
    body: JSON.stringify({
      aircraft_id: aircraftId,
      start_date: today,
      end_date: today,
      start_time: '14:00',
      end_time: '16:00',
      all_day: false,
      reason: 'Staging E2E test',
      create_squawk: false,
    }),
  });
  ok('POST downtime', postRes.status === 201, postRes.data?.error);
  const dtId = postRes.data?.id;

  // Scheduled window flow: aircraft stays available globally
  const availRes = await api(token, `/api/aircraft/${aircraftId}/maintenance`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'available', reason: null }),
  });
  ok('PATCH keep available after scheduled window', availRes.status === 200 && availRes.data?.status === 'available');

  const acCheck = await api(token, '/api/aircraft');
  const acRow = (acCheck.data || []).find(a => a.id === aircraftId);
  ok('aircraft list shows available status', acRow?.status === 'available', acRow?.status);

  const outsideCheck = await api(token, `/api/downtime/check?aircraft_id=${aircraftId}&date=${today}&start_time=08:00&end_time=10:00`);
  ok('bookable outside downtime window', outsideCheck.data?.unavailable !== true, JSON.stringify(outsideCheck.data));

  const insideCheck = await api(token, `/api/downtime/check?aircraft_id=${aircraftId}&date=${today}&start_time=14:30&end_time=15:30`);
  ok('blocked inside downtime window', insideCheck.data?.unavailable === true, JSON.stringify(insideCheck.data));

  await api(token, `/api/aircraft/${aircraftId}/maintenance`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'available' }),
  });
  if (dtId) await api(token, `/api/downtime/${dtId}`, { method: 'DELETE' });

  if (failures.length) {
    console.error('Failures:', failures.join(', '));
    process.exit(1);
  }
  console.log('\nStaging downtime E2E passed.');
}

main().catch((e) => { console.error(e); process.exit(1); });
