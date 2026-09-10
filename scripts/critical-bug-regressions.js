'use strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'critical-bug-test-secret';
process.env.APP_URL = process.env.APP_URL || 'https://example.test';

const assert = require('assert');
const express = require('express');
const jwt = require('jsonwebtoken');

const dbIndexPath = require.resolve('../db/index');
require.cache[dbIndexPath] = {
  id: dbIndexPath,
  filename: dbIndexPath,
  loaded: true,
  exports: {
    query: async () => {
      throw new Error('Unexpected default database query in critical regression test');
    },
  },
};

const {
  DEFAULT_PREFS,
  updatePrefs,
} = require('../db/notification-prefs');
const {
  appendUnsubscribeFooter,
  getPreferenceCatalog,
  shouldSendEmail,
  EMAIL_TYPES,
} = require('../lib/notification-prefs');
const {
  buildUnsubscribeUrl,
  verifyUnsubscribeToken,
} = require('../lib/unsubscribe-token');
const { syncFlightRecordFromInstructorHours } = require('../lib/sync-flight-record');
const { canManageHistoryBilling } = require('../routes/booking-history');
const { canManageInstructorHourRates } = require('../routes/instructor-hours');

async function request(app, method, path, body) {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const options = { method, redirect: 'manual' };
    if (body) {
      options.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
      options.body = new URLSearchParams(body).toString();
    }
    const res = await fetch(`http://127.0.0.1:${port}${path}`, options);
    return { status: res.status, text: await res.text() };
  } finally {
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

function loadUnsubscribeRouteWithDbStub(calls) {
  const routePath = require.resolve('../routes/email-unsubscribe');
  const dbPath = require.resolve('../db/notification-prefs');
  delete require.cache[routePath];
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      ensureDefaultPrefs: async (userId) => {
        calls.ensure.push(userId);
      },
      updatePrefs: async (userId, patch) => {
        calls.update.push({ userId, patch });
        return { ...DEFAULT_PREFS, ...patch };
      },
    },
  };
  return require('../routes/email-unsubscribe');
}

async function testTokenBindingAndRequiredEmails() {
  const url = new URL(buildUnsubscribeUrl(42, EMAIL_TYPES.booking_confirmation));
  const token = url.searchParams.get('token');
  const verified = verifyUnsubscribeToken(token);
  assert.deepStrictEqual(verified, { userId: 42, emailType: EMAIL_TYPES.booking_confirmation });
  assert.strictEqual(url.searchParams.get('type'), EMAIL_TYPES.booking_confirmation);

  const legacyToken = jwt.sign({ uid: 42, aud: 'email-unsub' }, process.env.JWT_SECRET, { expiresIn: '365d' });
  assert.strictEqual(verifyUnsubscribeToken(legacyToken), null);

  const requiredUrl = new URL(buildUnsubscribeUrl(42, EMAIL_TYPES.password_reset));
  assert.strictEqual(requiredUrl.searchParams.get('type'), 'all');
  assert.strictEqual(verifyUnsubscribeToken(requiredUrl.searchParams.get('token')).emailType, 'all');
}

async function testRequiredEmailsBypassPrefsAndFooter() {
  const html = '<html><body>Reset password</body></html>';
  const text = 'Reset password';
  const required = appendUnsubscribeFooter(html, text, 42, EMAIL_TYPES.password_reset);
  assert.strictEqual(required.html, html);
  assert.strictEqual(required.text, text);
  assert.strictEqual(await shouldSendEmail(42, EMAIL_TYPES.password_reset), true);

  const optionalTextOnly = appendUnsubscribeFooter(null, 'Endorsement body', 42, EMAIL_TYPES.endorsement_expiry);
  assert.strictEqual(optionalTextOnly.html, null);
  assert.match(optionalTextOnly.text, /Unsubscribe from Endorsement expiry alerts:/);

  const accountTypes = getPreferenceCatalog('student', false)
    .flatMap((cat) => cat.types.map((type) => type.key));
  assert.ok(!accountTypes.includes(EMAIL_TYPES.password_reset));
  assert.ok(!accountTypes.includes(EMAIL_TYPES.profile_change));
  assert.ok(accountTypes.includes(EMAIL_TYPES.booking_confirmation));
}

async function testPreferenceWritesCannotDisableRequiredTypes() {
  const queries = [];
  const fakeDb = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (/SELECT \* FROM user_email_preferences/.test(sql)) {
        return {
          rows: [{
            ...DEFAULT_PREFS,
            booking_confirmation: false,
            password_reset: true,
          }],
        };
      }
      return { rows: [] };
    },
  };

  const prefs = await updatePrefs(42, {
    booking_confirmation: false,
    password_reset: false,
    profile_change: false,
  }, fakeDb);

  const update = queries.find((q) => q.sql.startsWith('UPDATE user_email_preferences SET'));
  assert.ok(update, 'expected a preferences UPDATE query');
  assert.match(update.sql, /booking_confirmation/);
  assert.doesNotMatch(update.sql, /password_reset/);
  assert.doesNotMatch(update.sql, /profile_change/);
  assert.strictEqual(prefs.booking_confirmation, false);
  assert.strictEqual(prefs.password_reset, true);
  assert.strictEqual(prefs.profile_change, true);
}

async function testUnsubscribeRouteIsPostOnlyAndTypeBound() {
  const calls = { ensure: [], update: [] };
  const route = loadUnsubscribeRouteWithDbStub(calls);
  const app = express();
  app.use('/api/email', route);

  const validUrl = new URL(buildUnsubscribeUrl(42, EMAIL_TYPES.booking_confirmation));
  const getResult = await request(app, 'GET', `${validUrl.pathname}${validUrl.search}`);
  assert.strictEqual(getResult.status, 200);
  assert.match(getResult.text, /Confirm unsubscribe/);
  assert.deepStrictEqual(calls.ensure, []);
  assert.deepStrictEqual(calls.update, []);

  const tampered = `/api/email/unsubscribe?token=${encodeURIComponent(validUrl.searchParams.get('token'))}&type=all`;
  const tamperedResult = await request(app, 'POST', tampered, {
    token: validUrl.searchParams.get('token'),
    type: 'all',
  });
  assert.strictEqual(tamperedResult.status, 400);
  assert.deepStrictEqual(calls.update, []);

  const postResult = await request(app, 'POST', '/api/email/unsubscribe', {
    token: validUrl.searchParams.get('token'),
    type: EMAIL_TYPES.booking_confirmation,
  });
  assert.strictEqual(postResult.status, 200);
  assert.deepStrictEqual(calls.update, [{
    userId: 42,
    patch: { [EMAIL_TYPES.booking_confirmation]: false },
  }]);
}

async function testProfileRouterDoesNotShadowCfiProfileRoute() {
  const profilePath = require.resolve('../routes/profile');
  delete require.cache[profilePath];
  const profileRoutes = require('../routes/profile');
  const app = express();
  app.use('/api/users/me', profileRoutes);
  app.use('/api/users/me/cfi-profile', (req, res) => {
    res.status(204).end();
  });

  const result = await request(app, 'GET', '/api/users/me/cfi-profile');
  assert.strictEqual(result.status, 204);
}

async function testBillingOverridesAreAdminOnly() {
  assert.strictEqual(canManageHistoryBilling('owner'), true);
  assert.strictEqual(canManageHistoryBilling('admin'), true);
  assert.strictEqual(canManageHistoryBilling('instructor'), false);
  assert.strictEqual(canManageInstructorHourRates('owner'), true);
  assert.strictEqual(canManageInstructorHourRates('admin'), true);
  assert.strictEqual(canManageInstructorHourRates('instructor'), false);
}

async function testInstructorHoursSyncIgnoresNonAdminRateOverrides() {
  const booking = {
    id: 77,
    student_id: 9,
    instructor_id: 42,
    aircraft_id: 5,
    status: 'completed',
    booking_type: 'dual',
    lesson_type: 'Dual',
    hobbs_start: 100,
    hobbs_end: 101,
    tach_start: null,
    tach_end: null,
    billing_voided: false,
    start_time: '2026-03-15T14:00:00.000Z',
    end_time: '2026-03-15T15:30:00.000Z',
  };
  const oldLog = {
    booking_id: 77,
    student_id: 9,
    instructor_id: 42,
    aircraft_id: 5,
    booking_type: 'dual',
    flight_date: '2026-03-15',
    hobbs_start: 100,
    hobbs_end: 101,
    hobbs_delta: 1,
    tach_start: null,
    tach_end: null,
    tach_delta: null,
    dual_instruction_hours: 1,
  };
  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes('SELECT hobbs_start, hobbs_end, start_time FROM bookings')) {
        return { rows: [booking] };
      }
      if (sql === 'SELECT * FROM bookings WHERE id = $1') {
        return { rows: [booking] };
      }
      if (sql === 'SELECT * FROM flight_logs WHERE booking_id = $1') {
        return { rows: [oldLog] };
      }
      if (sql.includes('SELECT hourly_rate FROM aircraft')) {
        return { rows: [{ hourly_rate: 200 }] };
      }
      if (sql.includes('SELECT instructor_rate FROM users')) {
        return { rows: [{ instructor_rate: 80 }] };
      }
      if (sql.includes('SELECT name FROM users')) {
        return { rows: [{ name: 'Student Pilot' }] };
      }
      if (sql.includes('SELECT * FROM instructor_hours WHERE booking_id')) {
        return { rows: [{ id: 12, aircraft_rate: 0, instructor_rate: 0, notes: 'malicious stale rates' }] };
      }
      if (sql.includes('SELECT id FROM instructor_hours WHERE booking_id')) {
        return { rows: [{ id: 12 }] };
      }
      return { rows: [] };
    },
  };

  await syncFlightRecordFromInstructorHours(client, {
    booking_id: 77,
    entry_date: '2026-03-15',
    aircraft_hours: 1,
    instruction_hours: 1,
    aircraft_rate: 0,
    instructor_rate: 0,
  }, { preserveRateOverrides: false });

  const bookingUpdate = queries.find((q) => q.sql.startsWith('UPDATE bookings SET'));
  assert.ok(bookingUpdate, 'expected booking meter update');
  assert.doesNotMatch(bookingUpdate.sql, /start_time/);
  assert.doesNotMatch(bookingUpdate.sql, /end_time/);

  const flightLogUpdate = queries.find((q) => q.sql.includes('UPDATE flight_logs SET'));
  assert.ok(flightLogUpdate, 'expected flight log update');
  assert.strictEqual(flightLogUpdate.params[8], 200);
  assert.strictEqual(flightLogUpdate.params[9], 80);

  const instructorHoursUpdate = queries.find((q) => q.sql.includes('UPDATE instructor_hours SET'));
  assert.ok(instructorHoursUpdate, 'expected instructor hours sync update');
  assert.strictEqual(instructorHoursUpdate.params[5], 200);
  assert.strictEqual(instructorHoursUpdate.params[6], 80);
}

async function main() {
  await testTokenBindingAndRequiredEmails();
  await testRequiredEmailsBypassPrefsAndFooter();
  await testPreferenceWritesCannotDisableRequiredTypes();
  await testUnsubscribeRouteIsPostOnlyAndTypeBound();
  await testProfileRouterDoesNotShadowCfiProfileRoute();
  await testBillingOverridesAreAdminOnly();
  await testInstructorHoursSyncIgnoresNonAdminRateOverrides();
  console.log('critical bug regressions passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
