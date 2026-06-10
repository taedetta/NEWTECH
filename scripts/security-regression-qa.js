'use strict';

/**
 * Focused security regression checks for high-impact authorization and booking races.
 * Usage: DATABASE_URL=... QA_BASE=http://localhost:3000 node scripts/security-regression-qa.js
 */

const fs = require('fs');
const { Pool } = require('pg');

const BASE = process.env.QA_BASE || 'http://localhost:3000';
const PASSWORD = process.env.TEST_USER_PASSWORD || 'TestPass123!';

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (fs.existsSync('.env')) {
    const match = fs.readFileSync('.env', 'utf8').match(/^DATABASE_URL=(.+)$/m);
    if (match) return match[1].trim();
  }
  throw new Error('DATABASE_URL is required');
}

const failures = [];

function ok(name, condition, detail = '') {
  if (condition) {
    console.log(`  OK ${name}`);
  } else {
    failures.push(name + (detail ? `: ${detail}` : ''));
    console.log(`  FAIL ${name}${detail ? `: ${detail}` : ''}`);
  }
}

async function login(email) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
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
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function futureSlot(daysOut = 30, hour = 9) {
  const start = new Date();
  start.setDate(start.getDate() + daysOut);
  start.setHours(hour, 0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60000);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    local_date: start.toLocaleDateString('en-CA'),
    local_start: `${pad(start.getHours())}:00`,
    local_end: `${pad(end.getHours())}:00`,
  };
}

async function main() {
  console.log('Security regression QA:', BASE);
  const pool = new Pool({ connectionString: loadDatabaseUrl(), ssl: false });
  const cleanup = [];

  try {
    const admin = await login('qa-admin@test.local');
    const instructor = await login('qa-instructor@test.local');
    const student = await login('qa-student@test.local');
    const renter = await login('qa-renter@test.local');

    const ac = (await pool.query("SELECT id FROM aircraft WHERE status = 'available' ORDER BY id LIMIT 1")).rows[0];
    const targetStudent = (await pool.query("SELECT id FROM users WHERE email = 'qa-student@test.local'")).rows[0];
    const targetRenter = (await pool.query("SELECT id FROM users WHERE email = 'qa-renter@test.local'")).rows[0];
    if (!ac || !targetStudent || !targetRenter) throw new Error('Missing QA aircraft/users');

    console.log('\n=== Authorization regressions ===');

    const grounding = await api(student.token, '/api/squawks', {
      method: 'POST',
      body: JSON.stringify({ aircraft_id: ac.id, description: 'QA blocked grounding', severity: 'grounding' }),
    });
    ok('student cannot ground aircraft', grounding.status === 403, JSON.stringify(grounding.data));

    const minor = await api(student.token, '/api/squawks', {
      method: 'POST',
      body: JSON.stringify({ aircraft_id: ac.id, description: 'QA allowed minor squawk', severity: 'minor' }),
    });
    ok('student can still report minor squawk', minor.status === 201, JSON.stringify(minor.data));
    if (minor.data?.id) cleanup.push(['squawks', minor.data.id]);

    const pendingEmail = `qa-security-${Date.now()}@test.local`;
    const reg = await fetch(`${BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'QA Security Pending',
        email: pendingEmail,
        password: PASSWORD,
        phone: '5404401172',
        role: 'maintenance',
        acceptedTerms: true,
        termsVersion: 'qa',
      }),
    });
    ok('created pending approval user', reg.status === 200, await reg.text());
    const pending = (await pool.query('SELECT id FROM users WHERE email = $1', [pendingEmail])).rows[0];
    if (pending) cleanup.push(['users', pending.id]);
    const instrApprove = pending ? await api(instructor.token, `/api/approvals/${pending.id}/approve`, { method: 'POST' }) : { status: 0, data: {} };
    ok('instructor cannot approve account', instrApprove.status === 403, JSON.stringify(instrApprove.data));

    const maneuver = (await pool.query('SELECT id FROM stage_maneuvers ORDER BY id LIMIT 1')).rows[0];
    if (maneuver) {
      const progress = await api(student.token, '/api/training/student-progress', {
        method: 'POST',
        body: JSON.stringify({ student_id: targetRenter.id, maneuver_id: maneuver.id, status: 'completed' }),
      });
      ok('student cannot update arbitrary training progress', progress.status === 403, JSON.stringify(progress.data));
    } else {
      console.log('  SKIP training progress auth (no stage_maneuvers rows)');
    }

    const enrollment = (await pool.query('SELECT id, current_stage_id FROM student_training ORDER BY id LIMIT 1')).rows[0];
    if (enrollment) {
      const stage = await api(student.token, `/api/training/enrollment/${enrollment.id}/stage`, {
        method: 'PUT',
        body: JSON.stringify({ current_stage_id: enrollment.current_stage_id }),
      });
      ok('student cannot update enrollment stage', stage.status === 403, JSON.stringify(stage.data));
    } else {
      console.log('  SKIP enrollment stage auth (no student_training rows)');
    }

    const debrief = await api(renter.token, '/api/training/debriefs', {
      method: 'POST',
      body: JSON.stringify({ student_id: targetStudent.id, notes: 'QA blocked debrief', flight_date: new Date().toISOString().slice(0, 10) }),
    });
    ok('renter cannot create debrief', debrief.status === 403, JSON.stringify(debrief.data));

    const unauthProgram = await api(null, '/api/training/admin/programs', {
      method: 'POST',
      body: JSON.stringify({ name: 'Blocked Program', code: `BLK${Date.now()}` }),
    });
    ok('training admin route requires auth', unauthProgram.status === 401, JSON.stringify(unauthProgram.data));

    console.log('\n=== Booking race regression ===');

    const slot = futureSlot(45, 11);
    const body = JSON.stringify({
      student_id: targetRenter.id,
      aircraft_id: ac.id,
      ...slot,
    });
    const [a, b] = await Promise.all([
      api(renter.token, '/api/bookings', { method: 'POST', body }),
      api(renter.token, '/api/bookings', { method: 'POST', body }),
    ]);
    const statuses = [a.status, b.status].sort();
    ok('concurrent duplicate booking creates exactly one conflict', statuses[0] === 201 && statuses[1] === 409, `statuses=${statuses.join(',')}`);
    for (const response of [a, b]) {
      if (response.data?.id) cleanup.push(['bookings', response.data.id]);
    }

    console.log('\n========================================');
    console.log(`FAILURES: ${failures.length}`);
    if (failures.length) {
      failures.forEach((failure) => console.log(' -', failure));
      process.exitCode = 1;
    } else {
      console.log('All security regression checks passed');
    }
  } finally {
    for (const [table, id] of cleanup.reverse()) {
      if (table === 'bookings') {
        await pool.query('DELETE FROM instructor_hours WHERE booking_id = $1', [id]).catch(() => {});
        await pool.query('DELETE FROM flight_hobbs_readings WHERE booking_id = $1', [id]).catch(() => {});
        await pool.query('DELETE FROM flight_discrepancies WHERE booking_id = $1', [id]).catch(() => {});
        await pool.query('DELETE FROM aircraft_hours_history WHERE booking_id = $1', [id]).catch(() => {});
        await pool.query('DELETE FROM flight_logs WHERE booking_id = $1', [id]).catch(() => {});
        await pool.query('DELETE FROM billing_entries WHERE booking_id = $1', [id]).catch(() => {});
        await pool.query('DELETE FROM bookings WHERE id = $1', [id]).catch(() => {});
      } else if (table === 'squawks') {
        await pool.query('DELETE FROM squawks WHERE id = $1', [id]).catch(() => {});
      } else if (table === 'users') {
        await pool.query('DELETE FROM users WHERE id = $1', [id]).catch(() => {});
      }
    }
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
