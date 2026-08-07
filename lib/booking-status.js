'use strict';

const NON_BLOCKING_BOOKING_STATUSES = new Set(['cancelled', 'completed']);

function normalizeBookingStatus(status) {
  return String(status || '').trim().toLowerCase();
}

function isScheduleBlockingStatus(status) {
  return !NON_BLOCKING_BOOKING_STATUSES.has(normalizeBookingStatus(status));
}

function shouldRunBookingConflictCheck({ currentStatus, nextStatus, scheduleChanged }) {
  const wasBlocking = isScheduleBlockingStatus(currentStatus);
  const willBlock = isScheduleBlockingStatus(nextStatus ?? currentStatus);
  return willBlock && (scheduleChanged || !wasBlocking);
}

module.exports = {
  isScheduleBlockingStatus,
  shouldRunBookingConflictCheck,
};
