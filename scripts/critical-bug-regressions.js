'use strict';

const assert = require('assert');
const { bookingsOverlap, shouldCheckBookingConflict } = require('../lib/booking-overlap');
const { canEditHistoricalBooking } = require('../lib/booking-permissions');

function testBookingOverlapBoundaries() {
  assert.strictEqual(
    bookingsOverlap('2026-09-07T17:00:00Z', '2026-09-07T18:00:00Z', '2026-09-07T18:00:00Z', '2026-09-07T19:00:00Z'),
    false,
    'back-to-back bookings should not overlap'
  );
  assert.strictEqual(
    bookingsOverlap('2026-09-07T17:00:00Z', '2026-09-07T18:00:00Z', '2026-09-07T17:59:00Z', '2026-09-07T19:00:00Z'),
    true,
    'true time overlaps must still be detected'
  );
}

function testBookingConflictPredicate() {
  assert.strictEqual(
    shouldCheckBookingConflict({ previousStatus: 'confirmed', nextStatus: 'confirmed', scheduleChanged: true }),
    true,
    'confirmed booking reschedules must be conflict-checked'
  );
  assert.strictEqual(
    shouldCheckBookingConflict({ previousStatus: 'completed', nextStatus: 'confirmed', scheduleChanged: false }),
    true,
    'reactivating a historical booking must be conflict-checked'
  );
  assert.strictEqual(
    shouldCheckBookingConflict({ previousStatus: 'completed', nextStatus: 'completed', scheduleChanged: true }),
    false,
    'historical corrections that remain historical should not block on active schedule conflicts'
  );
}

function testHistoricalBookingPermissions() {
  const completedDual = { status: 'completed', student_id: 101, instructor_id: 202 };

  assert.strictEqual(
    canEditHistoricalBooking({ role: 'student', id: 101 }, completedDual),
    false,
    'students must not be able to edit completed booking records through generic booking PUT'
  );
  assert.strictEqual(
    canEditHistoricalBooking({ role: 'renter', id: 101 }, completedDual),
    false,
    'renters must not be able to edit completed booking records through generic booking PUT'
  );
  assert.strictEqual(
    canEditHistoricalBooking({ role: 'instructor', id: 202 }, completedDual),
    true,
    'assigned instructors can still correct their completed booking records'
  );
  assert.strictEqual(
    canEditHistoricalBooking({ role: 'admin', id: 303 }, completedDual),
    true,
    'admins can still correct completed booking records'
  );
}

testBookingOverlapBoundaries();
testBookingConflictPredicate();
testHistoricalBookingPermissions();

console.log('critical bug regressions passed');
