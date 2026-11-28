'use strict';

const NON_SCHEDULE_BLOCKING_STATUSES = new Set(['cancelled', 'completed']);

function normalizeBookingStatus(status) {
  return String(status || 'confirmed').trim().toLowerCase();
}

function bookingBlocksSchedule(status) {
  return !NON_SCHEDULE_BLOCKING_STATUSES.has(normalizeBookingStatus(status));
}

function shouldCheckScheduleConflicts({ currentStatus, resultingStatus, scheduleChanged }) {
  if (!bookingBlocksSchedule(resultingStatus)) return false;
  return Boolean(scheduleChanged) || !bookingBlocksSchedule(currentStatus);
}

module.exports = {
  normalizeBookingStatus,
  bookingBlocksSchedule,
  shouldCheckScheduleConflicts,
};
