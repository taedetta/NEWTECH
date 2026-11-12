'use strict';

/**
 * Security hardening smoke tests for auth and role boundaries.
 *
 * Usage:
 *   QA_BASE=http://127.0.0.1:3000 node scripts/test-hardening.js
 */
const BASE = process.env.QA_BASE || process.argv[process.argv.indexOf('--base') + 1] || 'http://127.0.0.1:3000';
const PASSWORD = process.env.TEST_USER_PASSWORD || 'TestPass123!';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'NewTech2026!';

const failures = [];

function ok(name, cond, detail = '') {
  if (cond) {
    console.log(`  OK ${name}`);
  } else {
    failures.push(`${name}${detail ? `: ${detail}` : ''}`);
    console.log(`  FAIL ${name}${detail ? `: ${detail}` : ''}`);
  }
}

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${email}: ${data.error || res.status}`);
  return data.token;
}

async function api(token, path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function main() {
  console.log('Hardening tests:', BASE);

  const unauthBookings = await api(null, '/api/bookings');
  ok('unauthenticated bookings rejected', unauthBookings.status === 401, JSON.stringify(unauthBookings.data));

  const invalidToken = await api('not-a-valid-token', '/api/users');
  ok('invalid bearer token rejected', invalidToken.status === 401, JSON.stringify(invalidToken.data));

  const adminToken = await login('evaughntaemw@gmail.com', ADMIN_PASSWORD);
  const studentToken = await login('qa-student@test.local', PASSWORD);
  const renterToken = await login('qa-renter@test.local', PASSWORD);
  const maintenanceToken = await login('qa-maintenance@test.local', PASSWORD);

  const aircraft = await api(adminToken, '/api/aircraft');
  const aircraftId = Array.isArray(aircraft.data) ? aircraft.data[0]?.id : null;
  ok('admin can list aircraft for boundary setup', aircraft.status === 200 && aircraftId, JSON.stringify(aircraft.data).slice(0, 120));

  const studentExport = await api(studentToken, '/api/users/export/fsp?location=KPSK');
  ok('student cannot export people', studentExport.status === 403, JSON.stringify(studentExport.data));

  const renterDowntime = await api(renterToken, '/api/downtime', {
    method: 'POST',
    body: JSON.stringify({
      aircraft_id: aircraftId,
      start_date: '2099-01-10',
      end_date: '2099-01-10',
      start_time: '09:00',
      end_time: '10:00',
      reason: 'Unauthorized QA probe',
    }),
  });
  ok('renter cannot create downtime', renterDowntime.status === 403, JSON.stringify(renterDowntime.data));

  const maintenanceUsers = await api(maintenanceToken, '/api/users');
  ok('maintenance cannot list all users', maintenanceUsers.status === 403, JSON.stringify(maintenanceUsers.data));

  const studentSource = await api(studentToken, '/api/admin/download-source');
  ok('student cannot download source', studentSource.status === 403, JSON.stringify(studentSource.data));

  console.log(`\nHardening failures: ${failures.length}`);
  if (failures.length) failures.forEach((f) => console.log(' ', f));
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
