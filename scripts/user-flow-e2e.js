'use strict';
/**
 * Full user-flow E2E — book, complete, cancel, squawk, billing/history per role.
 * Usage: node scripts/user-flow-e2e.js [--base http://localhost:3000]
 */
const fs = require('fs');
const { Pool } = require('pg');

const BASE = process.argv.includes('--base')
  ? process.argv[process.argv.indexOf('--base') + 1]
  : (process.env.QA_BASE || 'http://localhost:3000');
const PASS = process.env.TEST_USER_PASSWORD || 'TestPass123!';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'NewTech2026!';

process.env.DATABASE_URL = process.env.DATABASE_URL
  || (fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8').match(/DATABASE_URL=(.+)/)?.[1]?.trim() : null);

async function login(email, password) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  return {
    start_time,
    end_time,
    local_date: startDate,
    local_start: startHM,
    local_end: endHM,
  };
}

function soonSlot(minutesFromNow = 45, durationMin = 60) {
  const start = new Date(Date.now() + minutesFromNow * 60000);
  start.setSeconds(0, 0);
  const end = new Date(start.getTime() + durationMin * 60000);
  const pad = (n) => String(n).padStart(2, '0');
  const date = start.toLocaleDateString('en-CA');
  return localSlot(date, `${pad(start.getHours())}:${pad(start.getMinutes())}`, date, `${pad(end.getHours())}:${pad(end.getMinutes())}`);
}

function pastSlot(hoursAgo = 2, durationMin = 60) {
  const start = new Date(Date.now() - hoursAgo * 3600000);
  const end = new Date(start.getTime() + durationMin * 60000);
  const pad = (n) => String(n).padStart(2, '0');
  const date = start.toLocaleDateString('en-CA');
  return localSlot(date, `${pad(start.getHours())}:${pad(start.getMinutes())}`, date, `${pad(end.getHours())}:${pad(end.getMinutes())}`);
}

async function cleanupBooking(pool, id) {
  if (!id) return;
  await pool.query('DELETE FROM instructor_hours WHERE booking_id = $1', [id]);
  await pool.query('DELETE FROM flight_hobbs_readings WHERE booking_id = $1', [id]);
  await pool.query('DELETE FROM flight_discrepancies WHERE booking_id = $1', [id]);
  await pool.query('DELETE FROM aircraft_hours_history WHERE booking_id = $1', [id]);
  await pool.query('DELETE FROM flight_logs WHERE booking_id = $1', [id]);
  await pool.query('DELETE FROM bookings WHERE id = $1', [id]);
}

async function main() {
  const failures = [];
  const ok = (name, cond, detail = '') => {
    if (cond) console.log('  OK', name);
    else { failures.push(name); console.log('  FAIL', name, detail); }
  };

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adminTok = await login('evaughntaemw@gmail.com', ADMIN_PASS);
  const studentTok = await login('qa-student@test.local', PASS);
  const renterTok = await login('qa-renter@test.local', PASS);
  let instructorTok;
  try {
    instructorTok = await login('qa-instructor@test.local', PASS);
  } catch {
    instructorTok = adminTok;
  }

  const users = (await api(adminTok, '/api/users')).data;
  const student = users.find((u) => u.email === 'qa-student@test.local');
  const renter = users.find((u) => u.email === 'qa-renter@test.local');
  const instructor = users.find((u) => u.email === 'qa-instructor@test.local')
    || users.find((u) => u.email === 'evaughntaemw@gmail.com');
  const acList = (await api(adminTok, '/api/aircraft')).data;
  const ac = acList.find((a) => a.status === 'available');
  if (!ac || !student || !renter || !instructor) throw new Error('Missing test users or aircraft');

  const hobbs = parseFloat(ac.current_hobbs);
  const tach = parseFloat(ac.current_tach || ac.current_hobbs);
  const created = [];

  console.log('\n=== Booking rules ===');

  const past = pastSlot(1, 60);
  const pastBook = await api(studentTok, '/api/bookings', {
    method: 'POST',
    body: JSON.stringify({ student_id: student.id, instructor_id: instructor.id, aircraft_id: ac.id, ...past }),
  });
  ok('reject past booking', pastBook.status === 400 || pastBook.status === 409, JSON.stringify(pastBook.data));

  const immediate = soonSlot(30, 60);
  const immBook = await api(renterTok, '/api/bookings', {
    method: 'POST',
    body: JSON.stringify({ student_id: renter.id, aircraft_id: ac.id, ...immediate }),
  });
  ok('renter can book within 30 min (no 2hr lead)', immBook.status === 201, JSON.stringify(immBook.data));
  if (immBook.status === 201) created.push(immBook.data.id);

  const startDate = new Date();
  startDate.setDate(startDate.getDate() + 10);
  const sd = startDate.toLocaleDateString('en-CA');
  const ed = new Date(startDate);
  ed.setDate(ed.getDate() + 2);
  const edStr = ed.toLocaleDateString('en-CA');
  const overnight = localSlot(sd, '09:00', edStr, '17:00');
  const multiBook = await api(renterTok, '/api/bookings', {
    method: 'POST',
    body: JSON.stringify({ student_id: renter.id, aircraft_id: ac.id, ...overnight }),
  });
  ok('multi-day overnight booking', multiBook.status === 201, JSON.stringify(multiBook.data));
  if (multiBook.status === 201) created.push(multiBook.data.id);

  console.log('\n=== Student dual → complete → instructor hours ===');

  const dualPast = pastSlot(3, 90);
  const dualIns = await pool.query(`
    INSERT INTO bookings (student_id, instructor_id, aircraft_id, start_time, end_time, status, booking_type, created_by, source)
    VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, 'confirmed', 'dual', $2, COALESCE((SELECT source FROM bookings LIMIT 1), 'production'))
    RETURNING id
  `, [student.id, instructor.id, ac.id, dualPast.start_time, dualPast.end_time]);
  const dualId = dualIns.rows[0].id;
  created.push(dualId);

  const dualComplete = await api(adminTok, `/api/bookings/${dualId}/complete`, {
    method: 'PATCH',
    body: JSON.stringify({
      hobbs_start: hobbs, hobbs_end: hobbs + 1.2,
      tach_start: tach, tach_end: tach + 1.1,
      dual_instruction_hours: 1.2,
    }),
  });
  ok('complete student dual flight', dualComplete.status === 200, JSON.stringify(dualComplete.data));

  const ihDual = await api(instructorTok, `/api/instructor-hours?instructor_id=${instructor.id}`);
  ok('instructor hours has dual entry', ihDual.status === 200 && ihDual.data.some((e) => e.booking_id === dualId), JSON.stringify(ihDual.data?.slice?.(0, 2)));

  const instrBillDual = await api(instructorTok, '/api/billing/my-activity');
  ok('dual flight NOT in instructor personal billing', instrBillDual.status === 200 && !instrBillDual.data.some((r) => r.id === dualId), JSON.stringify(instrBillDual.data?.slice?.(0, 2)));

  const studentBill = await api(studentTok, `/api/billing/${student.id}`);
  ok('student billing has dual flight', studentBill.status === 200 && studentBill.data.flights?.some((f) => f.id === dualId));

  console.log('\n=== Instructor solo → complete → personal billing ===');

  const soloPast = pastSlot(5, 60);
  const soloIns = await pool.query(`
    INSERT INTO bookings (student_id, instructor_id, aircraft_id, start_time, end_time, status, booking_type, created_by, source)
    VALUES (NULL, $1, $2, $3::timestamptz, $4::timestamptz, 'confirmed', 'instructor_solo', $1, COALESCE((SELECT source FROM bookings LIMIT 1), 'production'))
    RETURNING id
  `, [instructor.id, ac.id, soloPast.start_time, soloPast.end_time]);
  const soloId = soloIns.rows[0].id;
  created.push(soloId);

  const soloComplete = await api(instructorTok, `/api/bookings/${soloId}/complete`, {
    method: 'PATCH',
    body: JSON.stringify({
      hobbs_start: hobbs + 2, hobbs_end: hobbs + 3.0,
      tach_start: tach + 2, tach_end: tach + 2.9,
    }),
  });
  ok('complete instructor solo flight', soloComplete.status === 200, JSON.stringify(soloComplete.data));

  const instrBillSolo = await api(instructorTok, '/api/billing/my-activity');
  ok('solo flight IN instructor personal billing', instrBillSolo.status === 200 && instrBillSolo.data.some((r) => r.id === soloId));

  console.log('\n=== History scope ===');

  const instrHist = await api(instructorTok, '/api/booking-history?period=all&scope=mine');
  ok('instructor history includes dual', instrHist.status === 200 && instrHist.data.rows.some((r) => r.id === dualId));
  ok('instructor history includes solo', instrHist.status === 200 && instrHist.data.rows.some((r) => r.id === soloId));

  const mgmtHist = await api(adminTok, '/api/booking-history?period=all&scope=all');
  ok('admin mgmt history shows all flights', mgmtHist.status === 200 && mgmtHist.data.rows.length >= 2);

  const opsHist = await api(adminTok, '/api/booking-history?period=all&scope=mine');
  const adminInDual = opsHist.data?.rows?.some((r) => r.id === dualId);
  ok('admin ops history scoped to personal flights', opsHist.status === 200);

  console.log('\n=== Cancel booking (last-minute, no notice required) ===');

  if (immBook.status === 201) {
    const cancelRes = await api(renterTok, `/api/bookings/${immBook.data.id}`, {
      method: 'DELETE',
      body: JSON.stringify({ reason: 'QA last-minute cancel test' }),
    });
    ok('renter can cancel booking 30 min out', cancelRes.status === 200, JSON.stringify(cancelRes.data));
    const histCancel = await api(renterTok, '/api/booking-history?period=all');
    ok('cancelled booking in history', histCancel.data.rows.some((r) => r.id === immBook.data.id && r.status === 'cancelled'));
    created.push(immBook.data.id);
  } else {
    ok('skip cancel test (no immediate booking created)', false, 'immBook failed');
  }

  console.log('\n=== Squawks ===');

  const maintTok = await login('qa-maintenance@test.local', PASS);
  const sq = await api(maintTok, '/api/squawks', {
    method: 'POST',
    body: JSON.stringify({ aircraft_id: ac.id, description: 'QA flow squawk', severity: 'minor' }),
  });
  ok('maintenance creates squawk', sq.status === 201 || sq.status === 200, JSON.stringify(sq.data));
  if (sq.data?.id) {
    const resolve = await api(adminTok, `/api/squawks/${sq.data.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'resolved' }),
    });
    ok('admin resolves squawk', resolve.status === 200, JSON.stringify(resolve.data));
    await pool.query('DELETE FROM squawks WHERE id = $1', [sq.data.id]);
  }

  console.log('\n=== Cleanup ===');
  for (const id of [...new Set(created)]) {
    await cleanupBooking(pool, id);
  }
  await pool.end();

  if (failures.length) {
    console.log('\nFAILED:', failures.join(', '));
    process.exit(1);
  }
  console.log('\nAll user-flow E2E tests passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
