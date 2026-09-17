'use strict';

const assert = require('assert');
const { bookingsOverlap } = require('../lib/booking-overlap');
const {
  canEditHistoricalBooking,
  isHistoricalBookingStatus,
  shouldSyncCompletedBookingSideEffects,
} = require('../lib/booking-status');
const { buildFlightHistorySyncPatch } = require('../lib/booking-history-edits');
const { resolveInstructorHoursRates } = require('../lib/instructor-hours-edits');
const { signUnsubscribeToken, verifyUnsubscribeToken } = require('../lib/unsubscribe-token');
const { EMAIL_TYPES, isRequiredEmailType } = require('../lib/email-types');
const { movedBookingTimes } = require('../lib/sync-flight-record');
const { calendarDateFromDate, timeHmFromDate } = require('../lib/school-timezone');

function user(role, id) {
  return { role, id };
}

function booking(status, overrides = {}) {
  return {
    status,
    student_id: 10,
    instructor_id: 20,
    ...overrides,
  };
}

function runBookingStatusTests() {
  assert.strictEqual(isHistoricalBookingStatus('completed'), true);
  assert.strictEqual(isHistoricalBookingStatus('cancelled'), true);
  assert.strictEqual(isHistoricalBookingStatus('confirmed'), false);

  const completed = booking('completed');
  const cancelled = booking('cancelled');

  assert.strictEqual(canEditHistoricalBooking(user('student', 10), completed), false);
  assert.strictEqual(canEditHistoricalBooking(user('renter', 10), completed), false);
  assert.strictEqual(canEditHistoricalBooking(user('maintenance', 99), completed), false);
  assert.strictEqual(canEditHistoricalBooking(user('instructor', 21), completed), false);
  assert.strictEqual(canEditHistoricalBooking(user('instructor', 20), completed), true);
  assert.strictEqual(canEditHistoricalBooking(user('admin', 99), completed), true);
  assert.strictEqual(canEditHistoricalBooking(user('owner', 99), cancelled), true);

  // Non-historical bookings continue through the route's normal access checks.
  assert.strictEqual(canEditHistoricalBooking(user('student', 10), booking('confirmed')), true);

  assert.strictEqual(
    shouldSyncCompletedBookingSideEffects({
      nextStatus: 'completed',
      scheduleChanged: false,
      lessonTypeChanged: false,
      statusChanged: false,
      bookingTypeChanged: false,
    }),
    false
  );
  assert.strictEqual(
    shouldSyncCompletedBookingSideEffects({
      nextStatus: 'completed',
      scheduleChanged: false,
      lessonTypeChanged: true,
      statusChanged: false,
      bookingTypeChanged: false,
    }),
    true
  );
}

function runOverlapTests() {
  const firstStart = '2026-09-17T17:00:00.000Z';
  const firstEnd = '2026-09-17T18:00:00.000Z';

  assert.strictEqual(bookingsOverlap(firstStart, firstEnd, '2026-09-17T18:00:00.000Z', '2026-09-17T19:00:00.000Z'), false);
  assert.strictEqual(bookingsOverlap(firstStart, firstEnd, '2026-09-17T17:30:00.000Z', '2026-09-17T18:30:00.000Z'), true);
}

function runBookingHistoryPatchTests() {
  const completed = {
    status: 'completed',
    start_time: '2026-06-01T18:30:00.000Z',
    end_time: '2026-06-01T20:00:00.000Z',
    booking_type: 'dual',
    lesson_type: 'Dual Instruction',
    instructor_id: 20,
  };

  const instructorPatch = buildFlightHistorySyncPatch({
    role: 'instructor',
    booking: completed,
    submittedBy: 20,
    body: {
      flight_date: '2026-06-01',
      hobbs_start: 10,
      hobbs_end: 11,
      lesson_type: 'Discovery Flight',
      aircraft_charge_amount: 0,
      instruction_charge_amount: 0,
    },
  });

  assert.strictEqual(instructorPatch.flight_date, undefined);
  assert.strictEqual(instructorPatch.lesson_type, undefined);
  assert.strictEqual(instructorPatch.aircraft_charge_amount, undefined);
  assert.strictEqual(instructorPatch.instruction_charge_amount, undefined);

  const adminPatch = buildFlightHistorySyncPatch({
    role: 'admin',
    booking: completed,
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

function runMovedBookingTimesTests() {
  const completed = {
    start_time: '2026-06-01T18:30:00.000Z',
    end_time: '2026-06-01T20:00:00.000Z',
  };
  const moved = movedBookingTimes(completed, '2026-06-08');
  assert(moved);
  assert.strictEqual(calendarDateFromDate(moved.startTime), '2026-06-08');
  assert.strictEqual(timeHmFromDate(moved.startTime), timeHmFromDate(new Date(completed.start_time)));
  assert.strictEqual(moved.endTime.getTime() - moved.startTime.getTime(), 90 * 60 * 1000);
}

function runInstructorHoursRateTests() {
  const row = { aircraft_rate: 150, instructor_rate: 80 };
  const body = { aircraft_rate: 1, instructor_rate: 2 };

  assert.deepStrictEqual(
    resolveInstructorHoursRates({ role: 'instructor', row, body }),
    { aircraftRate: 150, instructorRate: 80 }
  );
  assert.deepStrictEqual(
    resolveInstructorHoursRates({ role: 'admin', row, body }),
    { aircraftRate: 1, instructorRate: 2 }
  );
}

function runUnsubscribeTests() {
  const token = signUnsubscribeToken(7, EMAIL_TYPES.preflight_reminder);
  const verified = verifyUnsubscribeToken(token);
  assert.strictEqual(verified.userId, 7);
  assert.strictEqual(verified.type, EMAIL_TYPES.preflight_reminder);
  assert.notStrictEqual(verified.type, EMAIL_TYPES.password_reset);

  assert.strictEqual(isRequiredEmailType(EMAIL_TYPES.password_reset), true);
  assert.strictEqual(isRequiredEmailType(EMAIL_TYPES.account_approved), true);
  assert.strictEqual(isRequiredEmailType(EMAIL_TYPES.preflight_reminder), false);
}

runBookingStatusTests();
runOverlapTests();
runBookingHistoryPatchTests();
runMovedBookingTimesTests();
runInstructorHoursRateTests();
runUnsubscribeTests();

console.log('critical bug regression checks passed');
