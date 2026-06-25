'use strict';

const assert = require('assert');
const { dateOnly, shiftBookingDatePreservingTime } = require('../lib/booking-date-shift');
const { canReassignEnrollmentInstructor } = require('../lib/training-permissions');

function testDateOnlyDetectsSameDate() {
  assert.strictEqual(
    dateOnly('2026-01-15'),
    dateOnly('2026-01-15T14:30:00.000Z'),
    'same-date billing/history edits must compare equal and skip schedule rewrites'
  );
}

function testDateShiftPreservesTimeWhenDateChanges() {
  const shifted = shiftBookingDatePreservingTime({
    flightDate: '2026-01-16',
    currentStartTime: '2026-01-15T14:30:00.000Z',
    currentEndTime: '2026-01-15T16:00:00.000Z',
  });
  assert.strictEqual(shifted.startTime.toISOString(), '2026-01-16T14:30:00.000Z');
  assert.strictEqual(shifted.endTime.toISOString(), '2026-01-16T16:00:00.000Z');
}

function testEnrollmentReassignmentPermissions() {
  const enrollment = { id: 10, instructor_id: 5 };

  assert.strictEqual(canReassignEnrollmentInstructor({ id: 1, role: 'owner' }, enrollment), true);
  assert.strictEqual(canReassignEnrollmentInstructor({ id: 2, role: 'admin' }, enrollment), true);
  assert.strictEqual(canReassignEnrollmentInstructor({ id: 5, role: 'instructor' }, enrollment), true);
  assert.strictEqual(canReassignEnrollmentInstructor({ id: 6, role: 'instructor' }, enrollment), false);
  assert.strictEqual(canReassignEnrollmentInstructor({ id: 5, role: 'student' }, enrollment), false);
  assert.strictEqual(canReassignEnrollmentInstructor({ id: 5, role: 'instructor' }, { id: 11, instructor_id: null }), false);
}

(async () => {
  testDateOnlyDetectsSameDate();
  testDateShiftPreservesTimeWhenDateChanges();
  testEnrollmentReassignmentPermissions();
  console.log('critical regression tests passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
