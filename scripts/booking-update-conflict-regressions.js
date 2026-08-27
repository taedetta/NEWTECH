'use strict';

const assert = require('assert');
const {
  bookingStatusBlocksSchedule,
  shouldCheckUpdateConflicts,
} = require('../routes/bookings-routes');

assert.strictEqual(bookingStatusBlocksSchedule('confirmed'), true);
assert.strictEqual(bookingStatusBlocksSchedule('completed'), false);
assert.strictEqual(bookingStatusBlocksSchedule('cancelled'), false);

assert.strictEqual(
  shouldCheckUpdateConflicts({
    scheduleChanged: true,
    currentStatus: 'confirmed',
    nextStatus: 'confirmed',
  }),
  true,
  'active booking reschedules must run conflict checks, including owner/admin edits'
);

assert.strictEqual(
  shouldCheckUpdateConflicts({
    scheduleChanged: false,
    currentStatus: 'completed',
    nextStatus: 'confirmed',
  }),
  true,
  'reactivating a historical booking must check conflicts even when times are unchanged'
);

assert.strictEqual(
  shouldCheckUpdateConflicts({
    scheduleChanged: true,
    currentStatus: 'completed',
    nextStatus: 'completed',
  }),
  false,
  'historical edits should not conflict-check non-blocking completed bookings'
);

assert.strictEqual(
  shouldCheckUpdateConflicts({
    scheduleChanged: true,
    currentStatus: 'confirmed',
    nextStatus: 'cancelled',
  }),
  false,
  'updates ending in a non-blocking status do not need schedule conflict checks'
);

console.log('booking update conflict regressions passed');
