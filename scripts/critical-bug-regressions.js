'use strict';

const assert = require('assert');
const {
  bookingStatusBlocksSchedule,
  shouldCheckBookingUpdateConflicts,
} = require('../lib/booking-status');

assert.strictEqual(bookingStatusBlocksSchedule('confirmed'), true, 'confirmed bookings block the schedule');
assert.strictEqual(bookingStatusBlocksSchedule('cancelled'), false, 'cancelled bookings do not block the schedule');
assert.strictEqual(bookingStatusBlocksSchedule('completed'), false, 'completed bookings do not block the schedule');
assert.strictEqual(bookingStatusBlocksSchedule('pending'), true, 'unknown active-like statuses block by default');

assert.strictEqual(
  shouldCheckBookingUpdateConflicts({
    currentStatus: 'confirmed',
    nextStatus: 'confirmed',
    scheduleChanged: true,
  }),
  true,
  'active booking schedule changes must check conflicts, including admin edits'
);

assert.strictEqual(
  shouldCheckBookingUpdateConflicts({
    currentStatus: 'cancelled',
    nextStatus: 'confirmed',
    scheduleChanged: false,
  }),
  true,
  'reactivating a cancelled booking must check conflicts even when time/resource fields are unchanged'
);

assert.strictEqual(
  shouldCheckBookingUpdateConflicts({
    currentStatus: 'completed',
    nextStatus: 'confirmed',
    scheduleChanged: false,
  }),
  true,
  'reactivating a completed booking must check conflicts even when time/resource fields are unchanged'
);

assert.strictEqual(
  shouldCheckBookingUpdateConflicts({
    currentStatus: 'confirmed',
    nextStatus: undefined,
    scheduleChanged: false,
  }),
  false,
  'metadata-only active booking edits do not need conflict checks'
);

assert.strictEqual(
  shouldCheckBookingUpdateConflicts({
    currentStatus: 'completed',
    nextStatus: 'completed',
    scheduleChanged: true,
  }),
  false,
  'historical booking edits that remain non-blocking do not need schedule conflicts'
);

assert.strictEqual(
  shouldCheckBookingUpdateConflicts({
    currentStatus: 'confirmed',
    nextStatus: 'cancelled',
    scheduleChanged: true,
  }),
  false,
  'updates that make a booking non-blocking do not need schedule conflicts'
);

console.log('critical bug regression checks passed');
