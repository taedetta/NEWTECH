'use strict';
/** Verify scheduled downtime appears on calendar days only + booking window logic. */
const fs = require('fs');
const jwt = require('jsonwebtoken');

const BASE = process.env.QA_BASE || 'https://flightslate-staging-production.up.railway.app';
const JWT_SECRET = process.env.JWT_SECRET || (
  fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8').match(/JWT_SECRET=(.+)/)?.[1]?.trim() : null
);

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

  if (!JWT_SECRET) {
    console.error('JWT_SECRET required');
    process.exit(1);
  }

  console.log('Downtime schedule E2E —', BASE);

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'qa-maintenance@test.local', password: process.env.TEST_USER_PASSWORD || 'TestPass123!' }),
  }).then(r => r.json()).catch(() => ({}));

  let token = login.token;
  if (!token) {
    token = jwt.sign({ id: 12, email: 'qa-maintenance@test.local', role: 'maintenance', name: 'QA Maintenance' }, JWT_SECRET, { expiresIn: '1h' });
  }

  const acRes = await api(token, '/api/aircraft');
  ok('GET aircraft', acRes.status === 200);
  const aircraftId = acRes.data?.[0]?.id;
  if (!aircraftId) process.exit(1);

  const today = new Date();
  const affected = new Date(today);
  affected.setDate(affected.getDate() + 3);
  const unaffected = new Date(today);
  unaffected.setDate(unaffected.getDate() + 10);
  const affStr = affected.toLocaleDateString('en-CA');
  const unaffStr = unaffected.toLocaleDateString('en-CA');

  const monthStart = new Date(affected.getFullYear(), affected.getMonth(), 1).toLocaleDateString('en-CA');
  const monthEnd = new Date(affected.getFullYear(), affected.getMonth() + 1, 0).toLocaleDateString('en-CA');

  const postRes = await api(token, '/api/downtime', {
    method: 'POST',
    body: JSON.stringify({
      aircraft_id: aircraftId,
      start_date: affStr,
      end_date: affStr,
      start_time: '13:00',
      end_time: '15:00',
      all_day: false,
      reason: 'Schedule E2E test',
      create_squawk: false,
    }),
  });
  ok('POST scheduled downtime', postRes.status === 201, postRes.data?.error);
  const dtId = postRes.data?.id;

  await api(token, `/api/aircraft/${aircraftId}/maintenance`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'available', reason: null }),
  });

  const acAfter = await api(token, '/api/aircraft');
  const row = (acAfter.data || []).find(a => a.id === aircraftId);
  ok('aircraft stays available', row?.status === 'available', row?.status);

  const rangeRes = await api(token, `/api/downtime/range?start=${monthStart}&end=${monthEnd}`);
  ok('GET downtime range', rangeRes.status === 200 && Array.isArray(rangeRes.data));
  ok('range includes test entry', (rangeRes.data || []).some(d => d.id === dtId));

  const byDateAff = await api(token, `/api/downtime/by-date?date=${affStr}`);
  ok('affected day has downtime', (byDateAff.data || []).some(d => d.id === dtId));

  const byDateUnaff = await api(token, `/api/downtime/by-date?date=${unaffStr}`);
  ok('unaffected day has no test downtime', !(byDateUnaff.data || []).some(d => d.id === dtId));

  const outside = await api(token, `/api/downtime/check?aircraft_id=${aircraftId}&date=${affStr}&start_time=08:00&end_time=10:00`);
  ok('bookable outside window on affected day', outside.data?.unavailable !== true);

  const inside = await api(token, `/api/downtime/check?aircraft_id=${aircraftId}&date=${affStr}&start_time=13:30&end_time=14:30`);
  ok('blocked inside window', inside.data?.unavailable === true);

  const futureDay = await api(token, `/api/downtime/check?aircraft_id=${aircraftId}&date=${unaffStr}&start_time=10:00&end_time=12:00`);
  ok('bookable on unaffected day', futureDay.data?.unavailable !== true);

  if (dtId) await api(token, `/api/downtime/${dtId}`, { method: 'DELETE' });

  if (failures.length) {
    console.error('\nFailures:', failures.join(', '));
    process.exit(1);
  }
  console.log('\nAll schedule downtime tests passed.');
}

main().catch((e) => { console.error(e); process.exit(1); });
