'use strict';

/**
 * Focused regression tests for training route authorization and admin route mounts.
 * This uses mocked DB/auth dependencies, so it does not touch live or staging data.
 */

const assert = require('assert');
const express = require('express');
const http = require('http');
const Module = require('module');
const path = require('path');

const root = path.join(__dirname, '..');
const trainingRoutePath = path.join(root, 'routes', 'training.js');

const queryLog = [];
const mockClient = {
  async query(sql) {
    queryLog.push(String(sql));
    return { rows: [{ id: 1 }], rowCount: 1 };
  },
  release() {},
};

const mockPool = {
  async query(sql, params = []) {
    queryLog.push(String(sql));
    const text = String(sql);
    if (text.includes('FROM training_programs') && text.includes('ORDER BY id')) {
      return { rows: [{ id: 1, code: 'PPL', name: 'Private Pilot' }] };
    }
    if (text.includes('FROM program_stages') && text.includes('ORDER BY program_id')) {
      return { rows: [{ id: 10, program_id: 1, name: 'Stage 1', order_index: 1 }] };
    }
    if (text.includes('FROM stage_maneuvers') && text.includes('ORDER BY stage_id')) {
      return { rows: [{ id: 100, stage_id: 10, name: 'Straight and Level', order_index: 1 }] };
    }
    if (text.includes('FROM student_maneuver_progress')) {
      return { rows: [] };
    }
    if (text.includes('INSERT INTO student_maneuver_progress')) {
      return { rows: [{ student_id: params[0], maneuver_id: params[1], status: params[2] }] };
    }
    if (text.includes('UPDATE student_training SET current_stage_id')) {
      return { rows: [{ id: params[1], current_stage_id: params[0] }] };
    }
    if (text.includes('INSERT INTO training_programs')) {
      return { rows: [{ id: 2, name: params[0], code: String(params[1]).toUpperCase() }] };
    }
    if (text.includes('SELECT COALESCE(MAX(order_index)')) {
      return { rows: [{ next_idx: 1 }] };
    }
    if (text.includes('INSERT INTO program_stages')) {
      return { rows: [{ id: 11, program_id: params[0], name: params[1], order_index: params[3] }] };
    }
    if (text.startsWith('SELECT id, name, email, phone_number FROM users')) {
      return { rows: [{ id: params[0], name: 'QA Student', email: 'student@example.test', phone_number: '(555) 555-5555' }] };
    }
    if (text.includes('FROM student_training st') && text.includes('WHERE st.student_id = $1')) {
      return { rows: [] };
    }
    if (text.includes('FROM flight_debriefs fd')) {
      return { rows: [] };
    }
    if (text.includes('SELECT id FROM training_programs WHERE code')) {
      return { rows: [{ id: 1 }] };
    }
    return { rows: [] };
  },
  async connect() {
    return mockClient;
  },
};

const mockTrainingDb = {
  async getProgramEnrollments() { return []; },
  async getStudentProgress() { return { enrollments: [], debriefs: [] }; },
  async getManeuverProgress() { return []; },
  async upsertManeuverProgress(studentId, maneuverId, status) {
    return { student_id: studentId, maneuver_id: maneuverId, status };
  },
  async getStudentFlightHours() { return { total_hobbs_hours: 0, total_tach_hours: 0 }; },
  async createDebrief() { return { id: 1 }; },
  async completeStageMilestone() { return { ok: true }; },
  async enrollStudent() { return { id: 1 }; },
  async reassignInstructor() { return { id: 1 }; },
};

const mockAuth = {
  authenticateToken(req, res, next) {
    const role = req.get('x-test-role');
    if (!role) return res.status(401).json({ error: 'Authentication required' });
    req.user = {
      id: Number(req.get('x-test-user-id') || 1),
      email: `${role}@example.test`,
      name: `QA ${role}`,
      role,
    };
    next();
  },
  requireRole(...roles) {
    return (req, res, next) => {
      if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Insufficient permissions' });
      next();
    };
  },
};

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (parent?.filename === trainingRoutePath && request === '../db/index') return mockPool;
  if (parent?.filename === trainingRoutePath && request === '../db/training') return mockTrainingDb;
  if (parent?.filename === trainingRoutePath && request === '../middleware/auth') return mockAuth;
  return originalLoad.call(this, request, parent, isMain);
};

delete require.cache[trainingRoutePath];
const trainingRouter = require(trainingRoutePath);
Module._load = originalLoad;

const app = express();
app.use(express.json());
app.use('/api/training', trainingRouter);
app.use('/api/admin/training', trainingRouter);

function listen(appToListen) {
  const server = http.createServer(appToListen);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function request(base, method, url, { role, userId = 1, body } = {}) {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: {
      ...(role ? { 'x-test-role': role, 'x-test-user-id': String(userId) } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function main() {
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.strictEqual((await request(base, 'GET', '/api/training/students', { role: 'student' })).status, 403);
    assert.strictEqual((await request(base, 'GET', '/api/training/students/2', { role: 'student', userId: 1 })).status, 403);
    assert.strictEqual((await request(base, 'GET', '/api/training/students/1', { role: 'student', userId: 1 })).status, 200);
    assert.strictEqual((await request(base, 'GET', '/api/training/students/2/debriefs', { role: 'student', userId: 1 })).status, 403);
    assert.strictEqual((await request(base, 'GET', '/api/training/program-enrollments', { role: 'renter' })).status, 403);
    assert.strictEqual((await request(base, 'GET', '/api/training/checkride-readiness/1', { role: 'renter', userId: 1 })).status, 403);
    assert.strictEqual((await request(base, 'GET', '/api/training/maneuver-progress/2/10', { role: 'renter', userId: 1 })).status, 403);
    assert.strictEqual((await request(base, 'GET', '/api/training/cohort-stats/PPL', { role: 'renter' })).status, 403);
    assert.strictEqual((await request(base, 'POST', '/api/training/student-progress', {
      role: 'student',
      body: { student_id: 1, maneuver_id: 100, status: 'proficient' },
    })).status, 403);
    assert.strictEqual((await request(base, 'POST', '/api/training/student-progress', {
      role: 'instructor',
      body: { student_id: 1, maneuver_id: 100, status: 'proficient' },
    })).status, 200);
    assert.strictEqual((await request(base, 'POST', '/api/training/debriefs', {
      role: 'renter',
      body: { student_id: 1, notes: 'not allowed' },
    })).status, 403);
    assert.strictEqual((await request(base, 'POST', '/api/training/milestones', {
      role: 'renter',
      body: { student_id: 1, stage_id: 10, enrollment_id: 99 },
    })).status, 403);

    assert.strictEqual((await request(base, 'POST', '/api/admin/training/programs', {
      body: { name: 'No Auth', code: 'NOAUTH' },
    })).status, 401);
    assert.strictEqual((await request(base, 'POST', '/api/admin/training/programs', {
      role: 'admin',
      body: { name: 'Commercial Pilot', code: 'CPL' },
    })).status, 201);
    assert.strictEqual((await request(base, 'POST', '/api/training/admin/programs', {
      role: 'admin',
      body: { name: 'Instrument Rating', code: 'IFR' },
    })).status, 201);
    assert.strictEqual((await request(base, 'POST', '/api/admin/training/stages', {
      role: 'admin',
      body: { program_id: 1, name: 'Stage 2' },
    })).status, 201);
    assert.strictEqual((await request(base, 'PUT', '/api/admin/training/stages/reorder', {
      role: 'admin',
      body: { stages: [{ id: 10, order_index: 1 }] },
    })).status, 200);

    console.log('Training auth regression tests passed.');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
