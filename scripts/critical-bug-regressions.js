'use strict';

const assert = require('assert');
const http = require('http');
const Module = require('module');
const express = require('express');

const dbIndexPath = require.resolve('../db/index');
const fakeDb = {
  query: async () => {
    throw new Error('Unexpected database access in critical regression test');
  },
  connect: async () => {
    throw new Error('Unexpected database access in critical regression test');
  },
};
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  const resolved = Module._resolveFilename(request, parent, isMain);
  if (resolved === dbIndexPath) return fakeDb;
  return originalLoad.apply(this, arguments);
};

const {
  EMAIL_TYPES,
  REQUIRED_EMAIL_TYPES,
  isRequiredEmailType,
} = require('../lib/email-types');
const {
  buildUnsubscribeUrl,
  verifyUnsubscribeToken,
  normalizeUnsubscribeType,
} = require('../lib/unsubscribe-token');
const {
  appendUnsubscribeFooter,
  getPreferenceCatalog,
  shouldSendEmail,
} = require('../lib/notification-prefs');
const {
  rowToPrefs,
  WRITABLE_PREF_COLUMNS,
} = require('../db/notification-prefs');
const emailUnsubscribeRouter = require('../routes/email-unsubscribe');
const {
  canAccessBooking,
  shouldRunUpdateConflictCheck,
} = require('../routes/bookings-routes');

async function request(server, path) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

async function withServer(app, fn) {
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
    s.on('error', reject);
  });
  try {
    await fn(server);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function testUnsubscribeTokenBindingAndGetConfirmation() {
  const url = new URL(buildUnsubscribeUrl(123, EMAIL_TYPES.booking_confirmation));
  const token = url.searchParams.get('token');

  assert.deepStrictEqual(verifyUnsubscribeToken(token), {
    userId: 123,
    type: EMAIL_TYPES.booking_confirmation,
  });
  assert.strictEqual(normalizeUnsubscribeType(EMAIL_TYPES.password_reset), null);

  const app = express();
  app.use('/api/email', emailUnsubscribeRouter);
  await withServer(app, async (server) => {
    const ok = await request(server, `/api/email/unsubscribe?token=${encodeURIComponent(token)}&type=${EMAIL_TYPES.booking_confirmation}`);
    assert.strictEqual(ok.status, 200);
    assert.match(ok.body, /Confirm unsubscribe/);
    assert.match(ok.body, /method="post"/);

    const tampered = await request(server, `/api/email/unsubscribe?token=${encodeURIComponent(token)}&type=all`);
    assert.strictEqual(tampered.status, 400);
    assert.doesNotMatch(tampered.body, /Confirm unsubscribe/);
  });
}

function testRequiredEmailProtection() {
  for (const type of REQUIRED_EMAIL_TYPES) {
    assert.strictEqual(isRequiredEmailType(type), true);
    assert.strictEqual(normalizeUnsubscribeType(type), null);
    assert.strictEqual(WRITABLE_PREF_COLUMNS.includes(type), false);
  }

  const prefs = rowToPrefs({
    email_all_off: true,
    password_reset: false,
    account_approved: false,
    profile_change: false,
  });
  assert.strictEqual(prefs.password_reset, true);
  assert.strictEqual(prefs.account_approved, true);
  assert.strictEqual(prefs.profile_change, true);

  const catalog = getPreferenceCatalog('student', false);
  const visibleTypes = new Set(catalog.flatMap((category) => category.types.map((type) => type.key)));
  for (const type of REQUIRED_EMAIL_TYPES) {
    assert.strictEqual(visibleTypes.has(type), false);
  }
}

async function testRequiredEmailsBypassPrefsWithoutFooter() {
  assert.strictEqual(await shouldSendEmail(456, EMAIL_TYPES.password_reset), true);
  const required = appendUnsubscribeFooter('<p>Reset</p>', 'Reset', 456, EMAIL_TYPES.password_reset);
  assert.deepStrictEqual(required, { html: '<p>Reset</p>', text: 'Reset' });
}

function testTextOnlyOptionalFooter() {
  const result = appendUnsubscribeFooter(null, 'Body', 456, EMAIL_TYPES.endorsement_expiry);
  assert.strictEqual(result.html, null);
  assert.match(result.text, /Unsubscribe from Endorsement expiry alerts/);
}

function testBookingConflictDecisions() {
  assert.strictEqual(canAccessBooking({ id: 99, role: 'maintenance' }, {
    student_id: 1,
    instructor_id: 2,
  }), false);
  assert.strictEqual(canAccessBooking({ id: 1, role: 'student' }, {
    student_id: 1,
    instructor_id: 2,
  }), true);
  assert.strictEqual(shouldRunUpdateConflictCheck({
    scheduleChanged: true,
    statusChanged: false,
    nextStatus: 'confirmed',
  }), true);
  assert.strictEqual(shouldRunUpdateConflictCheck({
    scheduleChanged: false,
    statusChanged: true,
    nextStatus: 'confirmed',
  }), true);
  assert.strictEqual(shouldRunUpdateConflictCheck({
    scheduleChanged: true,
    statusChanged: false,
    nextStatus: 'completed',
  }), false);
  assert.strictEqual(shouldRunUpdateConflictCheck({
    scheduleChanged: false,
    statusChanged: false,
    nextStatus: 'confirmed',
  }), false);
}

(async () => {
  await testUnsubscribeTokenBindingAndGetConfirmation();
  testRequiredEmailProtection();
  await testRequiredEmailsBypassPrefsWithoutFooter();
  testTextOnlyOptionalFooter();
  testBookingConflictDecisions();
  console.log('critical bug regression checks passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
