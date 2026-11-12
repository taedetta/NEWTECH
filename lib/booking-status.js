'use strict';

const NON_SCHEDULE_BLOCKING_STATUSES = new Set(['cancelled', 'completed']);
const HISTORICAL_PROTECTED_FIELDS = [
  'student_id',
  'instructor_id',
  'aircraft_id',
  'start_time',
  'end_time',
  'lesson_type',
  'status',
  'booking_type',
];

function normalizeStatus(status) {
  return String(status || '').toLowerCase();
}

function bookingBlocksSchedule(status) {
  return !NON_SCHEDULE_BLOCKING_STATUSES.has(normalizeStatus(status));
}

function isHistoricalBookingStatus(status) {
  return !bookingBlocksSchedule(status);
}

function shouldRunScheduleConflictCheck({ currentStatus, nextStatus, scheduleChanged }) {
  const resultingBlocksSchedule = bookingBlocksSchedule(nextStatus ?? currentStatus);
  const previouslyBlockedSchedule = bookingBlocksSchedule(currentStatus);
  return resultingBlocksSchedule && (Boolean(scheduleChanged) || !previouslyBlockedSchedule);
}

function nonAdminHistoricalEditError({ isAdmin, userRole, isAssignedInstructor, isHistoricalBooking, body = {} }) {
  if (!isHistoricalBooking || isAdmin) return null;
  if (!(userRole === 'instructor' && isAssignedInstructor)) {
    return 'Completed or cancelled bookings can only be edited by admins';
  }
  const protectedAttempt = HISTORICAL_PROTECTED_FIELDS.find((field) => Object.prototype.hasOwnProperty.call(body, field));
  if (protectedAttempt) {
    return 'Only notes can be updated on completed or cancelled bookings';
  }
  return null;
}

module.exports = {
  bookingBlocksSchedule,
  isHistoricalBookingStatus,
  shouldRunScheduleConflictCheck,
  nonAdminHistoricalEditError,
};
