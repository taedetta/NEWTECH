'use strict';

/**
 * Regression coverage for training-program admin route auth/path wiring.
 * These requests should be rejected before any database query is attempted.
 */
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:1/flightslate';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'training-admin-auth-test-secret';

const assert = require('assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

const fakePool = {
  query: async () => {
    throw new Error('Unexpected database query in auth/path regression');
  },
  connect: async () => {
    throw new Error('Unexpected database connection in auth/path regression');
  },
};
require.cache[require.resolve('../db/index')] = {
  id: require.resolve('../db/index'),
  filename: require.resolve('../db/index'),
  loaded: true,
  exports: fakePool,
};

const trainingRoutes = require('../routes/training');

const JWT_SECRET = process.env.JWT_SECRET;

async function request(base, path, opts = {}) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: JSON.stringify({ name: 'Regression Program', code: 'REG' }),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function main() {
  const app = express();
  app.use(express.json());
  app.use('/api/training', trainingRoutes);
  app.use('/api/admin/training', trainingRoutes);

  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const studentToken = jwt.sign(
    { id: 123, email: 'student@example.test', role: 'student', name: 'Student Test' },
    JWT_SECRET,
    { expiresIn: '5m' }
  );

  try {
    const paths = [
      '/api/admin/training/programs',
      '/api/training/admin/programs',
    ];

    for (const path of paths) {
      const unauth = await request(base, path);
      assert.equal(unauth.status, 401, `${path} should require authentication`);
      assert.equal(unauth.data.error, 'Authentication required');

      const forbidden = await request(base, path, {
        headers: { Authorization: `Bearer ${studentToken}` },
      });
      assert.equal(forbidden.status, 403, `${path} should reject non-admin roles`);
      assert.equal(forbidden.data.error, 'Insufficient permissions');
    }

    console.log('Training admin auth/path regression passed');
  } finally {
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
