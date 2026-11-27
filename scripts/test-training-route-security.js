'use strict';

const assert = require('assert');
const express = require('express');
const jwt = require('jsonwebtoken');
const path = require('path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://unused:unused@127.0.0.1:1/unused';

const mockPool = {
  query: async (sql, params = []) => {
    if (String(sql).includes('SELECT role FROM users WHERE id = $1 AND deleted_at IS NULL')) {
      return { rows: [{ role: params[0] === 301 ? 'admin' : 'student' }] };
    }
    if (String(sql).includes('FROM bookings b') && String(sql).includes('WHERE b.id = $1')) {
      return {
        rows: [{
          id: 1,
          student_id: 201,
          instructor_id: 202,
          aircraft_id: 1,
          tail_number: 'N123QA',
          make_model: 'Cessna 172',
        }],
      };
    }
    throw new Error('Database should not be reached for rejected security checks');
  },
  connect: async () => {
    throw new Error('Database should not be reached for rejected security checks');
  },
  on: () => {},
};

const dbPath = path.join(__dirname, '..', 'db', 'index.js');
const trainingDbPath = path.join(__dirname, '..', 'db', 'training.js');
require.cache[require.resolve(dbPath)] = { id: dbPath, filename: dbPath, loaded: true, exports: mockPool };
require.cache[require.resolve(trainingDbPath)] = { id: trainingDbPath, filename: trainingDbPath, loaded: true, exports: {} };

const trainingRoutes = require('../routes/training');
const usersRoutes = require('../routes/users');
const bookingCompletionRoutes = require('../routes/bookings-completion');

function tokenFor(user) {
  return jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '5m' });
}

async function request(baseUrl, method, url, token, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${url}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function main() {
  const app = express();
  app.use(express.json());
  app.use('/api/training', trainingRoutes);
  app.use('/api/admin/training', trainingRoutes);
  app.use('/api/users', usersRoutes);
  app.use('/api/bookings', bookingCompletionRoutes);

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  try {
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;
    const studentToken = tokenFor({ id: 101, role: 'student', is_instructor: false });
    const renterToken = tokenFor({ id: 102, role: 'renter', is_instructor: false });
    const adminToken = tokenFor({ id: 301, role: 'admin', is_instructor: false });

    const cases = [
      ['POST', '/api/admin/training/programs', null, { name: 'QA', code: 'QA' }, 401, 'admin program create requires auth'],
      ['POST', '/api/admin/training/programs', studentToken, { name: 'QA', code: 'QA' }, 403, 'students cannot create programs'],
      ['POST', '/api/training/student-progress', studentToken, { student_id: 101, maneuver_id: 1, status: 'proficient' }, 403, 'students cannot update progress'],
      ['GET', '/api/training/student-progress?student_id=999', studentToken, null, 403, 'students cannot read other student progress'],
      ['GET', '/api/training/students', studentToken, null, 403, 'students cannot list training students'],
      ['GET', '/api/training/students/999', studentToken, null, 403, 'students cannot read other student detail'],
      ['GET', '/api/training/students/999/debriefs', studentToken, null, 403, 'students cannot read other student debriefs'],
      ['GET', '/api/training/maneuver-progress/999/1', studentToken, null, 403, 'students cannot read other maneuver progress'],
      ['GET', '/api/training/checkride-readiness/999', renterToken, null, 403, 'non-training staff cannot read readiness'],
      ['GET', '/api/bookings/1', studentToken, null, 403, 'students cannot read another user booking detail'],
      ['PATCH', '/api/users/55/role', adminToken, { role: 'owner' }, 403, 'admins cannot grant owner role'],
    ];

    for (const [method, url, token, body, expected, label] of cases) {
      const res = await request(baseUrl, method, url, token, body);
      assert.strictEqual(res.status, expected, `${label}: expected ${expected}, got ${res.status}`);
      console.log(`OK ${label}`);
    }
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
