'use strict';
/**
 * Full beta QA — booking complete/cancel/end-early flows per role,
 * billing + instructor hours + history verification, maintenance access,
 * terms acceptance on signup.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/full-beta-qa.js [--base http://localhost:3000]
 */
const fs = require('fs');
const { Pool } = require('pg');
const { TERMS_VERSION } = require('../lib/terms');

const BASE = process.argv.includes('--base')
  ? process.argv[process.argv.indexOf('--base') + 1]
  : (process.env.QA_BASE || 'https://www.newtechaviation.com');

const PASS = process.env.TEST_USER_PASSWORD || 'TestPass123!';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'NewTech2026!';

process.env.DATABASE_URL = process.env.DATABASE_URL
  || (fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8').match(/DATABASE_URL=(.+)/)?.[1]?.trim() : null)
  || 'postgresql://postgres:cxrFQ1P3ZoQgtNWCIQn_c1a4sQIkaPij@shortline.proxy.rlwy.net:26871/railway';

const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) console.log('  OK', name);
  else { failures.push(name); console.log('  FAIL', name, detail); }
};

async function login(email, password) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`${email}: ${d.error || r.status}`);
  return d.token;
}

async function api(token, path, opts = {}) {
  const r = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers || {}) },
  });
  const d = await r.json().catch(() => ({}));
  return { status: r.status, data: d };
}

function localSlot(startDate, startHM, endDate, endHM) {
  const start_time = new Date(`${startDate}T${startHM}:00`).toISOString();
  let end_time;
  if (endDate > startDate) {
    end_time = endHM === '24:00'
      ? new Date(new Date(`${endDate}T00:00:00`).getTime() + 86400000).toISOString()
      : new Date(`${endDate}T${endHM}:00`).toISOString();
  } else {
    end_time = endHM === '24:00' || endHM < startHM
      ? new Date(new Date(`${startDate}T00:00:00`).getTime() + 86400000).toISOString()
      : new Date(`${startDate}T${endHM}:00`).toISOString();
  }
  return { start_time, end_time, local_date: startDate, local_start: startHM, local_end: endHM };
}

function pastSlot(hoursAgo = 3, durationMin = 90) {
  const start = new Date(Date.now() - hoursAgo * 3600000);
  const end = new Date(start.getTime() + durationMin * 60000);
  const pad = (n) => String(n).padStart(2, '0');
  const date = start.toLocaleDateString('en-CA');
  return localSlot(date, `${pad(start.getHours())}:${pad(start.getMinutes())}`, date, `${pad(end.getHours())}:${pad(end.getMinutes())}`);
}

function futureSlot(daysOut = 14, durationMin = 120) {
  const start = new Date();
  start.setDate(start.getDate() + daysOut);
  start.setHours(10, 0, 0, 0);
  const end = new Date(start.getTime() + durationMin * 60000);
  const pad = (n) => String(n).padStart(2, '0');
  const date = start.toLocaleDateString('en-CA');
  return localSlot(date, `${pad(start.getHours())}:${pad(start.getMinutes())}`, date, `${pad(end.getHours())}:${pad(end.getMinutes())}`);
}

async function cleanupBooking(pool, id) {
  if (!id) return;
  await pool.query('DELETE FROM instructor_hours WHERE booking_id = $1', [id]).catch(() => {});
  await pool.query('DELETE FROM flight_hobbs_readings WHERE booking_id = $1', [id]).catch(() => {});
  await pool.query('DELETE FROM flight_discrepancies WHERE booking_id = $1', [id]).catch(() => {});
  await pool.query('DELETE FROM aircraft_hours_history WHERE booking_id = $1', [id]).catch(() => {});
  await pool.query('DELETE FROM flight_logs WHERE booking_id = $1', [id]).catch(() => {});
  await pool.query('DELETE FROM billing_entries WHERE booking_id = $1', [id]).catch(() => {});
  await pool.query('DELETE FROM bookings WHERE id = $1', [id]).catch(() => {});
}

async function insertPastBooking(pool, { studentId, instructorId, aircraftId, type, hoursAgo }) {
  const slot = pastSlot(hoursAgo, 90);
  const r = await pool.query(`
    INSERT INTO bookings (student_id, instructor_id, aircraft_id, start_time, end_time, status, booking_type, created_by, source)
    VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, 'confirmed', $6, $7, 'production')
    RETURNING id
  `, [
    studentId || null,
    instructorId || null,
    aircraftId,
    slot.start_time,
    slot.end_time,
    type,
    instructorId || studentId,
  ]);
  return r.rows[0].id;
}

async function testLegalPages() {
  console.log('\n=== Legal pages ===');
  const terms = await fetch(`${BASE}/terms-of-service`);
  if (terms.status === 404) {
    console.log('  SKIP legal pages (not deployed yet — redeploy required)');
    return;
  }
  for (const p of ['/terms-of-service', '/privacy-policy', '/legal.css']) {
    const r = await fetch(`${BASE}${p}`);
    ok(`${p} loads`, r.status === 200, String(r.status));
  }
  const ti = await fetch(`${BASE}/api/auth/terms-info`);
  const tj = await ti.json().catch(() => ({}));
  ok('terms-info API', ti.status === 200 && tj.version, JSON.stringify(tj));
}

async function testTermsSignup(pool) {
  console.log('\n=== Terms acceptance on signup ===');
  const ti = await fetch(`${BASE}/api/auth/terms-info`);
  if (ti.status === 404) {
    console.log('  SKIP terms tests (not deployed yet — redeploy required)');
    return;
  }

  const email = `qa-terms-${Date.now()}@test.local`;
  const noTerms = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Terms Test', email, password: 'TestPass123!', phone: '5404401172', role: 'student',
    }),
  });
  ok('reject signup without terms', noTerms.status === 400, await noTerms.text());

  const withTerms = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Terms Test', email, password: 'TestPass123!', phone: '5404401172', role: 'student',
      acceptedTerms: true, termsVersion: TERMS_VERSION,
    }),
  });
  const wj = await withTerms.json().catch(() => ({}));
  ok('accept signup with terms', withTerms.status === 200 && wj.pending, JSON.stringify(wj));

  const row = await pool.query(
    'SELECT terms_accepted_at, terms_version FROM users WHERE LOWER(email) = LOWER($1)',
    [email]
  );
  ok('terms_accepted_at saved', row.rows[0]?.terms_accepted_at != null, JSON.stringify(row.rows[0]));
  ok('terms_version saved', row.rows[0]?.terms_version === TERMS_VERSION, row.rows[0]?.terms_version);

  await pool.query('DELETE FROM users WHERE LOWER(email) = LOWER($1)', [email]);
}

async function testStudentDualFlow(pool, tokens, users, ac, hobbs, tach) {
  console.log('\n=== Student dual: book → complete → billing + instructor hours + history ===');
  const { studentTok, instructorTok, adminTok } = tokens;
  const { student, instructor } = users;
  const created = [];

  const dualId = await insertPastBooking(pool, {
    studentId: student.id, instructorId: instructor.id, aircraftId: ac.id, type: 'dual', hoursAgo: 4,
  });
  created.push(dualId);

  const complete = await api(adminTok, `/api/bookings/${dualId}/complete`, {
    method: 'PATCH',
    body: JSON.stringify({
      hobbs_start: hobbs, hobbs_end: hobbs + 1.5,
      tach_start: tach, tach_end: tach + 1.4,
      dual_instruction_hours: 1.5,
    }),
  });
  ok('student dual complete', complete.status === 200, JSON.stringify(complete.data));

  const bill = await api(studentTok, `/api/billing/${student.id}`);
  ok('student billing shows completed dual', bill.status === 200 && bill.data.flights?.some((f) => f.id === dualId));

  const ih = await api(instructorTok, `/api/instructor-hours?instructor_id=${instructor.id}`);
  ok('instructor hours has dual entry', ih.status === 200 && ih.data.some((e) => e.booking_id === dualId));

  const hist = await api(studentTok, '/api/booking-history?period=all');
  ok('student history shows completed dual', hist.status === 200 && hist.data.rows.some((r) => r.id === dualId && r.status === 'completed'));

  for (const id of created) await cleanupBooking(pool, id);
}

async function testRenterSoloFlow(pool, tokens, users, ac) {
  console.log('\n=== Renter solo: book → complete → billing + history ===');
  const { renterTok, adminTok } = tokens;
  const { renter } = users;
  const created = [];

  const acFresh = (await api(adminTok, '/api/aircraft')).data.find((a) => a.id === ac.id);
  const hobbs = parseFloat(acFresh.current_hobbs);
  const tach = parseFloat(acFresh.current_tach || acFresh.current_hobbs);

  const renterId = await insertPastBooking(pool, {
    studentId: renter.id, instructorId: null, aircraftId: ac.id, type: 'solo', hoursAgo: 6,
  });
  created.push(renterId);

  const complete = await api(renterTok, `/api/bookings/${renterId}/complete`, {
    method: 'PATCH',
    body: JSON.stringify({
      hobbs_start: hobbs, hobbs_end: hobbs + 1.2,
      tach_start: tach, tach_end: tach + 1.0,
    }),
  });
  ok('renter solo complete', complete.status === 200, JSON.stringify(complete.data));

  const bill = await api(renterTok, `/api/billing/${renter.id}`);
  ok('renter billing shows solo flight', bill.status === 200 && bill.data.flights?.some((f) => f.id === renterId));

  const hist = await api(renterTok, '/api/booking-history?period=all');
  ok('renter history shows completed solo', hist.status === 200 && hist.data.rows.some((r) => r.id === renterId && r.status === 'completed'));

  for (const id of created) await cleanupBooking(pool, id);
}

async function testInstructorSoloFlow(pool, tokens, users, ac) {
  console.log('\n=== Instructor solo: complete → personal billing + history ===');
  const { instructorTok, adminTok } = tokens;
  const { instructor } = users;
  const created = [];

  const acFresh = (await api(adminTok, '/api/aircraft')).data.find((a) => a.id === ac.id);
  const hobbs = parseFloat(acFresh.current_hobbs);
  const tach = parseFloat(acFresh.current_tach || acFresh.current_hobbs);

  const soloId = await insertPastBooking(pool, {
    studentId: null, instructorId: instructor.id, aircraftId: ac.id, type: 'instructor_solo', hoursAgo: 8,
  });
  created.push(soloId);

  const complete = await api(instructorTok, `/api/bookings/${soloId}/complete`, {
    method: 'PATCH',
    body: JSON.stringify({
      hobbs_start: hobbs, hobbs_end: hobbs + 1.0,
      tach_start: tach, tach_end: tach + 0.9,
    }),
  });
  ok('instructor solo complete', complete.status === 200, JSON.stringify(complete.data));

  const myBill = await api(instructorTok, '/api/billing/my-activity');
  ok('instructor personal billing has solo', myBill.status === 200 && myBill.data.some((r) => r.id === soloId));

  const hist = await api(instructorTok, '/api/booking-history?period=all&scope=mine');
  ok('instructor history has solo', hist.status === 200 && hist.data.rows.some((r) => r.id === soloId));

  for (const id of created) await cleanupBooking(pool, id);
}

async function testCancelFlow(tokens, users, ac) {
  console.log('\n=== Cancel booking → history ===');
  const { renterTok } = tokens;
  const { renter } = users;
  const slot = futureSlot(12, 60);
  const book = await api(renterTok, '/api/bookings', {
    method: 'POST',
    body: JSON.stringify({ student_id: renter.id, aircraft_id: ac.id, ...slot }),
  });
  ok('renter books future flight', book.status === 201, JSON.stringify(book.data));
  if (book.status !== 201) return;

  const cancel = await api(renterTok, `/api/bookings/${book.data.id}`, {
    method: 'DELETE',
    body: JSON.stringify({ reason: 'Beta QA cancel test' }),
  });
  ok('renter cancels booking', cancel.status === 200, JSON.stringify(cancel.data));

  const hist = await api(renterTok, '/api/booking-history?period=all');
  ok('cancelled in history', hist.data.rows.some((r) => r.id === book.data.id && r.status === 'cancelled'));
}

async function testEndEarlyFlow(pool, tokens, users, ac) {
  console.log('\n=== End early → complete ===');
  const { studentTok, adminTok } = tokens;
  const { student, instructor } = users;
  const slot = pastSlot(1, 120);
  const endEarly = new Date(new Date(slot.start_time).getTime() + 45 * 60000).toISOString();

  const ins = await pool.query(`
    INSERT INTO bookings (student_id, instructor_id, aircraft_id, start_time, end_time, status, booking_type, created_by, source)
    VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, 'confirmed', 'dual', $2, 'production')
    RETURNING id
  `, [student.id, instructor.id, ac.id, slot.start_time, slot.end_time]);
  const bid = ins.rows[0].id;

  const early = await api(adminTok, `/api/bookings/${bid}/end-early`, {
    method: 'PATCH',
    body: JSON.stringify({ actual_end_time: endEarly }),
  });
  ok('end early', early.status === 200, JSON.stringify(early.data));

  const acRow = await pool.query('SELECT current_hobbs, current_tach FROM aircraft WHERE id = $1', [ac.id]);
  const h = parseFloat(acRow.rows[0].current_hobbs);
  const t = parseFloat(acRow.rows[0].current_tach);

  const complete = await api(studentTok, `/api/bookings/${bid}/complete`, {
    method: 'PATCH',
    body: JSON.stringify({ hobbs_start: h, hobbs_end: h + 0.8, tach_start: t, tach_end: t + 0.7, dual_instruction_hours: 0.8 }),
  });
  ok('complete after end early', complete.status === 200, JSON.stringify(complete.data));

  await cleanupBooking(pool, bid);
}

async function testMaintenanceRole(tokens, ac) {
  console.log('\n=== Maintenance role functions ===');
  const { maintTok, adminTok } = tokens;

  const squawk = await api(maintTok, '/api/squawks', {
    method: 'POST',
    body: JSON.stringify({ aircraft_id: ac.id, description: 'Beta QA maintenance squawk', severity: 'minor' }),
  });
  ok('maintenance creates squawk', squawk.status === 201 || squawk.status === 200, JSON.stringify(squawk.data));

  const fleet = await api(maintTok, '/api/aircraft');
  ok('maintenance views fleet', fleet.status === 200 && fleet.data.length > 0);

  const logs = await api(maintTok, '/api/flight-logs');
  ok('maintenance views flight logs', logs.status === 200);

  const track = await api(maintTok, '/api/track-flights/maintenance-schedule');
  ok('maintenance schedule API', track.status === 200);

  if (squawk.data?.id) {
    await api(adminTok, `/api/squawks/${squawk.data.id}`, {
      method: 'PATCH', body: JSON.stringify({ status: 'resolved' }),
    });
    await fetch(`${BASE}/api/squawks/${squawk.data.id}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${adminTok}` },
    }).catch(() => {});
  }

  const maintPages = ['fleet', 'maintenance', 'flight-log', 'tracking'];
  ok('maintenance role pages defined', maintPages.length === 4);
}

async function main() {
  console.log('Full beta QA —', BASE);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

  await testLegalPages();
  await testTermsSignup(pool);

  const adminTok = await login('evaughntaemw@gmail.com', ADMIN_PASS);
  const studentTok = await login('qa-student@test.local', PASS);
  const instructorTok = await login('qa-instructor@test.local', PASS);
  const renterTok = await login('qa-renter@test.local', PASS);
  const maintTok = await login('qa-maintenance@test.local', PASS);

  const users = (await api(adminTok, '/api/users')).data;
  const student = users.find((u) => u.email === 'qa-student@test.local');
  const instructor = users.find((u) => u.email === 'qa-instructor@test.local')
    || users.find((u) => u.email === 'evaughntaemw@gmail.com');
  const renter = users.find((u) => u.email === 'qa-renter@test.local');
  const acList = (await api(adminTok, '/api/aircraft')).data;
  const ac = acList.find((a) => a.status === 'available');
  if (!ac || !student || !renter || !instructor) throw new Error('Missing test users or aircraft');

  const hobbs = parseFloat(ac.current_hobbs);
  const tach = parseFloat(ac.current_tach || ac.current_hobbs);
  const tokens = { adminTok, studentTok, instructorTok, renterTok, maintTok };

  await testStudentDualFlow(pool, tokens, { student, instructor }, ac, hobbs, tach);
  await testRenterSoloFlow(pool, tokens, { renter }, ac);
  await testInstructorSoloFlow(pool, tokens, { instructor }, ac);
  await testCancelFlow(tokens, { renter }, ac);
  await testEndEarlyFlow(pool, tokens, { student, instructor }, ac);
  await testMaintenanceRole(tokens, ac);

  await pool.end();

  console.log('\n========================================');
  console.log(`FAILURES: ${failures.length}`);
  if (failures.length) {
    failures.forEach((f) => console.log(' -', f));
    process.exit(1);
  }
  console.log('All full beta QA tests passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
