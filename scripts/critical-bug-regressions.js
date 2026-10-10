'use strict';

const assert = require('assert');
const { bookingsOverlap } = require('../lib/booking-overlap');
const {
  bookingBlocksSchedule,
  bookingUpdateNeedsConflictCheck,
} = require('../lib/booking-status');

function testBookingUpdateConflictGuards() {
  assert.strictEqual(bookingBlocksSchedule('confirmed'), true);
  assert.strictEqual(bookingBlocksSchedule('cancelled'), false);
  assert.strictEqual(bookingBlocksSchedule('completed'), false);

  assert.strictEqual(
    bookingUpdateNeedsConflictCheck({
      currentStatus: 'confirmed',
      nextStatus: 'confirmed',
      scheduleChanged: true,
    }),
    true,
    'active booking schedule edits must be conflict-checked'
  );

  assert.strictEqual(
    bookingUpdateNeedsConflictCheck({
      currentStatus: 'cancelled',
      nextStatus: 'confirmed',
      scheduleChanged: false,
    }),
    true,
    'reactivating a cancelled booking must be conflict-checked even if its times did not change'
  );

  assert.strictEqual(
    bookingUpdateNeedsConflictCheck({
      currentStatus: 'completed',
      nextStatus: 'completed',
      scheduleChanged: true,
    }),
    false,
    'completed bookings do not block the active schedule'
  );

  assert.strictEqual(
    bookingUpdateNeedsConflictCheck({
      currentStatus: 'confirmed',
      nextStatus: 'cancelled',
      scheduleChanged: true,
    }),
    false,
    'updates that leave the booking non-blocking do not need active schedule conflicts'
  );
}

function testHalfOpenBookingOverlaps() {
  assert.strictEqual(
    bookingsOverlap('2026-10-10T13:00:00Z', '2026-10-10T14:00:00Z', '2026-10-10T14:00:00Z', '2026-10-10T15:00:00Z'),
    false,
    'back-to-back bookings should not overlap'
  );
  assert.strictEqual(
    bookingsOverlap('2026-10-10T13:00:00Z', '2026-10-10T14:00:00Z', '2026-10-10T13:59:00Z', '2026-10-10T15:00:00Z'),
    true,
    'true time overlap should conflict'
  );
}

testBookingUpdateConflictGuards();
testHalfOpenBookingOverlaps();

console.log('critical bug regression checks passed');
