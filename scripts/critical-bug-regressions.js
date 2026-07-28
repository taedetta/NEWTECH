'use strict';

const assert = require('assert');
const path = require('path');

process.env.JWT_SECRET = 'critical-bug-regression-secret';
process.env.APP_URL = 'https://example.test';

async function testUnsubscribeTokensBindType() {
  const {
    signUnsubscribeToken,
    verifyUnsubscribeToken,
  } = require('../lib/unsubscribe-token');
  const { EMAIL_TYPES, isRequiredEmailType } = require('../lib/email-types');

  function routeWouldAccept(token, requestedType) {
    const verified = verifyUnsubscribeToken(token);
    return Boolean(
      verified
        && requestedType === verified.type
        && (verified.type === 'all' || (EMAIL_TYPES[verified.type] && !isRequiredEmailType(verified.type)))
    );
  }

  const bookingToken = signUnsubscribeToken(42, 'booking_confirmation');
  assert.deepStrictEqual(
    verifyUnsubscribeToken(bookingToken),
    { userId: 42, type: 'booking_confirmation' },
    'unsubscribe token should include the authorized preference type'
  );
  assert.strictEqual(
    routeWouldAccept(bookingToken, 'all'),
    false,
    'changing the type query param must not convert a per-type link into unsubscribe-all'
  );
  assert.strictEqual(
    routeWouldAccept(bookingToken, 'booking_confirmation'),
    true,
    'the originally signed preference type should remain valid'
  );

  const resetToken = signUnsubscribeToken(42, 'password_reset');
  assert.strictEqual(
    verifyUnsubscribeToken(resetToken).type,
    'all',
    'required email types should not get per-type unsubscribe tokens'
  );
}

async function testRequiredEmailTypesBypassPreferences() {
  const dbPrefsPath = path.resolve(__dirname, '../db/notification-prefs.js');
  const notificationPrefsPath = path.resolve(__dirname, '../lib/notification-prefs.js');

  delete require.cache[notificationPrefsPath];
  delete require.cache[dbPrefsPath];
  require.cache[dbPrefsPath] = {
    id: dbPrefsPath,
    filename: dbPrefsPath,
    loaded: true,
    exports: {
      getPrefs: async () => ({
        email_all_off: true,
        booking_confirmation: false,
        password_reset: false,
      }),
    },
  };

  const notificationPrefs = require('../lib/notification-prefs');
  assert.strictEqual(
    await notificationPrefs.shouldSendEmail(42, notificationPrefs.EMAIL_TYPES.password_reset),
    true,
    'password reset emails must bypass user opt-outs'
  );
  assert.strictEqual(
    await notificationPrefs.shouldSendEmail(42, notificationPrefs.EMAIL_TYPES.booking_confirmation),
    false,
    'optional email types should still honor preferences'
  );

  const resetBody = notificationPrefs.appendUnsubscribeFooter('<body>Reset</body>', 'Reset', 42, 'password_reset');
  assert.strictEqual(resetBody.html, '<body>Reset</body>', 'password reset email should not include an unsubscribe footer');
  assert.strictEqual(resetBody.text, 'Reset', 'password reset text should not include unsubscribe links');

  const bookingBody = notificationPrefs.appendUnsubscribeFooter('<body>Booking</body>', 'Booking', 42, 'booking_confirmation');
  assert.match(bookingBody.html, /Unsubscribe from this type/, 'optional email should include unsubscribe footer');

  const textOnlyBody = notificationPrefs.appendUnsubscribeFooter(null, 'Endorsement reminder', 42, 'endorsement_expiry');
  assert.strictEqual(textOnlyBody.html, null, 'text-only optional emails should not crash or synthesize HTML');
  assert.match(textOnlyBody.text, /Unsubscribe from Endorsement expiry alerts/, 'text-only optional emails should get text unsubscribe links');
}

async function testRequiredEmailTypesCannotBeMutated() {
  const dbPrefsPath = path.resolve(__dirname, '../db/notification-prefs.js');
  const notificationPrefsPath = path.resolve(__dirname, '../lib/notification-prefs.js');
  delete require.cache[notificationPrefsPath];
  delete require.cache[dbPrefsPath];

  const { updatePrefs } = require('../db/notification-prefs');
  const updateStatements = [];
  const fakeDb = {
    async query(sql) {
      if (/^UPDATE user_email_preferences SET /.test(sql)) {
        updateStatements.push(sql);
      }
      if (/^SELECT \* FROM user_email_preferences/.test(sql)) {
        return { rows: [{ user_id: 7, email_all_off: true, booking_confirmation: false, password_reset: true }] };
      }
      return { rows: [] };
    },
  };

  await updatePrefs(7, { email_all_off: true, booking_confirmation: false, password_reset: false }, fakeDb);
  assert.strictEqual(updateStatements.length, 1, 'expected one preference UPDATE');
  assert.match(updateStatements[0], /email_all_off = /, 'email_all_off should remain mutable');
  assert.match(updateStatements[0], /booking_confirmation = /, 'optional preference should remain mutable');
  assert.doesNotMatch(updateStatements[0], /password_reset = /, 'required password_reset preference must not be mutable');
}

function testBookingUpdateConflictPolicy() {
  const { shouldCheckBookingUpdateConflicts } = require('../lib/booking-update-conflicts');

  assert.strictEqual(
    shouldCheckBookingUpdateConflicts({ currentStatus: 'confirmed', nextStatus: 'confirmed', scheduleChanged: true }),
    true,
    'active booking reschedules must run conflict checks'
  );
  assert.strictEqual(
    shouldCheckBookingUpdateConflicts({ currentStatus: 'completed', nextStatus: 'confirmed', scheduleChanged: false }),
    true,
    'reactivating a historical booking must run conflict checks even without time/resource changes'
  );
  assert.strictEqual(
    shouldCheckBookingUpdateConflicts({ currentStatus: 'completed', nextStatus: 'completed', scheduleChanged: true }),
    false,
    'pure historical edits should not run schedule conflict checks'
  );
  assert.strictEqual(
    shouldCheckBookingUpdateConflicts({ currentStatus: 'confirmed', nextStatus: 'cancelled', scheduleChanged: true }),
    false,
    'updates ending in a non-blocking status do not need conflict checks'
  );
  assert.strictEqual(
    shouldCheckBookingUpdateConflicts({ currentStatus: 'confirmed', nextStatus: 'confirmed', scheduleChanged: false }),
    false,
    'metadata-only active edits do not need conflict checks'
  );
}

async function main() {
  await testUnsubscribeTokensBindType();
  await testRequiredEmailTypesBypassPreferences();
  await testRequiredEmailTypesCannotBeMutated();
  testBookingUpdateConflictPolicy();
  console.log('critical bug regressions passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
