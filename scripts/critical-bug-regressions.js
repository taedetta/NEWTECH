'use strict';

const assert = require('assert');
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.APP_URL = process.env.APP_URL || 'https://example.test';

function clearModule(modulePath) {
  delete require.cache[require.resolve(modulePath)];
}

function installDbStub(exports) {
  const dbPath = require.resolve('../db/notification-prefs');
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports,
  };
}

function installPoolStub(pool) {
  const poolPath = require.resolve('../db/index');
  require.cache[poolPath] = {
    id: poolPath,
    filename: poolPath,
    loaded: true,
    exports: pool,
  };
}

function installSyncFlightRecordStub(exports) {
  const syncPath = require.resolve('../lib/sync-flight-record');
  require.cache[syncPath] = {
    id: syncPath,
    filename: syncPath,
    loaded: true,
    exports,
  };
}

function request(app, method, target, body, bearerToken) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const payload = body ? new URLSearchParams(body).toString() : '';
      const headers = {};
      if (payload) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        headers['Content-Length'] = Buffer.byteLength(payload);
      }
      if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;
      const req = http.request({
        hostname: '127.0.0.1',
        port: address.port,
        path: target,
        method,
        headers,
      }, (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          server.close(() => resolve({ status: res.statusCode, body: raw }));
        });
      });
      req.on('error', (err) => {
        server.close(() => reject(err));
      });
      if (payload) req.write(payload);
      req.end();
    });
  });
}

async function testUnsubscribeRoute() {
  clearModule('../routes/email-unsubscribe');
  clearModule('../lib/unsubscribe-token');

  const updates = [];
  const ensures = [];
  installDbStub({
    ensureDefaultPrefs: async (userId) => { ensures.push(userId); },
    updatePrefs: async (userId, patch) => { updates.push({ userId, patch }); return {}; },
  });

  const { buildUnsubscribeUrl } = require('../lib/unsubscribe-token');
  const url = new URL(buildUnsubscribeUrl(42, 'booking_confirmation'));

  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use('/api/email', require('../routes/email-unsubscribe'));

  const getRes = await request(app, 'GET', `${url.pathname}${url.search}`);
  assert.strictEqual(getRes.status, 200);
  assert.match(getRes.body, /Confirm unsubscribe/);
  assert.deepStrictEqual(ensures, []);
  assert.deepStrictEqual(updates, []);

  const token = url.searchParams.get('token');
  const postRes = await request(app, 'POST', '/api/email/unsubscribe', {
    token,
    type: 'booking_confirmation',
  });
  assert.strictEqual(postRes.status, 200);
  assert.deepStrictEqual(updates, [
    { userId: 42, patch: { booking_confirmation: false } },
  ]);

  const escalated = await request(app, 'POST', '/api/email/unsubscribe', {
    token,
    type: 'all',
  });
  assert.strictEqual(escalated.status, 400);
  assert.strictEqual(updates.length, 1);

  const allUrl = new URL(buildUnsubscribeUrl(42, 'all'));
  const allPost = await request(app, 'POST', '/api/email/unsubscribe', {
    token: allUrl.searchParams.get('token'),
    type: 'all',
  });
  assert.strictEqual(allPost.status, 200);
  assert.deepStrictEqual(updates[1], { userId: 42, patch: { email_all_off: true } });
}

async function testRequiredEmailPreferences() {
  clearModule('../lib/notification-prefs');
  installDbStub({
    getPrefs: async () => ({
      email_all_off: true,
      booking_confirmation: false,
      password_reset: false,
      profile_change: false,
    }),
  });

  const { EMAIL_TYPES } = require('../lib/email-types');
  const prefs = require('../lib/notification-prefs');
  assert.strictEqual(await prefs.shouldSendEmail(7, EMAIL_TYPES.password_reset), true);
  assert.strictEqual(await prefs.shouldSendEmail(7, EMAIL_TYPES.profile_change), true);
  assert.strictEqual(await prefs.shouldSendEmail(7, EMAIL_TYPES.booking_confirmation), false);

  const requiredFooter = prefs.appendUnsubscribeFooter('<body>Reset</body>', 'Reset', 7, EMAIL_TYPES.password_reset);
  assert.strictEqual(requiredFooter.html, '<body>Reset</body>');
  assert.strictEqual(requiredFooter.text, 'Reset');

  const catalog = prefs.getPreferenceCatalog('student', false);
  const visibleKeys = catalog.flatMap((category) => category.types.map((type) => type.key));
  assert(!visibleKeys.includes('password_reset'));
  assert(!visibleKeys.includes('profile_change'));
}

async function testUpdatePrefsIgnoresRequiredColumns() {
  clearModule('../db/notification-prefs');
  const queries = [];
  const fakeDb = {
    query: async (sql, params) => {
      queries.push({ sql: String(sql), params });
      if (String(sql).startsWith('SELECT * FROM user_email_preferences')) {
        return { rows: [{ user_id: 9, email_all_off: true, booking_confirmation: false, password_reset: true }] };
      }
      return { rows: [] };
    },
  };
  installPoolStub(fakeDb);
  const dbPrefs = require('../db/notification-prefs');

  await dbPrefs.updatePrefs(9, {
    email_all_off: true,
    booking_confirmation: false,
    password_reset: false,
    profile_change: false,
  }, fakeDb);

  const update = queries.find((q) => q.sql.startsWith('UPDATE user_email_preferences SET'));
  assert(update, 'expected update query');
  assert.match(update.sql, /email_all_off/);
  assert.match(update.sql, /booking_confirmation/);
  assert.doesNotMatch(update.sql, /password_reset/);
  assert.doesNotMatch(update.sql, /profile_change/);
}

function testBookingConflictDecisions() {
  const {
    canEditHistoricalBooking,
    shouldCheckBookingConflict,
  } = require('../lib/booking-status');

  assert.strictEqual(shouldCheckBookingConflict({
    scheduleChanged: true,
    previousStatus: 'confirmed',
    nextStatus: 'confirmed',
  }), true, 'admin/staff edits to active bookings must still conflict-check');

  assert.strictEqual(shouldCheckBookingConflict({
    scheduleChanged: false,
    previousStatus: 'completed',
    nextStatus: 'confirmed',
  }), true, 'reactivating a historical booking must conflict-check even if times are unchanged');

  assert.strictEqual(shouldCheckBookingConflict({
    scheduleChanged: true,
    previousStatus: 'completed',
    nextStatus: 'completed',
  }), false, 'completed/cancelled records remain non-blocking while historical');

  const completed = { status: 'completed', instructor_id: 11, student_id: 22 };
  assert.strictEqual(canEditHistoricalBooking({ id: 22, role: 'student' }, completed), false);
  assert.strictEqual(canEditHistoricalBooking({ id: 11, role: 'instructor' }, completed), true);
  assert.strictEqual(canEditHistoricalBooking({ id: 5, role: 'admin' }, completed), true);
}

function testFlightDateHelpers() {
  clearModule('../lib/sync-flight-record');
  const {
    resolveFlightDate,
    moveBookingWindowToDate,
  } = require('../lib/sync-flight-record');
  const { timeHmFromDate } = require('../lib/school-timezone');

  assert.strictEqual(resolveFlightDate({
    bookingStartTime: '2026-07-04T00:30:00.000Z',
    fallbackDate: new Date('2026-01-01T12:00:00.000Z'),
  }), '2026-07-03', 'booking timestamp fallback must use school-local date, not UTC date');

  const booking = {
    start_time: '2026-03-10T14:30:00.000Z',
    end_time: '2026-03-10T16:00:00.000Z',
  };
  const moved = moveBookingWindowToDate(booking, '2026-03-12');
  assert.strictEqual(timeHmFromDate(moved.startTime), timeHmFromDate(booking.start_time));
  assert.strictEqual(moved.endTime.getTime() - moved.startTime.getTime(), 90 * 60 * 1000);
  assert.notStrictEqual(moved.startTime.toISOString(), '2026-03-12T12:00:00.000Z');
}

async function testBookingHistoryOmitsUnchangedFlightDate() {
  clearModule('../routes/booking-history');
  clearModule('../middleware/auth');
  clearModule('../lib/sync-flight-record');

  const booking = {
    id: 123,
    status: 'completed',
    aircraft_id: 2,
    instructor_id: 5,
    student_id: 7,
    start_time: '2026-07-04T00:30:00.000Z',
    end_time: '2026-07-04T02:00:00.000Z',
    hobbs_start: 100,
    hobbs_end: 101,
    tach_start: null,
    tach_end: null,
    booking_type: 'dual',
    lesson_type: 'Dual Instruction',
    hourly_rate: 150,
  };
  const fakeClient = {
    query: async () => ({ rows: [] }),
    release: () => {},
  };
  const fakePool = {
    query: async (sql) => {
      if (String(sql).includes('SELECT b.*, a.hourly_rate')) return { rows: [booking] };
      return { rows: [] };
    },
    connect: async () => fakeClient,
  };
  installPoolStub(fakePool);
  installDbStub({
    getPrefs: async () => ({}),
    updatePrefs: async () => ({}),
    ensureDefaultPrefs: async () => {},
  });

  const patches = [];
  installSyncFlightRecordStub({
    syncFlightRecord: async (client, bookingId, patch) => {
      patches.push({ bookingId, patch });
      return { aircraftChargeAmount: 150, instructionChargeAmount: 0 };
    },
  });

  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use('/api/booking-history', require('../routes/booking-history'));
  const token = jwt.sign({ id: 99, role: 'admin' }, process.env.JWT_SECRET);

  const unchanged = await request(app, 'PATCH', '/api/booking-history/flights/123', {
    flight_date: '2026-07-03',
    hobbs_start: '100',
    hobbs_end: '101',
  }, token);
  assert.strictEqual(unchanged.status, 200);
  assert.strictEqual(patches[0].patch.flight_date, undefined);

  const changed = await request(app, 'PATCH', '/api/booking-history/flights/123', {
    flight_date: '2026-07-05',
    hobbs_start: '100',
    hobbs_end: '101',
  }, token);
  assert.strictEqual(changed.status, 200);
  assert.strictEqual(patches[1].patch.flight_date, '2026-07-05');
}

async function testProfileRouterFallsThroughForCfiProfile() {
  clearModule('../routes/profile');
  clearModule('../middleware/auth');
  installPoolStub({ query: async () => ({ rows: [] }) });
  installDbStub({
    getPrefs: async () => ({}),
    updatePrefs: async () => ({}),
    ensureDefaultPrefs: async () => {},
  });

  const app = express();
  app.use('/api/users/me', require('../routes/profile'));
  app.use('/api/users/me', (req, res) => res.status(204).end());

  const res = await request(app, 'GET', '/api/users/me/cfi-profile');
  assert.strictEqual(res.status, 204);
}

(async () => {
  await testUnsubscribeRoute();
  await testRequiredEmailPreferences();
  await testUpdatePrefsIgnoresRequiredColumns();
  testBookingConflictDecisions();
  testFlightDateHelpers();
  await testBookingHistoryOmitsUnchangedFlightDate();
  await testProfileRouterFallsThroughForCfiProfile();
  console.log('critical bug regressions passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
