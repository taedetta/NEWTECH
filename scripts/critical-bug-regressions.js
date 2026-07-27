#!/usr/bin/env node
'use strict';

const assert = require('assert');
const express = require('express');
const http = require('http');

function clearModule(modulePath) {
  delete require.cache[require.resolve(modulePath)];
}

function installMock(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  const previous = require.cache[resolved];
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports,
  };
  return () => {
    if (previous) require.cache[resolved] = previous;
    else delete require.cache[resolved];
  };
}

async function request(server, method, path, body = null, headers = {}) {
  const { port } = server.address();
  const payload = body == null ? null : Buffer.from(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      method,
      path,
      headers: {
        ...(payload ? { 'Content-Length': payload.length } : {}),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function listen(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

async function testRequiredEmailsBypassPreferences() {
  const restoreDb = installMock('../db/notification-prefs', {
    getPrefs: async () => ({
      email_all_off: true,
      booking_confirmation: false,
      password_reset: false,
      account_invite: false,
    }),
  });
  clearModule('../lib/notification-prefs');

  try {
    const {
      EMAIL_TYPES,
      appendUnsubscribeFooter,
      getPreferenceCatalog,
      shouldSendEmail,
    } = require('../lib/notification-prefs');

    assert.strictEqual(await shouldSendEmail(7, EMAIL_TYPES.password_reset), true);
    assert.strictEqual(await shouldSendEmail(7, EMAIL_TYPES.account_invite), true);
    assert.strictEqual(await shouldSendEmail(7, EMAIL_TYPES.booking_confirmation), false);

    const required = appendUnsubscribeFooter('<p>Reset</p>', 'Reset', 7, EMAIL_TYPES.password_reset);
    assert.strictEqual(required.html, '<p>Reset</p>');
    assert.strictEqual(required.text, 'Reset');

    const optional = appendUnsubscribeFooter('<p>Booking</p>', 'Booking', 7, EMAIL_TYPES.booking_confirmation);
    assert.match(optional.html, /Unsubscribe from this type/);

    const visibleKeys = getPreferenceCatalog('student', false)
      .flatMap((category) => category.types.map((type) => type.key));
    assert(!visibleKeys.includes(EMAIL_TYPES.password_reset));
    assert(!visibleKeys.includes(EMAIL_TYPES.account_invite));
    assert(visibleKeys.includes(EMAIL_TYPES.profile_change));
  } finally {
    clearModule('../lib/notification-prefs');
    restoreDb();
  }

  const { rowToPrefs } = require('../db/notification-prefs');
  const prefs = rowToPrefs({
    email_all_off: true,
    password_reset: false,
    account_approved: false,
  });
  assert.strictEqual(prefs.email_all_off, true);
  assert.strictEqual(prefs.password_reset, true);
  assert.strictEqual(prefs.account_approved, true);
}

async function testUnsubscribeRequiresPostAndRejectsRequiredTypes() {
  process.env.JWT_SECRET = 'critical-bug-regression-secret';
  clearModule('../lib/unsubscribe-token');
  clearModule('../routes/email-unsubscribe');

  const updates = [];
  const restoreDb = installMock('../db/notification-prefs', {
    ensureDefaultPrefs: async () => {},
    updatePrefs: async (userId, patch) => {
      updates.push({ userId, patch });
      return patch;
    },
  });

  let server;
  try {
    const { signUnsubscribeToken } = require('../lib/unsubscribe-token');
    const route = require('../routes/email-unsubscribe');
    const app = express();
    app.use('/api/email', route);
    server = await listen(app);

    const token = signUnsubscribeToken(42, 'booking_confirmation');
    const getRes = await request(
      server,
      'GET',
      `/api/email/unsubscribe?token=${encodeURIComponent(token)}&type=booking_confirmation`
    );
    assert.strictEqual(getRes.status, 200);
    assert.match(getRes.body, /Confirm unsubscribe/);
    assert.strictEqual(updates.length, 0);

    const postBody = `token=${encodeURIComponent(token)}&type=booking_confirmation`;
    const postRes = await request(server, 'POST', '/api/email/unsubscribe', postBody, {
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    assert.strictEqual(postRes.status, 200);
    assert.deepStrictEqual(updates, [{
      userId: 42,
      patch: { booking_confirmation: false },
    }]);

    const mismatchedRes = await request(
      server,
      'GET',
      `/api/email/unsubscribe?token=${encodeURIComponent(token)}&type=all`
    );
    assert.strictEqual(mismatchedRes.status, 400);
    assert.strictEqual(updates.length, 1);

    const requiredToken = signUnsubscribeToken(42, 'password_reset');
    const requiredBody = `token=${encodeURIComponent(requiredToken)}&type=password_reset`;
    const requiredRes = await request(server, 'POST', '/api/email/unsubscribe', requiredBody, {
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    assert.strictEqual(requiredRes.status, 400);
    assert.strictEqual(updates.length, 1);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    clearModule('../routes/email-unsubscribe');
    clearModule('../lib/unsubscribe-token');
    restoreDb();
  }
}

function createFlightSyncClient() {
  const booking = {
    id: 11,
    status: 'completed',
    billing_voided: true,
    start_time: '2026-07-01T15:30:00.000Z',
    end_time: '2026-07-01T17:00:00.000Z',
    hobbs_start: 10,
    hobbs_end: 11,
    tach_start: null,
    tach_end: null,
    student_id: 5,
    instructor_id: null,
    aircraft_id: null,
    booking_type: 'solo',
    lesson_type: 'solo',
  };
  const flightLog = {
    booking_id: 11,
    flight_date: '2026-07-01',
    hobbs_start: 10,
    hobbs_end: 11,
    hobbs_delta: 1,
    tach_start: null,
    tach_end: null,
    tach_delta: null,
    dual_instruction_hours: 0,
    student_id: 5,
    instructor_id: null,
    aircraft_id: null,
  };
  const bookingUpdates = [];

  return {
    bookingUpdates,
    async query(sql, params) {
      if (sql === 'SELECT * FROM bookings WHERE id = $1') {
        return { rows: [{ ...booking }] };
      }
      if (sql === 'SELECT * FROM flight_logs WHERE booking_id = $1') {
        return { rows: [{ ...flightLog }] };
      }
      if (sql.startsWith('UPDATE bookings SET')) {
        bookingUpdates.push({ sql, params });
        return { rows: [] };
      }
      if (sql.startsWith('UPDATE flight_logs SET')) {
        return { rows: [] };
      }
      if (sql.startsWith('DELETE FROM instructor_hours')) {
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

async function testFlightSyncDoesNotClobberBookingTimes() {
  const { syncFlightRecord } = require('../lib/sync-flight-record');

  const noDateClient = createFlightSyncClient();
  await syncFlightRecord(noDateClient, 11, { hobbs_start: 10, hobbs_end: 11.2 });
  assert(!/start_time/.test(noDateClient.bookingUpdates[0].sql));
  assert(!/end_time/.test(noDateClient.bookingUpdates[0].sql));

  const sameDateClient = createFlightSyncClient();
  await syncFlightRecord(sameDateClient, 11, {
    flight_date: '2026-07-01',
    hobbs_start: 10,
    hobbs_end: 11.3,
  });
  assert(!/start_time/.test(sameDateClient.bookingUpdates[0].sql));
  assert(!/end_time/.test(sameDateClient.bookingUpdates[0].sql));

  const movedDateClient = createFlightSyncClient();
  await syncFlightRecord(movedDateClient, 11, {
    flight_date: '2026-07-03',
    hobbs_start: 10,
    hobbs_end: 11.4,
  });
  assert.match(movedDateClient.bookingUpdates[0].sql, /start_time/);
  assert.match(movedDateClient.bookingUpdates[0].sql, /end_time/);
  assert(movedDateClient.bookingUpdates[0].params.includes('2026-07-03T15:30:00.000Z'));
  assert(movedDateClient.bookingUpdates[0].params.includes('2026-07-03T17:00:00.000Z'));
}

(async () => {
  await testRequiredEmailsBypassPreferences();
  await testUnsubscribeRequiresPostAndRejectsRequiredTypes();
  await testFlightSyncDoesNotClobberBookingTimes();
  console.log('critical bug regressions passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
