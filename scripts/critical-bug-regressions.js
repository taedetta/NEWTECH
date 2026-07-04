'use strict';

const assert = require('assert');

async function testRequiredPasswordResetEmail() {
  const dbPrefsPath = require.resolve('../db/notification-prefs');
  require.cache[dbPrefsPath] = {
    id: dbPrefsPath,
    filename: dbPrefsPath,
    loaded: true,
    exports: {
      getPrefs: async () => ({
        email_all_off: true,
        password_reset: false,
        booking_confirmation: false,
      }),
    },
  };

  const {
    EMAIL_TYPES,
    getPreferenceCatalog,
    appendUnsubscribeFooter,
    shouldSendEmail,
    isRequiredEmailType,
  } = require('../lib/notification-prefs');
  const { buildUnsubscribeUrl } = require('../lib/unsubscribe-token');

  assert.strictEqual(isRequiredEmailType(EMAIL_TYPES.password_reset), true);
  assert.strictEqual(await shouldSendEmail(123, EMAIL_TYPES.password_reset), true);
  assert.strictEqual(await shouldSendEmail(123, EMAIL_TYPES.booking_confirmation), false);

  const catalogTypes = getPreferenceCatalog('student', false).flatMap((cat) => cat.types.map((type) => type.key));
  assert.ok(!catalogTypes.includes(EMAIL_TYPES.password_reset), 'password_reset must not be user-toggleable');

  const html = '<html><body>Reset your password</body></html>';
  const text = 'Reset your password';
  assert.deepStrictEqual(
    appendUnsubscribeFooter(html, text, 123, EMAIL_TYPES.password_reset),
    { html, text },
    'required emails must not include unsubscribe footer'
  );
  assert.ok(
    buildUnsubscribeUrl(123, EMAIL_TYPES.password_reset).includes('type=all'),
    'required email types must not generate type-specific unsubscribe URLs'
  );
}

function testBookingReactivationConflictPolicy() {
  const { getBookingUpdateConflictPolicy } = require('../lib/booking-update-policy');

  assert.deepStrictEqual(
    getBookingUpdateConflictPolicy({
      currentStatus: 'completed',
      nextStatus: 'confirmed',
      scheduleChanged: false,
      skipForHistoricalEdit: true,
    }),
    {
      activatesBlockingStatus: true,
      skipConflictCheck: false,
      needsConflictCheck: true,
    },
    'reactivating a historical booking must run conflict checks even when times are unchanged'
  );

  assert.strictEqual(
    getBookingUpdateConflictPolicy({
      currentStatus: 'cancelled',
      nextStatus: 'cancelled',
      scheduleChanged: true,
      skipForHistoricalEdit: true,
    }).needsConflictCheck,
    false,
    'historical bookings that remain non-blocking keep the historical edit bypass'
  );

  assert.strictEqual(
    getBookingUpdateConflictPolicy({
      currentStatus: 'confirmed',
      nextStatus: 'confirmed',
      scheduleChanged: true,
      skipForHistoricalEdit: true,
    }).needsConflictCheck,
    false,
    'existing admin override behavior for active reschedules is unchanged'
  );
}

(async () => {
  await testRequiredPasswordResetEmail();
  testBookingReactivationConflictPolicy();
  console.log('critical bug regressions passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
