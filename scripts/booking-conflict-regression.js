'use strict';

const assert = require('assert');
const {
  bookingBlocksSchedule,
  shouldCheckScheduleConflicts,
} = require('../lib/booking-conflict-policy');

assert.strictEqual(bookingBlocksSchedule('confirmed'), true);
assert.strictEqual(bookingBlocksSchedule('cancelled'), false);
assert.strictEqual(bookingBlocksSchedule('completed'), false);

assert.strictEqual(
  shouldCheckScheduleConflicts({
    existingStatus: 'confirmed',
    effectiveStatus: 'confirmed',
    scheduleChanged: true,
  }),
  true,
  'active booking reschedules must check conflicts, including admin/owner edits'
);

assert.strictEqual(
  shouldCheckScheduleConflicts({
    existingStatus: 'completed',
    effectiveStatus: 'completed',
    scheduleChanged: true,
  }),
  false,
  'completed bookings that remain non-blocking can be edited without schedule conflicts'
);

assert.strictEqual(
  shouldCheckScheduleConflicts({
    existingStatus: 'cancelled',
    effectiveStatus: 'confirmed',
    scheduleChanged: false,
  }),
  true,
  'reactivating a non-blocking booking must check conflicts even if times are unchanged'
);

assert.strictEqual(
  shouldCheckScheduleConflicts({
    existingStatus: 'confirmed',
    effectiveStatus: 'cancelled',
    scheduleChanged: true,
  }),
  false,
  'bookings saved as non-blocking do not need schedule conflict checks'
);

console.log('booking conflict regression checks passed');
