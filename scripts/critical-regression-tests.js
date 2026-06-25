'use strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'critical-regression-secret';

const assert = require('assert');
const express = require('express');
const jwt = require('jsonwebtoken');

const pool = {};
const dbPath = require.resolve('../db/index');
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: pool,
};

const { requirePermission } = require('../middleware/auth');
const trainingRoutes = require('../routes/training');
const bookingsRoutes = require('../routes/bookings-routes');
const bookingCompletionRoutes = require('../routes/bookings-completion');
const aircraftRoutes = require('../routes/aircraft');

const JWT_SECRET = process.env.JWT_SECRET;

const users = new Map([
  [1, { id: 1, email: 'admin@test.local', name: 'Admin', role: 'admin', is_instructor: true, approval_status: 'approved', deleted_at: null }],
  [2, { id: 2, email: 'student@test.local', name: 'Student', role: 'student', is_instructor: false, approval_status: 'approved', deleted_at: null }],
  [3, { id: 3, email: 'maintenance@test.local', name: 'Maintenance', role: 'maintenance', is_instructor: false, approval_status: 'approved', deleted_at: null }],
  [4, { id: 4, email: 'instructor@test.local', name: 'Instructor', role: 'instructor', is_instructor: true, approval_status: 'approved', deleted_at: null }],
]);

const otherBooking = {
  id: 99,
  student_id: 20,
  instructor_id: 30,
  aircraft_id: 10,
  status: 'confirmed',
  start_time: new Date(Date.now() + 3600000).toISOString(),
  end_time: new Date(Date.now() + 7200000).toISOString(),
  lesson_type: 'Dual',
  tail_number: 'N123QA',
  make_model: 'Cessna 172',
};

const completedStudentBooking = {
  ...otherBooking,
  id: 100,
  student_id: 2,
  instructor_id: 4,
  status: 'completed',
  hobbs_start: 10,
  hobbs_end: 11,
  tach_start: 20,
  tach_end: 21,
};

function tokenFor(id) {
  const user = users.get(id);
  return jwt.sign({ id: user.id, email: user.email, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: '1h' });
}

function makeResult(rows) {
  return { rows, rowCount: rows.length };
}

function installPoolMock() {
  pool.query = async (sql, params = []) => {
    const text = String(sql);
    if (text.includes('FROM users') && text.includes('WHERE id = $1')) {
      const user = users.get(Number(params[0]));
      return makeResult(user ? [user] : []);
    }
    if (text.includes('FROM bookings b') && text.includes('WHERE b.id = $1')) {
      return makeResult(Number(params[0]) === otherBooking.id ? [otherBooking] : []);
    }
    return makeResult([]);
  };

  pool.connect = async () => ({
    query: async (sql, params = []) => {
      const text = String(sql);
      if (text.startsWith('SELECT * FROM bookings WHERE id = $1')) {
        if (Number(params[0]) === completedStudentBooking.id) return makeResult([completedStudentBooking]);
        if (Number(params[0]) === otherBooking.id) return makeResult([otherBooking]);
        return makeResult([]);
      }
      if (text === 'ROLLBACK' || text === 'BEGIN' || text === 'COMMIT') return makeResult([]);
      return makeResult([]);
    },
    release() {},
  });
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/training', trainingRoutes);
  app.use('/api/bookings', bookingsRoutes);
  app.use('/api/bookings', bookingCompletionRoutes);
  app.use('/api/aircraft', aircraftRoutes);
  return app;
}

async function request(server, method, path, { token, body } = {}) {
  const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function testRequirePermission() {
  let nextCalled = false;
  await requirePermission('can_edit_website')(
    { user: { id: 3, role: 'maintenance' } },
    { status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; } },
    () => { nextCalled = true; }
  );
  assert.strictEqual(nextCalled, false, 'maintenance must not bypass can_edit_website');

  nextCalled = false;
  await requirePermission('can_manage_aircraft')(
    { user: { id: 3, role: 'maintenance' } },
    { status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; } },
    () => { nextCalled = true; }
  );
  assert.strictEqual(nextCalled, true, 'maintenance should keep aircraft-management permission');
}

async function main() {
  installPoolMock();
  await testRequirePermission();

  const app = makeApp();
  const server = app.listen(0);
  try {
    let res = await request(server, 'POST', '/api/training/admin/programs', { body: { name: 'PPL', code: 'PPL' } });
    assert.strictEqual(res.status, 401, 'training admin routes must require authentication');

    res = await request(server, 'POST', '/api/training/student-progress', {
      token: tokenFor(2),
      body: { student_id: 20, maneuver_id: 5, status: 'completed' },
    });
    assert.strictEqual(res.status, 403, 'students must not mutate training progress');

    res = await request(server, 'GET', `/api/bookings/${otherBooking.id}`, { token: tokenFor(2) });
    assert.strictEqual(res.status, 403, 'students must not read arbitrary booking details');

    res = await request(server, 'PUT', `/api/bookings/${completedStudentBooking.id}`, {
      token: tokenFor(2),
      body: { lesson_type: 'discovery flight' },
    });
    assert.strictEqual(res.status, 403, 'students must not edit completed booking billing metadata');

    const originalConsoleError = console.error;
    console.error = () => {};
    try {
      res = await request(server, 'PATCH', '/api/aircraft/10/hobbs', {
        token: tokenFor(3),
        body: { hobbs: '-1' },
      });
    } finally {
      console.error = originalConsoleError;
    }
    assert.strictEqual(res.status, 400, 'negative aircraft Hobbs values must be rejected');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('Critical regression tests passed.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
