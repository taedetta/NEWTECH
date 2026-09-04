'use strict';

const assert = require('assert');
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');

function installFakeDbPool() {
  const dbIndexPath = require.resolve('../db/index');
  const fail = async () => {
    throw new Error('Unexpected database query in no-database regression test');
  };
  require.cache[dbIndexPath] = {
    id: dbIndexPath,
    filename: dbIndexPath,
    loaded: true,
    exports: {
      query: fail,
      connect: async () => ({
        query: fail,
        release() {},
      }),
      on() {},
    },
  };
}

installFakeDbPool();

async function httpGet(app, path) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();

  try {
    return await new Promise((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port, path }, (res) => {
        res.resume();
        res.on('end', () => resolve({ statusCode: res.statusCode }));
      });
      req.on('error', reject);
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function testProfileRouterFallthrough() {
  const profileRoutes = require('../routes/profile');
  const app = express();
  app.use('/api/account', profileRoutes);
  app.use('/api/users/me', profileRoutes);
  app.use('/api/users/me', (req, res) => res.status(204).end());

  const legacyCfi = await httpGet(app, '/api/users/me/cfi-profile');
  assert.strictEqual(legacyCfi.statusCode, 204, 'legacy CFI profile path must fall through to endorsements route');

  const accountMiss = await httpGet(app, '/api/account/cfi-profile');
  assert.strictEqual(accountMiss.statusCode, 404, '/api/account should keep JSON 404 behavior for unknown routes');
}

function testUnsubscribeTokenBinding() {
  const {
    signUnsubscribeToken,
    verifyUnsubscribeToken,
    normalizeUnsubscribeType,
  } = require('../lib/unsubscribe-token');

  const token = signUnsubscribeToken(42, 'booking_confirmation');
  assert.deepStrictEqual(
    verifyUnsubscribeToken(token),
    { userId: 42, type: 'booking_confirmation' },
    'unsubscribe token must bind the target preference type'
  );

  const legacyToken = jwt.sign({ uid: 42, aud: 'email-unsub' }, process.env.JWT_SECRET || 'REDACTED');
  assert.strictEqual(verifyUnsubscribeToken(legacyToken), null, 'legacy untyped tokens must not be accepted');
  assert.strictEqual(normalizeUnsubscribeType('password_reset'), null, 'required email types must not be unsubscribe targets');
}

async function testUnsubscribeRouteRejectsQueryMutation() {
  const dbPrefsPath = require.resolve('../db/notification-prefs');
  const routePath = require.resolve('../routes/email-unsubscribe');
  const dbPrefs = require(dbPrefsPath);
  const originalEnsureDefaultPrefs = dbPrefs.ensureDefaultPrefs;
  const originalUpdatePrefs = dbPrefs.updatePrefs;
  const updates = [];

  dbPrefs.ensureDefaultPrefs = async () => {};
  dbPrefs.updatePrefs = async (userId, patch) => {
    updates.push({ userId, patch });
    return {};
  };
  delete require.cache[routePath];

  try {
    const { signUnsubscribeToken } = require('../lib/unsubscribe-token');
    const app = express();
    app.use('/api/email', require('../routes/email-unsubscribe'));
    const token = encodeURIComponent(signUnsubscribeToken(42, 'booking_confirmation'));

    const tampered = await httpGet(app, `/api/email/unsubscribe?token=${token}&type=all`);
    assert.strictEqual(tampered.statusCode, 400, 'tampered unsubscribe query type should be rejected');
    assert.strictEqual(updates.length, 0, 'tampered unsubscribe links must not mutate preferences');

    const valid = await httpGet(app, `/api/email/unsubscribe?token=${token}&type=booking_confirmation`);
    assert.strictEqual(valid.statusCode, 200, 'matching unsubscribe query type should be accepted');
    assert.deepStrictEqual(
      updates,
      [{ userId: 42, patch: { booking_confirmation: false } }],
      'valid unsubscribe should only update the signed preference type'
    );
  } finally {
    dbPrefs.ensureDefaultPrefs = originalEnsureDefaultPrefs;
    dbPrefs.updatePrefs = originalUpdatePrefs;
    delete require.cache[routePath];
  }
}

async function testRequiredEmailPrefs() {
  const dbPrefsPath = require.resolve('../db/notification-prefs');
  const libPrefsPath = require.resolve('../lib/notification-prefs');
  const dbPrefs = require(dbPrefsPath);
  const originalGetPrefs = dbPrefs.getPrefs;

  dbPrefs.getPrefs = async () => ({
    email_all_off: true,
    booking_confirmation: false,
    password_reset: false,
  });
  delete require.cache[libPrefsPath];

  try {
    const {
      EMAIL_TYPES,
      appendUnsubscribeFooter,
      getPreferenceCatalog,
      shouldSendEmail,
    } = require('../lib/notification-prefs');

    assert.strictEqual(
      await shouldSendEmail(42, EMAIL_TYPES.password_reset),
      true,
      'password resets must bypass opt-out preferences'
    );
    assert.strictEqual(
      await shouldSendEmail(42, EMAIL_TYPES.booking_confirmation),
      false,
      'optional emails should still honor opt-out preferences'
    );

    const withRequiredFooter = appendUnsubscribeFooter('<body>Reset</body>', 'Reset', 42, EMAIL_TYPES.password_reset);
    assert.strictEqual(withRequiredFooter.html, '<body>Reset</body>', 'required emails must not include unsubscribe footers');
    assert.strictEqual(withRequiredFooter.text, 'Reset', 'required email text must not include unsubscribe footers');

    const catalogKeys = getPreferenceCatalog('student', false).flatMap((category) => category.types.map((type) => type.key));
    assert.ok(!catalogKeys.includes('password_reset'), 'password reset must not appear in configurable preferences');
    assert.ok(catalogKeys.includes('booking_confirmation'), 'optional scheduling emails should remain configurable');
  } finally {
    dbPrefs.getPrefs = originalGetPrefs;
    delete require.cache[libPrefsPath];
  }
}

function testFlightDateShift() {
  const {
    shiftedBookingTimesForFlightDate,
  } = require('../lib/sync-flight-record');
  const {
    calendarDateFromDate,
    timeHmFromDate,
  } = require('../lib/school-timezone');

  const booking = {
    start_time: '2026-09-04T14:30:00.000Z',
    end_time: '2026-09-04T16:00:00.000Z',
  };

  assert.strictEqual(
    shiftedBookingTimesForFlightDate(booking, '2026-09-04'),
    null,
    'same-date history edits must not rewrite booking timestamps'
  );

  assert.strictEqual(
    shiftedBookingTimesForFlightDate({
      start_time: '2026-09-05T01:30:00.000Z',
      end_time: '2026-09-05T03:00:00.000Z',
    }, '2026-09-04'),
    null,
    'same school-local date edits must not shift evening flights whose UTC date differs'
  );

  const shifted = shiftedBookingTimesForFlightDate(booking, '2026-09-05');
  assert.ok(shifted, 'changed flight dates should shift booking timestamps');
  const shiftedStart = new Date(shifted.startTime);
  const shiftedEnd = new Date(shifted.endTime);
  assert.strictEqual(calendarDateFromDate(shiftedStart), '2026-09-05');
  assert.strictEqual(timeHmFromDate(shiftedStart), '10:30');
  assert.strictEqual(shiftedEnd.getTime() - shiftedStart.getTime(), 90 * 60 * 1000);
}

function testInstructorBillingGuards() {
  const { canEditBillingFields } = require('../routes/booking-history');
  assert.strictEqual(canEditBillingFields('instructor'), false, 'instructors must not edit booking-history billing fields');
  assert.strictEqual(canEditBillingFields('admin'), true, 'admins should retain booking-history billing access');

  const { instructorHourRatesForUpdate } = require('../routes/instructor-hours');
  const existing = { aircraft_rate: 155, instructor_rate: 80 };
  assert.deepStrictEqual(
    instructorHourRatesForUpdate('instructor', existing, { aircraft_rate: 1, instructor_rate: 2 }),
    { aircraftRate: 155, instructorRate: 80 },
    'instructor-hours edits by instructors must preserve existing billing rates'
  );
  assert.deepStrictEqual(
    instructorHourRatesForUpdate('admin', existing, { aircraft_rate: '175.50', instructor_rate: '' }),
    { aircraftRate: 175.50, instructorRate: null },
    'admin instructor-hours edits may update or clear billing rates'
  );
}

(async () => {
  await testProfileRouterFallthrough();
  testUnsubscribeTokenBinding();
  await testUnsubscribeRouteRejectsQueryMutation();
  await testRequiredEmailPrefs();
  testFlightDateShift();
  testInstructorBillingGuards();
  console.log('critical bug regressions passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
