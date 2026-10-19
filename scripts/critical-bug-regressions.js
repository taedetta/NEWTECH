'use strict';

const assert = require('assert');
const { bookingsOverlap } = require('../lib/booking-overlap');
const {
  statusBlocksSchedule,
  shouldCheckBookingConflicts,
} = require('../lib/booking-status');

function testBookingStatusConflictDecisions() {
  assert.strictEqual(statusBlocksSchedule('confirmed'), true, 'confirmed bookings block the schedule');
  assert.strictEqual(statusBlocksSchedule('completed'), false, 'completed bookings do not block the schedule');
  assert.strictEqual(statusBlocksSchedule('cancelled'), false, 'cancelled bookings do not block the schedule');

  assert.strictEqual(
    shouldCheckBookingConflicts({ existingStatus: 'confirmed', nextStatus: 'confirmed', scheduleChanged: true }),
    true,
    'active booking schedule edits must check conflicts'
  );
  assert.strictEqual(
    shouldCheckBookingConflicts({ existingStatus: 'confirmed', nextStatus: 'confirmed', scheduleChanged: false }),
    false,
    'active metadata-only edits do not need a schedule conflict check'
  );
  assert.strictEqual(
    shouldCheckBookingConflicts({ existingStatus: 'completed', nextStatus: 'completed', scheduleChanged: true }),
    false,
    'historical edits that remain non-blocking should not check active schedule conflicts'
  );
  assert.strictEqual(
    shouldCheckBookingConflicts({ existingStatus: 'completed', nextStatus: 'confirmed', scheduleChanged: false }),
    true,
    'reactivating a completed booking must check conflicts even if the time did not change'
  );
  assert.strictEqual(
    shouldCheckBookingConflicts({ existingStatus: 'cancelled', nextStatus: 'confirmed', scheduleChanged: true }),
    true,
    'reactivating a cancelled booking with schedule changes must check conflicts'
  );
  assert.strictEqual(
    shouldCheckBookingConflicts({ existingStatus: 'confirmed', nextStatus: 'completed', scheduleChanged: true }),
    false,
    'changing an active booking into a completed booking does not create an active schedule conflict'
  );
}

function testHalfOpenBookingOverlaps() {
  assert.strictEqual(
    bookingsOverlap('2026-10-19T13:00:00Z', '2026-10-19T14:00:00Z', '2026-10-19T14:00:00Z', '2026-10-19T15:00:00Z'),
    false,
    'back-to-back bookings should not overlap'
  );
  assert.strictEqual(
    bookingsOverlap('2026-10-19T13:00:00Z', '2026-10-19T14:00:00Z', '2026-10-19T13:59:00Z', '2026-10-19T15:00:00Z'),
    true,
    'true time intersections should overlap'
  );
}

testBookingStatusConflictDecisions();
testHalfOpenBookingOverlaps();

console.log('critical bug regressions passed');
