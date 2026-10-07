'use strict';

const assert = require('assert');
const {
  bookingBlocksSchedule,
  shouldCheckBookingUpdateConflicts,
} = require('../lib/booking-status');
const {
  EMAIL_TYPES,
  isRequiredEmailType,
} = require('../lib/email-types');

function expectConflictCheck(name, input, expected) {
  assert.strictEqual(
    shouldCheckBookingUpdateConflicts(input),
    expected,
    name
  );
}

assert.strictEqual(bookingBlocksSchedule('confirmed'), true, 'confirmed bookings block the schedule');
assert.strictEqual(bookingBlocksSchedule('cancelled'), false, 'cancelled bookings do not block the schedule');
assert.strictEqual(bookingBlocksSchedule('completed'), false, 'completed bookings do not block the schedule');

expectConflictCheck(
  'active schedule edits must check conflicts, including owner/admin edits',
  { currentStatus: 'confirmed', nextStatus: 'confirmed', scheduleChanged: true },
  true
);
expectConflictCheck(
  'reactivating a cancelled booking must check conflicts even without a time change',
  { currentStatus: 'cancelled', nextStatus: 'confirmed', scheduleChanged: false },
  true
);
expectConflictCheck(
  'reactivating a completed booking must check conflicts even without a time change',
  { currentStatus: 'completed', nextStatus: 'confirmed', scheduleChanged: false },
  true
);
expectConflictCheck(
  'metadata-only edits on active bookings do not need conflict checks',
  { currentStatus: 'confirmed', nextStatus: 'confirmed', scheduleChanged: false },
  false
);
expectConflictCheck(
  'historical edits that remain non-blocking do not need conflict checks',
  { currentStatus: 'completed', nextStatus: 'completed', scheduleChanged: true },
  false
);
expectConflictCheck(
  'cancelling an active booking does not need a conflict check',
  { currentStatus: 'confirmed', nextStatus: 'cancelled', scheduleChanged: true },
  false
);

assert.strictEqual(isRequiredEmailType(EMAIL_TYPES.password_reset), true, 'password reset is required');
assert.strictEqual(isRequiredEmailType(EMAIL_TYPES.account_approved), true, 'account approval is required');
assert.strictEqual(isRequiredEmailType(EMAIL_TYPES.welcome), true, 'welcome email is required');
assert.strictEqual(isRequiredEmailType(EMAIL_TYPES.booking_confirmation), false, 'booking confirmation is optional');

console.log('critical bug regression tests passed');
