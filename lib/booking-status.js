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
  'lesson_type',
  'booking_type',
];

function bookingBlocksSchedule(status) {
  return !NON_BLOCKING_STATUSES.has(String(status || '').toLowerCase());
}

function isHistoricalBookingStatus(status) {
  return HISTORICAL_STATUSES.has(String(status || '').toLowerCase());
}

function needsScheduleConflictCheck({ previousStatus, nextStatus, scheduleChanged }) {
  const willBlockSchedule = bookingBlocksSchedule(nextStatus);
  const wasBlockingSchedule = bookingBlocksSchedule(previousStatus);
  return willBlockSchedule && (Boolean(scheduleChanged) || !wasBlockingSchedule);
}

function restrictedHistoricalUpdateFields(body = {}) {
  return HISTORICAL_RESTRICTED_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(body, field));
}

module.exports = {
  bookingBlocksSchedule,
  isHistoricalBookingStatus,
  needsScheduleConflictCheck,
  restrictedHistoricalUpdateFields,
};
