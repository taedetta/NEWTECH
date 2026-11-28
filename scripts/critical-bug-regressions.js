'use strict';

const assert = require('assert');
const {
  bookingBlocksSchedule,
  shouldCheckScheduleConflicts,
} = require('../lib/booking-status');

assert.strictEqual(bookingBlocksSchedule('confirmed'), true, 'confirmed bookings block the schedule');
assert.strictEqual(bookingBlocksSchedule('completed'), false, 'completed bookings do not block the active schedule');
assert.strictEqual(bookingBlocksSchedule('cancelled'), false, 'cancelled bookings do not block the active schedule');

assert.strictEqual(
  shouldCheckScheduleConflicts({
    currentStatus: 'confirmed',
    resultingStatus: 'confirmed',
    scheduleChanged: true,
  }),
  true,
  'active admin/staff schedule edits must check conflicts'
);

assert.strictEqual(
  shouldCheckScheduleConflicts({
    currentStatus: 'cancelled',
    resultingStatus: 'confirmed',
    scheduleChanged: false,
  }),
  true,
  'reactivating a cancelled booking must check conflicts even when times/resources are unchanged'
);

assert.strictEqual(
  shouldCheckScheduleConflicts({
    currentStatus: 'completed',
    resultingStatus: 'completed',
    scheduleChanged: true,
  }),
  false,
  'true completed-history edits may skip active schedule conflicts'
);

assert.strictEqual(
  shouldCheckScheduleConflicts({
    currentStatus: 'confirmed',
    resultingStatus: 'cancelled',
    scheduleChanged: true,
  }),
  false,
  'updates that leave the booking non-blocking do not need active schedule conflicts'
);

console.log('critical bug regressions passed');
