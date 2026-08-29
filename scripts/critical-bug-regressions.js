'use strict';

const assert = require('assert');
const {
  bookingStatusBlocksSchedule,
  bookingUpdateNeedsConflictCheck,
} = require('../lib/booking-status');

function testBookingUpdateConflictDecision() {
  assert.strictEqual(bookingStatusBlocksSchedule('confirmed'), true, 'confirmed bookings block the schedule');
  assert.strictEqual(bookingStatusBlocksSchedule('cancelled'), false, 'cancelled bookings do not block the schedule');
  assert.strictEqual(bookingStatusBlocksSchedule('completed'), false, 'completed bookings do not block the schedule');

  assert.strictEqual(
    bookingUpdateNeedsConflictCheck({
      currentStatus: 'confirmed',
      nextStatus: 'confirmed',
      scheduleChanged: true,
    }),
    true,
    'active booking reschedules must check conflicts, including admin edits'
  );

  assert.strictEqual(
    bookingUpdateNeedsConflictCheck({
      currentStatus: 'cancelled',
      nextStatus: 'confirmed',
      scheduleChanged: false,
    }),
    true,
    'reactivating a cancelled booking must check conflicts even when times are unchanged'
  );

  assert.strictEqual(
    bookingUpdateNeedsConflictCheck({
      currentStatus: 'completed',
      nextStatus: 'confirmed',
      scheduleChanged: false,
    }),
    true,
    'reactivating a completed booking must check conflicts even when times are unchanged'
  );

  assert.strictEqual(
    bookingUpdateNeedsConflictCheck({
      currentStatus: 'confirmed',
      nextStatus: 'confirmed',
      scheduleChanged: false,
    }),
    false,
    'metadata-only edits on active bookings do not need conflict checks'
  );

  assert.strictEqual(
    bookingUpdateNeedsConflictCheck({
      currentStatus: 'completed',
      nextStatus: 'completed',
      scheduleChanged: true,
    }),
    false,
    'historical edits that remain non-blocking do not need conflict checks'
  );

  assert.strictEqual(
    bookingUpdateNeedsConflictCheck({
      currentStatus: 'confirmed',
      nextStatus: 'cancelled',
      scheduleChanged: true,
    }),
    false,
    'updates that leave the schedule non-blocking do not need conflict checks'
  );
}

testBookingUpdateConflictDecision();
console.log('critical bug regression checks passed');
