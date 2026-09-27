'use strict';

const assert = require('assert');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'critical-bug-regression-secret';

const {
  buildUnsubscribeUrl,
  verifyUnsubscribeToken,
  isUnsubscribableType,
} = require('../lib/unsubscribe-token');
const {
  appendUnsubscribeFooter,
  getPreferenceCatalog,
} = require('../lib/notification-prefs');
const {
  bookingBlocksSchedule,
  shouldCheckScheduleConflict,
} = require('../lib/booking-status');

function allCatalogKeys(catalog) {
  return catalog.flatMap((category) => category.types.map((type) => type.key));
}

{
  const url = new URL(buildUnsubscribeUrl(123, 'booking_confirmation'));
  const token = url.searchParams.get('token');
  const type = url.searchParams.get('type');

  assert.strictEqual(type, 'booking_confirmation');
  assert.deepStrictEqual(verifyUnsubscribeToken(token, type), {
    userId: 123,
    type: 'booking_confirmation',
  });
  assert.strictEqual(
    verifyUnsubscribeToken(token, 'all'),
    null,
    'unsubscribe token must not validate for a tampered type'
  );
}

{
  assert.strictEqual(isUnsubscribableType('password_reset'), false);
  assert.strictEqual(isUnsubscribableType('profile_change'), false);

  const keys = allCatalogKeys(getPreferenceCatalog('student', false));
  assert(!keys.includes('password_reset'), 'password reset must not be user-disabled');
  assert(!keys.includes('profile_change'), 'profile change alerts must not be user-disabled');
  assert(!keys.includes('account_approved'), 'account lifecycle emails must not be user-disabled');

  const required = appendUnsubscribeFooter('<p>Reset</p>', 'Reset', 42, 'password_reset');
  assert.strictEqual(required.html, '<p>Reset</p>');
  assert.strictEqual(required.text, 'Reset');

  const optionalTextOnly = appendUnsubscribeFooter(null, 'Endorsement expiring', 42, 'endorsement_expiry');
  assert.strictEqual(optionalTextOnly.html, null);
  assert(optionalTextOnly.text.includes('Unsubscribe from Endorsement expiry alerts'));
}

{
  assert.strictEqual(bookingBlocksSchedule('confirmed'), true);
  assert.strictEqual(bookingBlocksSchedule('cancelled'), false);
  assert.strictEqual(bookingBlocksSchedule('completed'), false);

  assert.strictEqual(
    shouldCheckScheduleConflict({
      oldStatus: 'confirmed',
      newStatus: 'confirmed',
      scheduleChanged: true,
    }),
    true,
    'active reschedules must be conflict checked'
  );
  assert.strictEqual(
    shouldCheckScheduleConflict({
      oldStatus: 'cancelled',
      newStatus: 'confirmed',
      scheduleChanged: false,
    }),
    true,
    'reactivating a cancelled booking must be conflict checked'
  );
  assert.strictEqual(
    shouldCheckScheduleConflict({
      oldStatus: 'completed',
      newStatus: 'completed',
      scheduleChanged: true,
    }),
    false,
    'historical edits that remain non-blocking do not need schedule conflicts'
  );
  assert.strictEqual(
    shouldCheckScheduleConflict({
      oldStatus: 'confirmed',
      newStatus: 'cancelled',
      scheduleChanged: true,
    }),
    false,
    'updates that make a booking non-blocking do not need schedule conflicts'
  );
}

console.log('critical bug regressions passed');
