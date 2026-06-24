'use strict';

/**
 * Security regression checks for critical auth/authorization boundaries.
 * These tests use mocked database calls so they can run without local Postgres.
 */

const assert = require('assert');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'security-regression-secret';
process.env.CAPTCHA_ENABLED = 'false';
const JWT_SECRET = process.env.JWT_SECRET;

let queryHandler = async () => ({ rows: [], rowCount: 0 });

const fakePool = {
  query(sql, params) {
    return queryHandler(sql, params);
  },
  async connect() {
    return {
      query(sql, params) {
        return queryHandler(sql, params);
      },
      release() {},
    };
  },
};

const dbPath = require.resolve('../db/index');
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: fakePool,
};

function tokenFor(user) {
  return jwt.sign(user, JWT_SECRET, { expiresIn: '1h' });
}

async function withServer(routePath, mountPath, fn) {
  delete require.cache[require.resolve(routePath)];
  const router = require(routePath);
  const app = express();
  app.use(express.json());
  app.use(mountPath, router);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function testRejectedLoginBlocked() {
  const passwordHash = await bcrypt.hash('TestPass123!', 4);
  let reactivated = false;
  queryHandler = async (sql) => {
    if (sql.includes('SELECT id, email, name, password_hash, role, deleted_at, approval_status')) {
      return {
        rows: [{
          id: 7,
          email: 'rejected@test.local',
          name: 'Rejected User',
          password_hash: passwordHash,
          role: 'student',
          deleted_at: new Date(),
          approval_status: 'rejected',
          is_instructor: false,
        }],
      };
    }
    if (sql.includes('UPDATE users SET deleted_at = NULL')) reactivated = true;
    return { rows: [] };
  };

  await withServer('../routes/auth', '/api/auth', async (base) => {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'rejected@test.local', password: 'TestPass123!' }),
    });
    const body = await res.json();
    assert.strictEqual(res.status, 403);
    assert.strictEqual(body.error, 'account_rejected');
    assert.strictEqual(reactivated, false, 'rejected login must not clear deleted_at');
  });
}

async function testRejectedResetBlocked() {
  const rawToken = 'reset-token';
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  let passwordUpdated = false;
  queryHandler = async (sql, params) => {
    if (sql.includes('FROM password_reset_tokens')) {
      assert.strictEqual(params[0], tokenHash);
      return {
        rows: [{
          id: 11,
          user_id: 7,
          expires_at: new Date(Date.now() + 60000).toISOString(),
          email: 'rejected@test.local',
          name: 'Rejected User',
          deleted_at: new Date(),
          approval_status: 'rejected',
        }],
      };
    }
    if (sql.includes('UPDATE users SET password_hash')) passwordUpdated = true;
    return { rows: [] };
  };

  await withServer('../routes/auth', '/api/auth', async (base) => {
    const res = await fetch(`${base}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: rawToken, password: 'NewPass123!' }),
    });
    const body = await res.json();
    assert.strictEqual(res.status, 403);
    assert.match(body.error, /not eligible/i);
    assert.strictEqual(passwordUpdated, false, 'rejected reset must not update password');
  });
}

async function testTrainingAdminRequiresAuth() {
  queryHandler = async () => {
    throw new Error('database should not be reached before auth');
  };
  await withServer('../routes/training', '/api/training', async (base) => {
    const res = await fetch(`${base}/api/training/admin/programs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Exploit', code: 'XPL' }),
    });
    assert.strictEqual(res.status, 401);
  });
}

async function testTrainingStudentCannotForgeProgress() {
  queryHandler = async () => {
    throw new Error('database should not be reached for forbidden student progress write');
  };
  await withServer('../routes/training', '/api/training', async (base) => {
    const res = await fetch(`${base}/api/training/student-progress`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenFor({ id: 1, email: 'student@test.local', role: 'student' })}`,
      },
      body: JSON.stringify({ student_id: 2, maneuver_id: 3, status: 'proficient' }),
    });
    assert.strictEqual(res.status, 403);
  });
}

async function testTrainingAdminAliasWorksWithAuth() {
  queryHandler = async (sql, params) => {
    if (sql.includes('INSERT INTO training_programs')) {
      return { rows: [{ id: 101, name: params[0], code: String(params[1]).toUpperCase(), description: params[2] }] };
    }
    throw new Error(`unexpected query for admin training alias: ${sql}`);
  };
  await withServer('../routes/training', '/api/admin/training', async (base) => {
    const res = await fetch(`${base}/api/admin/training/programs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenFor({ id: 5, email: 'admin@test.local', role: 'admin' })}`,
      },
      body: JSON.stringify({ name: 'Alias Program', code: 'alias' }),
    });
    const body = await res.json();
    assert.strictEqual(res.status, 201);
    assert.strictEqual(body.code, 'ALIAS');
  });
}

async function testTrainingRenterCannotReadStudentDetail() {
  queryHandler = async () => {
    throw new Error('database should not be reached for forbidden training detail read');
  };
  await withServer('../routes/training', '/api/training', async (base) => {
    const res = await fetch(`${base}/api/training/students/2`, {
      headers: { Authorization: `Bearer ${tokenFor({ id: 9, email: 'renter@test.local', role: 'renter' })}` },
    });
    assert.strictEqual(res.status, 403);
  });
}

async function testBookingDetailIdorBlocked() {
  queryHandler = async (sql) => {
    if (sql.includes('FROM bookings b')) {
      return {
        rows: [{
          id: 55,
          student_id: 2,
          instructor_id: 3,
          aircraft_id: 4,
          status: 'confirmed',
          tail_number: 'N123QA',
        }],
      };
    }
    return { rows: [] };
  };

  await withServer('../routes/bookings-completion', '/api/bookings', async (base) => {
    const res = await fetch(`${base}/api/bookings/55`, {
      headers: { Authorization: `Bearer ${tokenFor({ id: 1, email: 'other@test.local', role: 'student' })}` },
    });
    assert.strictEqual(res.status, 403);
  });
}

async function testCompletionRejectsInflatedHobbs() {
  queryHandler = async (sql) => {
    if (sql.includes('SELECT id, role FROM users')) {
      return { rows: [{ id: 2, role: 'instructor' }] };
    }
    if (sql.includes('SELECT * FROM bookings WHERE id = $1')) {
      const start = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const end = new Date(Date.now() - 1 * 60 * 60 * 1000);
      return {
        rows: [{
          id: 66,
          student_id: 1,
          instructor_id: 2,
          aircraft_id: 4,
          status: 'confirmed',
          start_time: start.toISOString(),
          end_time: end.toISOString(),
          booking_type: 'dual',
          lesson_type: 'Dual Instruction',
        }],
      };
    }
    if (sql.includes('SELECT current_hobbs')) {
      return { rows: [{ current_hobbs: 100, current_tach: 90, total_hobbs_hours: 100, total_tach_hours: 90 }] };
    }
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    throw new Error(`unexpected query before Hobbs rejection: ${sql}`);
  };

  await withServer('../routes/bookings-completion', '/api/bookings', async (base) => {
    const res = await fetch(`${base}/api/bookings/66/complete`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenFor({ id: 2, email: 'cfi@test.local', role: 'instructor' })}`,
      },
      body: JSON.stringify({ hobbs_start: 100, hobbs_end: 105 }),
    });
    const body = await res.json();
    assert.strictEqual(res.status, 400);
    assert.match(body.error, /exceeds the scheduled booking duration/i);
  });
}

async function main() {
  const tests = [
    testRejectedLoginBlocked,
    testRejectedResetBlocked,
    testTrainingAdminRequiresAuth,
    testTrainingStudentCannotForgeProgress,
    testTrainingAdminAliasWorksWithAuth,
    testTrainingRenterCannotReadStudentDetail,
    testBookingDetailIdorBlocked,
    testCompletionRejectsInflatedHobbs,
  ];

  for (const test of tests) {
    await test();
    console.log(`OK ${test.name}`);
  }
  console.log('\nSecurity regression checks passed.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
