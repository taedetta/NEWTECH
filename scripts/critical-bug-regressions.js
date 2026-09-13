'use strict';

const assert = require('assert');

const {
  canEditHistoricalBooking,
  isScheduleBlockingStatus,
  shouldCheckBookingConflict,
} = require('../lib/booking-status');
const { buildFlightHistorySyncPatch } = require('../lib/booking-history-edits');
const { appendUnsubscribeFooter } = require('../lib/notification-footer');
const { signUnsubscribeToken, verifyUnsubscribeToken } = require('../lib/unsubscribe-token');
const { EMAIL_TYPES, isRequiredEmailType } = require('../lib/email-types');
const { movedBookingTimes } = require('../lib/sync-flight-record');
const { calendarDateFromDate, timeHmFromDate } = require('../lib/school-timezone');

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

function testBookingHistoryPatchSafety() {
  const booking = {
    start_time: '2026-06-01T18:30:00.000Z',
    end_time: '2026-06-01T20:00:00.000Z',
    booking_type: 'dual',
    lesson_type: 'Dual Instruction',
    instructor_id: 22,
  };

  const instructorPatch = buildFlightHistorySyncPatch({
    role: 'instructor',
    booking,
    submittedBy: 22,
    body: {
      flight_date: '2026-06-01',
      hobbs_start: 10,
      hobbs_end: 11,
      lesson_type: 'Discovery Flight',
      aircraft_charge_amount: 0,
      instruction_charge_amount: 0,
    },
  });

  assert.strictEqual(
    instructorPatch.flight_date,
    undefined,
    'same-date history edits must not request a booking timestamp rewrite'
  );
  assert.strictEqual(
    instructorPatch.lesson_type,
    undefined,
    'instructors must not rebill completed flights by changing lesson type'
  );
  assert.strictEqual(
    instructorPatch.aircraft_charge_amount,
    undefined,
    'instructors must not override aircraft charges'
  );
  assert.strictEqual(
    instructorPatch.instruction_charge_amount,
    undefined,
    'instructors must not override instruction charges'
  );

  const adminPatch = buildFlightHistorySyncPatch({
    role: 'admin',
    booking,
    submittedBy: 99,
    body: {
      flight_date: '2026-06-08',
      hobbs_start: 10,
      hobbs_end: 11,
      lesson_type: 'Discovery Flight',
      aircraft_charge_amount: 185,
    },
  });
  assert.strictEqual(adminPatch.flight_date, '2026-06-08');
  assert.strictEqual(adminPatch.lesson_type, 'Discovery Flight');
  assert.strictEqual(adminPatch.aircraft_charge_amount, 185);
}

function testMovedBookingTimesPreserveLocalTimeAndDuration() {
  const booking = {
    start_time: '2026-06-01T18:30:00.000Z',
    end_time: '2026-06-01T20:00:00.000Z',
  };
  const moved = movedBookingTimes(booking, '2026-06-08');
  assert(moved, 'valid booking times should produce moved timestamps');
  assert.strictEqual(calendarDateFromDate(moved.startTime), '2026-06-08');
  assert.strictEqual(timeHmFromDate(moved.startTime), timeHmFromDate(new Date(booking.start_time)));
  assert.strictEqual(moved.endTime.getTime() - moved.startTime.getTime(), 90 * 60 * 1000);
}

function testUnsubscribeTokenBindingAndFooters() {
  const reminderToken = signUnsubscribeToken(7, EMAIL_TYPES.preflight_reminder);
  const verified = verifyUnsubscribeToken(reminderToken);
  assert.strictEqual(verified.userId, 7);
  assert.strictEqual(verified.type, EMAIL_TYPES.preflight_reminder);
  assert.notStrictEqual(verified.type, EMAIL_TYPES.password_reset);

  assert.strictEqual(isRequiredEmailType(EMAIL_TYPES.password_reset), true);
  assert.strictEqual(isRequiredEmailType(EMAIL_TYPES.preflight_reminder), false);

  const textOnly = appendUnsubscribeFooter(null, 'Body text', 7, EMAIL_TYPES.endorsement_expiry);
  assert.strictEqual(textOnly.html, null);
  assert.match(textOnly.text, /Unsubscribe from Endorsement expiry alerts/);

  const required = appendUnsubscribeFooter('<p>Reset</p>', 'Reset', 7, EMAIL_TYPES.password_reset);
  assert.strictEqual(required.html, '<p>Reset</p>');
  assert.strictEqual(required.text, 'Reset');
}

testBookingConflictDecisions();
testHistoricalEditPermissions();
testBookingHistoryPatchSafety();
testMovedBookingTimesPreserveLocalTimeAndDuration();
testUnsubscribeTokenBindingAndFooters();

console.log('critical bug regression checks passed');
