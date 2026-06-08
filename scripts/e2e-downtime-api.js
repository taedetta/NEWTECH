'use strict';
/** E2E test for downtime + mark down flows via API (JWT from DB user lookup). */
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const BASE = process.env.QA_BASE || 'http://localhost:3000';
const DB = process.env.DATABASE_URL || (
  fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8').match(/DATABASE_URL=(.+)/)?.[1]?.trim() : null
);
const JWT_SECRET = process.env.JWT_SECRET || (
  fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8').match(/JWT_SECRET=(.+)/)?.[1]?.trim() : null
);

async function api(token, path, opts = {}) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${BASE}${path}${sep}_=${Date.now()}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 300) }; }
  return { status: res.status, data };
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

async function main() {
  const failures = [];
  const ok = (name, cond, detail = '') => {
    if (cond) console.log('  OK', name);
    else { failures.push(name); console.log('  FAIL', name, detail); }
  };

  console.log('Downtime E2E API test —', BASE);

  if (!DB || !JWT_SECRET) {
    console.error('DATABASE_URL and JWT_SECRET required');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: DB,
    ssl: /\.rlwy\.net|railway\.internal/i.test(DB) ? false : undefined,
  });

  const userRes = await pool.query(
    "SELECT id, email, name, role FROM users WHERE role = 'maintenance' AND deleted_at IS NULL LIMIT 1"
  );
  ok('maintenance user exists', userRes.rows.length > 0);
  if (!userRes.rows.length) process.exit(1);

  const user = userRes.rows[0];
  const token = signToken(user);
  console.log('  Using', user.email, 'id=', user.id);

  const acRes = await api(token, '/api/aircraft');
  ok('GET /api/aircraft', acRes.status === 200, `status=${acRes.status} ${JSON.stringify(acRes.data).slice(0,120)}`);
  const aircraft = Array.isArray(acRes.data) ? acRes.data : [];
  ok('aircraft list non-empty', aircraft.length > 0);
  if (!aircraft.length) process.exit(1);

  const aircraftId = aircraft[0].id;
  console.log('  Aircraft', aircraft[0].tail_number, 'id=', aircraftId);

  const listRes = await api(token, `/api/downtime?aircraft_id=${aircraftId}`);
  ok('GET /api/downtime', listRes.status === 200, `status=${listRes.status} err=${listRes.data?.error}`);
  ok('downtime list is array', Array.isArray(listRes.data), typeof listRes.data);

  const today = new Date().toLocaleDateString('en-CA');
  const postRes = await api(token, '/api/downtime', {
    method: 'POST',
    body: JSON.stringify({
      aircraft_id: aircraftId,
      start_date: today,
      end_date: today,
      start_time: '09:00',
      end_time: '11:00',
      all_day: false,
      reason: 'E2E downtime test',
      create_squawk: false,
    }),
  });
  ok('POST /api/downtime', postRes.status === 201, `status=${postRes.status} err=${postRes.data?.error}`);
  const dtId = postRes.data?.id;

  const list2 = await api(token, `/api/downtime?aircraft_id=${aircraftId}`);
  ok('downtime appears in list', Array.isArray(list2.data) && list2.data.some((d) => d.id === dtId));

  const patchRes = await api(token, `/api/aircraft/${aircraftId}/maintenance`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'maintenance', reason: 'E2E mark down test' }),
  });
  ok('PATCH maintenance down', patchRes.status === 200, `status=${patchRes.status} err=${patchRes.data?.error}`);
  ok('status is maintenance', patchRes.data?.status === 'maintenance');

  const patchUp = await api(token, `/api/aircraft/${aircraftId}/maintenance`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'available', reason: null }),
  });
  ok('PATCH maintenance up', patchUp.status === 200);

  if (dtId) {
    const del = await api(token, `/api/downtime/${dtId}`, { method: 'DELETE' });
    ok('DELETE downtime', del.status === 200);
  }

  await pool.end();

  if (failures.length) {
    console.error('\nFailures:', failures.join(', '));
    process.exit(1);
  }
  console.log('\nAll downtime API tests passed.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
