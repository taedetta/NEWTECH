'use strict';

const assert = require('assert');

const {
  bookingBlocksSchedule,
  statusActivatesSchedule,
  shouldCheckBookingConflicts,
} = require('../lib/booking-status');

function runBookingReactivationRegression() {
  assert.strictEqual(bookingBlocksSchedule('confirmed'), true, 'confirmed bookings block the schedule');
  assert.strictEqual(bookingBlocksSchedule('cancelled'), false, 'cancelled bookings do not block the schedule');
  assert.strictEqual(bookingBlocksSchedule('completed'), false, 'completed bookings do not block the schedule');

  assert.strictEqual(statusActivatesSchedule('cancelled', 'confirmed'), true, 'cancelled -> confirmed activates schedule blocking');
  assert.strictEqual(statusActivatesSchedule('completed', 'confirmed'), true, 'completed -> confirmed activates schedule blocking');
  assert.strictEqual(statusActivatesSchedule('cancelled', 'completed'), false, 'non-blocking status changes stay non-blocking');

  assert.strictEqual(
    shouldCheckBookingConflicts({
      scheduleChanged: false,
      currentStatus: 'cancelled',
      nextStatus: 'confirmed',
      skipConflictCheck: true,
    }),
    true,
    'reactivating a cancelled booking must run conflict checks even for historical/admin edits'
  );

  assert.strictEqual(
    shouldCheckBookingConflicts({
      scheduleChanged: false,
      currentStatus: 'completed',
      nextStatus: 'confirmed',
      skipConflictCheck: true,
    }),
    true,
    'reactivating a completed booking must run conflict checks even for historical/admin edits'
  );

  assert.strictEqual(
    shouldCheckBookingConflicts({
      scheduleChanged: false,
      currentStatus: 'cancelled',
      nextStatus: 'cancelled',
      skipConflictCheck: true,
    }),
    false,
    'cancelled metadata edits remain conflict-free'
  );

  assert.strictEqual(
    shouldCheckBookingConflicts({
      scheduleChanged: true,
      currentStatus: 'confirmed',
      nextStatus: 'confirmed',
      skipConflictCheck: false,
    }),
    true,
    'normal active reschedules still run conflict checks'
  );
}

runBookingReactivationRegression();
console.log('critical booking regressions passed');
