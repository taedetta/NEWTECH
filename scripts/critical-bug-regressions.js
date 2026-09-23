'use strict';

const assert = require('assert');
const http = require('http');
const path = require('path');

process.env.JWT_SECRET = 'critical-bug-regression-secret';

const ROOT = path.join(__dirname, '..');

function resolveModule(relPath) {
  return require.resolve(path.join(ROOT, relPath));
}

function clearModule(relPath) {
  delete require.cache[resolveModule(relPath)];
}

function setMock(relPath, exports) {
  const filename = resolveModule(relPath);
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
}

async function request(app, method, urlPath) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    return await new Promise((resolve, reject) => {
      const req = http.request(
        { method, hostname: '127.0.0.1', port, path: urlPath },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => { body += chunk; });
          res.on('end', () => resolve({ status: res.statusCode, body }));
        }
      );
      req.on('error', reject);
      req.end();
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function testUnsubscribeTokensAndRequiredEmails() {
  clearModule('lib/unsubscribe-token.js');
  const jwt = require('jsonwebtoken');
  const { signUnsubscribeToken, verifyUnsubscribeToken, buildUnsubscribeUrl } = require('../lib/unsubscribe-token');

  const token = signUnsubscribeToken(42, 'booking_cancelled');
  assert.deepStrictEqual(verifyUnsubscribeToken(token), { userId: 42, type: 'booking_cancelled' });

  const url = new URL(buildUnsubscribeUrl(42, 'preflight_reminder'));
  assert.strictEqual(url.searchParams.get('type'), 'preflight_reminder');
  assert.strictEqual(verifyUnsubscribeToken(url.searchParams.get('token')).type, 'preflight_reminder');

  const legacyUnboundToken = jwt.sign({ uid: 42, aud: 'email-unsub' }, process.env.JWT_SECRET);
  assert.strictEqual(verifyUnsubscribeToken(legacyUnboundToken), null);

  const dbPath = 'db/notification-prefs.js';
  const notificationPath = 'lib/notification-prefs.js';
  clearModule(notificationPath);
  setMock(dbPath, {
    getPrefs: async () => ({
      email_all_off: true,
      booking_cancelled: false,
      password_reset: false,
      profile_change: false,
    }),
  });
  const prefs = require('../lib/notification-prefs');
  assert.strictEqual(await prefs.shouldSendEmail(42, 'password_reset'), true);
  assert.strictEqual(await prefs.shouldSendEmail(42, 'profile_change'), true);
  assert.strictEqual(await prefs.shouldSendEmail(42, 'booking_cancelled'), false);

  const withFooter = prefs.appendUnsubscribeFooter('<html><body>Hello</body></html>', 'Hello', 42, 'booking_cancelled');
  assert.match(withFooter.html, /Unsubscribe from this type/);
  const textOnly = prefs.appendUnsubscribeFooter(null, 'Text only', 42, 'endorsement_expiry');
  assert.strictEqual(textOnly.html, null);
  assert.match(textOnly.text, /Unsubscribe from Endorsement expiry alerts/);
  const required = prefs.appendUnsubscribeFooter('<html><body>Hello</body></html>', 'Hello', 42, 'password_reset');
  assert.strictEqual(required.html, '<html><body>Hello</body></html>');
  assert.strictEqual(required.text, 'Hello');

  const visibleTypes = prefs.getPreferenceCatalog('student', false).flatMap((category) => category.types.map((t) => t.key));
  assert.ok(!visibleTypes.includes('password_reset'));
  assert.ok(!visibleTypes.includes('profile_change'));
}

async function testUnsubscribeRouteRequiresPostAndRejectsTampering() {
  const express = require('express');
  const updates = [];
  const ensured = [];

  clearModule('routes/email-unsubscribe.js');
  clearModule('lib/unsubscribe-token.js');
  setMock('lib/app-url.js', { getAppUrl: () => 'https://example.test' });
  setMock('db/notification-prefs.js', {
    ensureDefaultPrefs: async (userId) => { ensured.push(userId); },
    updatePrefs: async (userId, patch) => {
      updates.push({ userId, patch });
      return patch;
    },
  });

  const { signUnsubscribeToken } = require('../lib/unsubscribe-token');
  const route = require('../routes/email-unsubscribe');
  const app = express();
  app.use('/api/email', route);

  const token = signUnsubscribeToken(7, 'booking_cancelled');
  const encodedToken = encodeURIComponent(token);

  const getRes = await request(app, 'GET', `/api/email/unsubscribe?token=${encodedToken}&type=booking_cancelled`);
  assert.strictEqual(getRes.status, 200);
  assert.match(getRes.body, /Confirm unsubscribe/);
  assert.deepStrictEqual(updates, []);

  const tampered = await request(app, 'POST', `/api/email/unsubscribe?token=${encodedToken}&type=password_reset`);
  assert.strictEqual(tampered.status, 400);
  assert.deepStrictEqual(updates, []);

  const postRes = await request(app, 'POST', `/api/email/unsubscribe?token=${encodedToken}&type=booking_cancelled`);
  assert.strictEqual(postRes.status, 200);
  assert.match(postRes.body, /Unsubscribed/);
  assert.deepStrictEqual(ensured, [7]);
  assert.deepStrictEqual(updates, [{ userId: 7, patch: { booking_cancelled: false } }]);

  const requiredToken = signUnsubscribeToken(7, 'password_reset');
  const requiredRes = await request(app, 'POST', `/api/email/unsubscribe?token=${encodeURIComponent(requiredToken)}&type=password_reset`);
  assert.strictEqual(requiredRes.status, 400);
  assert.strictEqual(updates.length, 1);
}

async function testUpdatePrefsDoesNotMutateRequiredColumns() {
  clearModule('db/notification-prefs.js');
  setMock('db/index.js', { query: async () => ({ rows: [] }) });
  const dbPrefs = require('../db/notification-prefs');
  const queries = [];
  const fakeDb = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (/SELECT \* FROM user_email_preferences/.test(sql)) {
        return {
          rows: [{
            email_all_off: false,
            booking_cancelled: false,
            password_reset: true,
            profile_change: true,
          }],
        };
      }
      return { rows: [] };
    },
  };

  await dbPrefs.updatePrefs(99, {
    booking_cancelled: false,
    password_reset: false,
    profile_change: false,
  }, fakeDb);

  const update = queries.find((q) => /UPDATE user_email_preferences SET/.test(q.sql));
  assert.ok(update, 'expected preferences UPDATE query');
  assert.match(update.sql, /booking_cancelled/);
  assert.doesNotMatch(update.sql, /password_reset/);
  assert.doesNotMatch(update.sql, /profile_change/);
}

function buildSyncClient({ startTime, endTime, flightDate }) {
  const state = {
    booking: {
      id: 123,
      start_time: startTime,
      end_time: endTime,
      status: 'completed',
      billing_voided: false,
      booking_type: 'solo',
      lesson_type: null,
      aircraft_id: null,
      student_id: null,
      instructor_id: null,
      hobbs_start: 100,
      hobbs_end: 101,
      tach_start: null,
      tach_end: null,
    },
    flightLog: {
      booking_id: 123,
      flight_date: flightDate,
      hobbs_start: 100,
      hobbs_end: 101,
      hobbs_delta: 1,
      tach_start: null,
      tach_end: null,
      tach_delta: null,
      dual_instruction_hours: 0,
      student_id: null,
      instructor_id: null,
    },
    bookingUpdates: [],
  };

  return {
    state,
    async query(sql, params = []) {
      if (/SELECT \* FROM bookings WHERE id = \$1/.test(sql)) return { rows: [state.booking] };
      if (/SELECT \* FROM flight_logs WHERE booking_id = \$1/.test(sql)) return { rows: [state.flightLog] };
      if (/UPDATE bookings SET/.test(sql)) {
        state.bookingUpdates.push({ sql, params });
        return { rows: [] };
      }
      if (/UPDATE flight_logs SET/.test(sql)) return { rows: [] };
      if (/UPDATE users SET/.test(sql)) return { rows: [] };
      if (/DELETE FROM instructor_hours/.test(sql)) return { rows: [] };
      throw new Error(`Unexpected query in syncFlightRecord test: ${sql}`);
    },
  };
}

async function testSyncFlightRecordPreservesBookingTimes() {
  clearModule('lib/sync-flight-record.js');
  const { syncFlightRecord } = require('../lib/sync-flight-record');

  const sameDateClient = buildSyncClient({
    startTime: '2026-09-24T00:30:00.000Z', // 2026-09-23 20:30 ET
    endTime: '2026-09-24T02:00:00.000Z',
    flightDate: '2026-09-23',
  });
  await syncFlightRecord(sameDateClient, 123, {
    flight_date: '2026-09-23',
    hobbs_start: 100,
    hobbs_end: 101.2,
  });
  assert.ok(!sameDateClient.state.bookingUpdates.some((q) => /start_time/.test(q.sql)), 'same-date edit must not rewrite booking times');

  const movedClient = buildSyncClient({
    startTime: '2026-09-24T00:30:00.000Z', // 2026-09-23 20:30 ET
    endTime: '2026-09-24T02:00:00.000Z',
    flightDate: '2026-09-23',
  });
  await syncFlightRecord(movedClient, 123, {
    flight_date: '2026-09-24',
    hobbs_start: 100,
    hobbs_end: 101.2,
  });
  const movedUpdate = movedClient.state.bookingUpdates.find((q) => /start_time/.test(q.sql));
  assert.ok(movedUpdate, 'date move should rewrite booking times');
  assert.ok(movedUpdate.params.includes('2026-09-25T00:30:00.000Z'), 'date move should preserve local start time');
  assert.ok(movedUpdate.params.includes('2026-09-25T02:00:00.000Z'), 'date move should preserve duration');
}

function testBillingOverrideGuardsPresent() {
  const fs = require('fs');
  const historyRoute = fs.readFileSync(path.join(ROOT, 'routes/booking-history.js'), 'utf8');
  assert.match(historyRoute, /canEditBillingFields = \['owner', 'admin'\]\.includes\(role\)/);
  assert.match(historyRoute, /if \(canEditBillingFields\) \{/);

  const instructorHoursRoute = fs.readFileSync(path.join(ROOT, 'routes/instructor-hours.js'), 'utf8');
  assert.match(instructorHoursRoute, /canEditBillingRates = \['owner', 'admin'\]\.includes\(role\)/);
  assert.match(instructorHoursRoute, /: row\.aircraft_rate/);
  assert.match(instructorHoursRoute, /: row\.instructor_rate/);
}

(async () => {
  await testUnsubscribeTokensAndRequiredEmails();
  await testUnsubscribeRouteRequiresPostAndRejectsTampering();
  await testUpdatePrefsDoesNotMutateRequiredColumns();
  await testSyncFlightRecordPreservesBookingTimes();
  testBillingOverrideGuardsPresent();
  console.log('critical bug regression checks passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
