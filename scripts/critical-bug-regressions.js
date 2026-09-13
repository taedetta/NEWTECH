'use strict';

const assert = require('assert');

const {
  canEditHistoricalBooking,
  isScheduleBlockingStatus,
  shouldCheckBookingConflict,
} = require('../lib/booking-status');

function testBookingConflictDecisions() {
  assert.strictEqual(isScheduleBlockingStatus('confirmed'), true);
  assert.strictEqual(isScheduleBlockingStatus('completed'), false);
  assert.strictEqual(isScheduleBlockingStatus('cancelled'), false);

  assert.strictEqual(
    shouldCheckBookingConflict({
      previousStatus: 'confirmed',
      nextStatus: 'confirmed',
      scheduleChanged: true,
    }),
    true,
    'rescheduling a confirmed booking must check conflicts, including admin edits'
  );

  assert.strictEqual(
    shouldCheckBookingConflict({
      previousStatus: 'completed',
      nextStatus: 'confirmed',
      scheduleChanged: false,
    }),
    true,
    'reactivating a historical booking must check conflicts even if times did not change'
  );

  assert.strictEqual(
    shouldCheckBookingConflict({
      previousStatus: 'completed',
      nextStatus: 'completed',
      scheduleChanged: true,
    }),
    false,
    'editing a completed booking that remains non-blocking should not conflict with active schedule'
  );

  assert.strictEqual(
    shouldCheckBookingConflict({
      previousStatus: 'confirmed',
      nextStatus: 'cancelled',
      scheduleChanged: true,
    }),
    false,
    'cancelling a booking should not require schedule conflict checks'
  );
}

function testHistoricalEditPermissions() {
  const completedBooking = { status: 'completed', student_id: 11, instructor_id: 22 };
  const cancelledBooking = { status: 'cancelled', student_id: 11, instructor_id: 22 };

  assert.strictEqual(
    canEditHistoricalBooking({ id: 11, role: 'student' }, completedBooking),
    false,
    'students must not edit completed bookings through generic booking updates'
  );

  assert.strictEqual(
    canEditHistoricalBooking({ id: 11, role: 'renter' }, cancelledBooking),
    false,
    'renters must not edit cancelled bookings through generic booking updates'
  );

  assert.strictEqual(
    canEditHistoricalBooking({ id: 22, role: 'instructor' }, completedBooking),
    true,
    'assigned instructors retain historical correction access'
  );

  assert.strictEqual(
    canEditHistoricalBooking({ id: 99, role: 'admin' }, completedBooking),
    true,
    'admins retain historical correction access'
  );
}

testBookingConflictDecisions();
testHistoricalEditPermissions();

console.log('critical bug regression checks passed');
