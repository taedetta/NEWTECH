'use strict';

const assert = require('assert');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'critical-bug-test-secret';
process.env.APP_URL = process.env.APP_URL || 'https://example.test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://test:test@localhost:5432/test';

function freshRequire(modulePath) {
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

async function run() {
  const {
    bookingsOverlap,
    shouldCheckBookingConflict,
  } = freshRequire('../lib/booking-overlap');
  assert.strictEqual(
    bookingsOverlap('2026-09-06T17:00:00Z', '2026-09-06T18:00:00Z', '2026-09-06T18:00:00Z', '2026-09-06T19:00:00Z'),
    false,
    'back-to-back bookings should not overlap'
  );
  assert.strictEqual(
    shouldCheckBookingConflict({ currentStatus: 'confirmed', nextStatus: 'confirmed', scheduleChanged: true }),
    true,
    'active booking reschedules must check conflicts'
  );
  assert.strictEqual(
    shouldCheckBookingConflict({ currentStatus: 'completed', nextStatus: 'completed', scheduleChanged: true }),
    false,
    'historical edits that remain non-blocking should not check conflicts'
  );
  assert.strictEqual(
    shouldCheckBookingConflict({ currentStatus: 'completed', nextStatus: 'confirmed', scheduleChanged: false }),
    true,
    'reactivating a historical booking must check conflicts even when times do not change'
  );

  const { REQUIRED_EMAIL_TYPES } = freshRequire('../lib/email-types');
  const poolPath = require.resolve('../db/index');
  const realPoolCache = require.cache[poolPath];
  require.cache[poolPath] = {
    id: poolPath,
    filename: poolPath,
    loaded: true,
    exports: {
      query: async () => {
        throw new Error('Unexpected database query in critical-bug regression test');
      },
    },
  };
  const dbPrefs = freshRequire('../db/notification-prefs');

  const falseRequiredPrefs = Object.fromEntries(REQUIRED_EMAIL_TYPES.map((key) => [key, false]));
  const normalized = dbPrefs.rowToPrefs({
    email_all_off: true,
    booking_confirmation: false,
    ...falseRequiredPrefs,
  });
  assert.strictEqual(normalized.booking_confirmation, false, 'optional email pref should preserve stored false value');
  for (const key of REQUIRED_EMAIL_TYPES) {
    assert.strictEqual(normalized[key], true, `${key} must normalize to enabled`);
  }

  const dbPath = require.resolve('../db/notification-prefs');
  const realDbCache = require.cache[dbPath];
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      getPrefs: async () => ({
        email_all_off: true,
        booking_confirmation: true,
        password_reset: false,
      }),
    },
  };
  const notificationPrefs = freshRequire('../lib/notification-prefs');
  assert.strictEqual(
    await notificationPrefs.shouldSendEmail(7, notificationPrefs.EMAIL_TYPES.password_reset),
    true,
    'password reset must bypass email_all_off and per-type false prefs'
  );
  assert.strictEqual(
    await notificationPrefs.shouldSendEmail(7, notificationPrefs.EMAIL_TYPES.booking_confirmation),
    false,
    'optional email should still honor email_all_off'
  );
  assert.deepStrictEqual(
    notificationPrefs.appendUnsubscribeFooter('<body>Reset</body>', 'Reset', 7, notificationPrefs.EMAIL_TYPES.password_reset),
    { html: '<body>Reset</body>', text: 'Reset' },
    'required emails must not include unsubscribe links'
  );
  const textOnlyFooter = notificationPrefs.appendUnsubscribeFooter(
    null,
    'Endorsement expires soon',
    7,
    notificationPrefs.EMAIL_TYPES.endorsement_expiry
  );
  assert.strictEqual(textOnlyFooter.html, null, 'text-only optional emails should remain text-only');
  assert.ok(
    textOnlyFooter.text.includes('Unsubscribe from Endorsement expiry alerts:'),
    'text-only optional emails should get a text unsubscribe footer'
  );
  const catalogKeys = notificationPrefs
    .getPreferenceCatalog('student', false)
    .flatMap((category) => category.types.map((type) => type.key));
  for (const key of REQUIRED_EMAIL_TYPES) {
    assert.ok(!catalogKeys.includes(key), `${key} must be hidden from preference UI catalog`);
  }
  assert.ok(catalogKeys.includes('profile_change'), 'non-required account preference should remain user-configurable');
  if (realDbCache) require.cache[dbPath] = realDbCache;
  else delete require.cache[dbPath];

  const unsubscribeToken = freshRequire('../lib/unsubscribe-token');
  const unsubscribeUrl = new URL(unsubscribeToken.buildUnsubscribeUrl(7, 'booking_confirmation'));
  const signedToken = unsubscribeUrl.searchParams.get('token');
  assert.deepStrictEqual(
    unsubscribeToken.verifyUnsubscribeToken(signedToken),
    { userId: 7, type: 'booking_confirmation' },
    'unsubscribe token must bind the target email type'
  );
  const unsafeUserOnlyToken = jwt.sign({ uid: 7, aud: 'email-unsub' }, process.env.JWT_SECRET, { expiresIn: '365d' });
  assert.strictEqual(
    unsubscribeToken.verifyUnsubscribeToken(unsafeUserOnlyToken),
    null,
    'user-only unsubscribe tokens must be rejected'
  );
  assert.strictEqual(
    unsubscribeToken.signUnsubscribeToken(7, 'password_reset'),
    null,
    'required email types must not get unsubscribe tokens'
  );

  const updates = [];
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      ensureDefaultPrefs: async () => {},
      updatePrefs: async (userId, patch) => {
        updates.push({ userId, patch });
        return patch;
      },
    },
  };
  const routePath = require.resolve('../routes/email-unsubscribe');
  delete require.cache[routePath];
  const unsubscribeRoute = require('../routes/email-unsubscribe');
  const layer = unsubscribeRoute.stack.find((item) => item.route && item.route.path === '/unsubscribe');
  const handler = layer.route.stack.find((item) => item.method === 'get').handle;

  function makeRes() {
    return {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      send(body) {
        this.body = body;
        return this;
      },
    };
  }

  const tamperedRes = makeRes();
  await handler({ query: { token: signedToken, type: 'password_reset' } }, tamperedRes);
  assert.strictEqual(tamperedRes.statusCode, 400, 'tampered unsubscribe type should be rejected');
  assert.deepStrictEqual(updates, [], 'tampered unsubscribe must not update preferences');

  const validRes = makeRes();
  await handler({ query: { token: signedToken, type: 'booking_confirmation' } }, validRes);
  assert.strictEqual(validRes.statusCode, 200, 'signed unsubscribe type should succeed');
  assert.deepStrictEqual(
    updates,
    [{ userId: 7, patch: { booking_confirmation: false } }],
    'valid unsubscribe should only update the signed type'
  );

  const bookingHistory = freshRequire('../routes/booking-history');
  assert.strictEqual(
    bookingHistory.isEditableHistoryFlightStatus('confirmed'),
    false,
    'confirmed bookings must not be editable through booking history'
  );
  assert.strictEqual(
    bookingHistory.isEditableHistoryFlightStatus('completed'),
    true,
    'completed bookings should remain editable through booking history'
  );
  const historyPatch = bookingHistory.buildHistoryFlightSyncPatch({
    body: {
      aircraft_charge_amount: 100,
      instruction_charge_amount: 50,
    },
    hStart: 100,
    hEnd: 101,
    tStart: null,
    tEnd: null,
    dualHrs: 1,
    effectiveLessonType: 'Dual Instruction',
    userId: 7,
  });
  assert.ok(
    !Object.prototype.hasOwnProperty.call(historyPatch, 'flight_date'),
    'booking-history edits must not pass flight_date unless explicitly changed'
  );
  const datedHistoryPatch = bookingHistory.buildHistoryFlightSyncPatch({
    body: { flight_date: '2026-09-07' },
    hStart: 100,
    hEnd: 101,
    tStart: null,
    tEnd: null,
    dualHrs: 1,
    effectiveLessonType: 'Dual Instruction',
    userId: 7,
  });
  assert.strictEqual(datedHistoryPatch.flight_date, '2026-09-07', 'explicit flight_date should be forwarded');

  const { preserveLocalTimeOnDate } = freshRequire('../lib/sync-flight-record');
  const { timeHmFromDate } = freshRequire('../lib/school-timezone');
  const originalStart = '2026-09-06T17:00:00.000Z';
  const originalEnd = '2026-09-06T19:30:00.000Z';
  const moved = preserveLocalTimeOnDate(originalStart, originalEnd, '2026-09-07');
  assert.strictEqual(
    timeHmFromDate(moved.startTime),
    timeHmFromDate(originalStart),
    'date moves should preserve school-local start time'
  );
  assert.strictEqual(
    moved.endTime.getTime() - moved.startTime.getTime(),
    new Date(originalEnd).getTime() - new Date(originalStart).getTime(),
    'date moves should preserve booking duration'
  );

  const profileRoute = freshRequire('../routes/profile');
  const cfiGetIndex = profileRoute.stack.findIndex((item) => item.route?.path === '/cfi-profile' && item.route.methods.get);
  const cfiPutIndex = profileRoute.stack.findIndex((item) => item.route?.path === '/cfi-profile' && item.route.methods.put);
  const catchAllIndex = profileRoute.stack.findIndex((item) => !item.route);
  assert.ok(cfiGetIndex >= 0, 'profile router should expose legacy CFI profile GET');
  assert.ok(cfiPutIndex >= 0, 'profile router should expose legacy CFI profile PUT');
  assert.ok(cfiGetIndex < catchAllIndex && cfiPutIndex < catchAllIndex, 'CFI profile routes must be before catch-all');

  if (realDbCache) require.cache[dbPath] = realDbCache;
  else delete require.cache[dbPath];
  delete require.cache[routePath];
  if (realPoolCache) require.cache[poolPath] = realPoolCache;
  else delete require.cache[poolPath];
}

run()
  .then(() => {
    console.log('critical bug regression checks passed');
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
