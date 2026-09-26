'use strict';

const assert = require('assert');
const http = require('http');
const path = require('path');

const root = path.join(__dirname, '..');

function modulePath(relPath) {
  return path.join(root, relPath);
}

function resetModule(relPath) {
  delete require.cache[require.resolve(modulePath(relPath))];
}

function mockModule(relPath, exports) {
  const filename = require.resolve(modulePath(relPath));
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
}

async function request(server, method, requestPath) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({ port, method, path: requestPath }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function testRequiredEmailsBypassPreferences() {
  resetModule('lib/notification-prefs.js');
  mockModule('db/notification-prefs.js', {
    getPrefs: async () => ({
      email_all_off: true,
      booking_confirmation: false,
      password_reset: false,
    }),
  });

  const sent = [];
  mockModule('email-templates.js', {
    sendEmail: async (...args) => {
      sent.push(args);
      return true;
    },
  });

  const prefs = require(modulePath('lib/notification-prefs.js'));

  assert.strictEqual(
    await prefs.shouldSendEmail(1, prefs.EMAIL_TYPES.password_reset),
    true,
    'password reset emails must bypass opt-out preferences'
  );
  assert.strictEqual(
    await prefs.shouldSendEmail(1, prefs.EMAIL_TYPES.booking_confirmation),
    false,
    'optional emails should still honor opt-out preferences'
  );

  assert.deepStrictEqual(
    prefs.appendUnsubscribeFooter('<p>Reset</p>', 'Reset text', 1, prefs.EMAIL_TYPES.password_reset),
    { html: '<p>Reset</p>', text: 'Reset text' },
    'required emails must not get unsubscribe footers'
  );

  const optionalTextOnly = prefs.appendUnsubscribeFooter(null, 'Body', 1, prefs.EMAIL_TYPES.endorsement_expiry);
  assert.strictEqual(optionalTextOnly.html, null, 'text-only optional emails should stay text-only');
  assert.match(optionalTextOnly.text, /Unsubscribe from Endorsement expiry alerts/);

  await prefs.sendEmailToUser(1, 'student@example.com', prefs.EMAIL_TYPES.password_reset, 'Reset', '<p>Reset</p>', 'Reset text');
  await prefs.sendEmailToUser(1, 'student@example.com', prefs.EMAIL_TYPES.booking_confirmation, 'Booking', '<p>Booking</p>', 'Booking text');
  assert.strictEqual(sent.length, 1, 'only the required email should be delivered when all optional email is off');
  assert.strictEqual(sent[0][1], 'Reset');
  assert.doesNotMatch(sent[0][3], /Unsubscribe/);
  assert.doesNotMatch(sent[0][4], /Unsubscribe/);
}

async function testPreferenceUpdatesIgnoreRequiredColumns() {
  resetModule('db/notification-prefs.js');

  let updateSql = '';
  mockModule('db/index.js', {
    query: async (sql) => {
      if (/UPDATE user_email_preferences SET/.test(sql)) updateSql = sql;
      if (/SELECT \* FROM user_email_preferences/.test(sql)) {
        return { rows: [{ email_all_off: true, booking_confirmation: true, password_reset: false }] };
      }
      return { rows: [] };
    },
  });

  const dbPrefs = require(modulePath('db/notification-prefs.js'));
  const updated = await dbPrefs.updatePrefs(42, {
    email_all_off: true,
    password_reset: false,
    account_approved: false,
  });

  assert.match(updateSql, /email_all_off/);
  assert.doesNotMatch(updateSql, /password_reset/);
  assert.doesNotMatch(updateSql, /account_approved/);
  assert.strictEqual(updated.password_reset, undefined, 'required columns should not be exposed as preferences');
}

async function testUnsubscribeRouteRequiresPostAndBoundType() {
  resetModule('routes/email-unsubscribe.js');
  resetModule('lib/unsubscribe-token.js');

  const calls = [];
  mockModule('db/notification-prefs.js', {
    ensureDefaultPrefs: async (userId) => {
      calls.push({ op: 'ensure', userId });
    },
    updatePrefs: async (userId, patch) => {
      calls.push({ op: 'update', userId, patch });
      return patch;
    },
  });

  const express = require('express');
  const { signUnsubscribeToken } = require(modulePath('lib/unsubscribe-token.js'));
  const route = require(modulePath('routes/email-unsubscribe.js'));
  const app = express();
  app.use('/api/email', route);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });

  try {
    const bookingToken = signUnsubscribeToken(7, 'booking_confirmation');
    const bookingPath = `/api/email/unsubscribe?token=${encodeURIComponent(bookingToken)}&type=booking_confirmation`;
    const getResult = await request(server, 'GET', bookingPath);
    assert.strictEqual(getResult.status, 200);
    assert.match(getResult.body, /Confirm unsubscribe/);
    assert.deepStrictEqual(calls, [], 'GET must not mutate preferences');

    const tamperedResult = await request(server, 'POST', `/api/email/unsubscribe?token=${encodeURIComponent(bookingToken)}&type=all`);
    assert.strictEqual(tamperedResult.status, 400, 'query type must match signed token type');
    assert.deepStrictEqual(calls, [], 'tampered unsubscribe links must not mutate preferences');

    const requiredToken = signUnsubscribeToken(7, 'password_reset');
    const requiredResult = await request(server, 'POST', `/api/email/unsubscribe?token=${encodeURIComponent(requiredToken)}&type=password_reset`);
    assert.strictEqual(requiredResult.status, 400, 'required email types are not unsubscribe targets');
    assert.deepStrictEqual(calls, [], 'required email unsubscribe attempts must not mutate preferences');

    const postResult = await request(server, 'POST', bookingPath);
    assert.strictEqual(postResult.status, 200);
    assert.deepStrictEqual(calls, [
      { op: 'ensure', userId: 7 },
      { op: 'update', userId: 7, patch: { booking_confirmation: false } },
    ]);

    calls.length = 0;
    const allToken = signUnsubscribeToken(7, 'all');
    const allResult = await request(server, 'POST', `/api/email/unsubscribe?token=${encodeURIComponent(allToken)}&type=all`);
    assert.strictEqual(allResult.status, 200);
    assert.deepStrictEqual(calls, [
      { op: 'ensure', userId: 7 },
      { op: 'update', userId: 7, patch: { email_all_off: true } },
    ]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
  await testRequiredEmailsBypassPreferences();
  await testPreferenceUpdatesIgnoreRequiredColumns();
  await testUnsubscribeRouteRequiresPostAndBoundType();
  console.log('critical bug regressions passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
