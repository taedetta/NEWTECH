'use strict';

/**
 * Critical user-flow smoke tests (API-level).
 */
const BASE = process.env.QA_BASE || 'http://localhost:3000';
const PASSWORD = process.env.TEST_USER_PASSWORD || 'TestPass123!';

const failures = [];

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${email}: ${data.error || res.status}`);
  return { token: data.token, user: data.user };
}

async function api(token, path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function ok(name, cond, detail = '') {
  if (cond) console.log(`  OK ${name}`);
  else { failures.push(name + (detail ? `: ${detail}` : '')); console.log(`  FAIL ${name}${detail ? `: ${detail}` : ''}`); }
}

async function main() {
  console.log('Flow tests:', BASE);

  const admin = await login('evaughntaemw@gmail.com', process.env.ADMIN_PASSWORD || 'NewTech2026!');
  ok('admin login', admin.user.role === 'admin');

  const aircraft = await api(admin.token, '/api/aircraft');
  ok('list aircraft', aircraft.status === 200 && Array.isArray(aircraft.data));
  const acId = aircraft.data[0]?.id;

  const users = await api(admin.token, '/api/users');
  ok('list users', users.status === 200 && Array.isArray(users.data));

  const student = users.data.find((u) => u.role === 'student');
  const instructor = users.data.find((u) => u.is_instructor || u.role === 'instructor');

  if (acId && student && instructor) {
    const start = new Date(Date.now() + 86400000);
    start.setHours(10, 0, 0, 0);
    const end = new Date(start.getTime() + 2 * 3600000);
    const booking = await api(admin.token, '/api/bookings', {
      method: 'POST',
      body: JSON.stringify({
        aircraft_id: acId,
        student_id: student.id,
        instructor_id: instructor.id,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        local_date: start.toISOString().slice(0, 10),
        local_start: '10:00',
        local_end: '12:00',
        booking_type: 'dual',
        lesson_type: 'Dual Instruction',
      }),
    });
    ok('create booking', booking.status === 201 || booking.status === 200, JSON.stringify(booking.data).slice(0, 100));
  } else {
    ok('create booking (skipped)', true, 'missing aircraft/student/instructor');
  }

  if (acId) {
    const squawk = await api(admin.token, '/api/squawks', {
      method: 'POST',
      body: JSON.stringify({ aircraft_id: acId, description: 'QA test squawk', severity: 'minor' }),
    });
    ok('create squawk', squawk.status === 201, JSON.stringify(squawk.data).slice(0, 80));
  }

  const avail = await api(admin.token, '/api/instructor-availability', {
    method: 'POST',
    body: JSON.stringify({ instructor_id: admin.user.id, day_of_week: 1, start_time: '09:00', end_time: '17:00' }),
  });
  ok('set availability', avail.status === 201 || avail.status === 200, JSON.stringify(avail.data).slice(0, 80));

  const stuLogin = await login('qa-student@test.local', PASSWORD);
  ok('student login', stuLogin.user.role === 'student');

  const stuBookings = await api(stuLogin.token, '/api/bookings');
  ok('student bookings', stuBookings.status === 200);

  const maint = await login('qa-maintenance@test.local', PASSWORD);
  ok('maintenance login', maint.user.role === 'maintenance');

  const renter = await login('qa-renter@test.local', PASSWORD);
  ok('renter login', renter.user.role === 'renter');

  console.log(`\nFlow failures: ${failures.length}`);
  if (failures.length) failures.forEach((f) => console.log(' ', f));
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
