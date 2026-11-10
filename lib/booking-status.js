'use strict';

const NON_BLOCKING_STATUSES = new Set(['cancelled', 'completed']);
const HISTORICAL_STATUSES = new Set(['cancelled', 'completed']);
const HISTORICAL_RESTRICTED_FIELDS = [
  'student_id',
  'instructor_id',
  'aircraft_id',
  'start_time',
  'end_time',
  'status',
  'booking_type',
  'lesson_type',
];

function normalizeStatus(status) {
  return String(status || '').toLowerCase();
}

function bookingBlocksSchedule(status) {
  return !NON_BLOCKING_STATUSES.has(normalizeStatus(status));
}

function isHistoricalStatus(status) {
  return HISTORICAL_STATUSES.has(normalizeStatus(status));
}

function shouldCheckScheduleConflicts({ currentStatus, nextStatus, scheduleChanged }) {
  const currentBlocks = bookingBlocksSchedule(currentStatus);
  const nextBlocks = bookingBlocksSchedule(nextStatus !== undefined ? nextStatus : currentStatus);
  return nextBlocks && (!!scheduleChanged || !currentBlocks);
}

function historicalBookingEditRestriction({ userRole, isAdmin, bookingStatus, body = {} }) {
  if (isAdmin || !isHistoricalStatus(bookingStatus)) return null;

  if (userRole === 'student' || userRole === 'renter') {
    return 'Completed or cancelled bookings can only be edited by staff';
  }

  const restrictedFields = HISTORICAL_RESTRICTED_FIELDS.filter((field) =>
    Object.prototype.hasOwnProperty.call(body, field)
  );
  if (restrictedFields.length > 0) {
    return 'Only admins can change historical booking schedule, status, or billing fields';
  }

  return null;
}

module.exports = {
  bookingBlocksSchedule,
  isHistoricalStatus,
  shouldCheckScheduleConflicts,
  historicalBookingEditRestriction,
};
