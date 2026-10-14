'use strict';

const assert = require('assert');
const {
  bookingBlocksSchedule,
  bookingUpdateNeedsConflictCheck,
} = require('../lib/booking-status');

assert.strictEqual(bookingBlocksSchedule('confirmed'), true, 'confirmed bookings block the schedule');
assert.strictEqual(bookingBlocksSchedule('completed'), false, 'completed bookings do not block the schedule');
assert.strictEqual(bookingBlocksSchedule('cancelled'), false, 'cancelled bookings do not block the schedule');

assert.strictEqual(
  bookingUpdateNeedsConflictCheck({
    existingStatus: 'completed',
    resultingStatus: 'completed',
    scheduleChanged: true,
  }),
  false,
  'completed bookings that remain completed can be edited without active schedule conflicts'
);

assert.strictEqual(
  bookingUpdateNeedsConflictCheck({
    existingStatus: 'cancelled',
    resultingStatus: 'confirmed',
    scheduleChanged: false,
  }),
  true,
  'reactivating a cancelled booking must check conflicts even when the schedule fields did not change'
);

assert.strictEqual(
  bookingUpdateNeedsConflictCheck({
    existingStatus: 'completed',
    resultingStatus: 'confirmed',
    scheduleChanged: true,
  }),
  true,
  'reactivating and rescheduling a completed booking must check active schedule conflicts'
);

assert.strictEqual(
  bookingUpdateNeedsConflictCheck({
    existingStatus: 'confirmed',
    resultingStatus: 'confirmed',
    scheduleChanged: true,
  }),
  true,
  'rescheduling an active booking must check conflicts'
);

assert.strictEqual(
  bookingUpdateNeedsConflictCheck({
    existingStatus: 'confirmed',
    resultingStatus: 'cancelled',
    scheduleChanged: true,
  }),
  false,
  'updates that result in a cancelled booking do not block the active schedule'
);

console.log('booking conflict regression tests passed');
