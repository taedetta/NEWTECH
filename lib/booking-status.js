'use strict';

const BOOKING_STATUSES = new Set(['confirmed', 'completed', 'cancelled']);
const NON_BLOCKING_BOOKING_STATUSES = new Set(['cancelled', 'completed']);

function bookingBlocksSchedule(status) {
  return !NON_BLOCKING_BOOKING_STATUSES.has(String(status || 'confirmed'));
}

function statusActivatesSchedule(currentStatus, nextStatus) {
  return !bookingBlocksSchedule(currentStatus) && bookingBlocksSchedule(nextStatus);
}

function shouldCheckBookingConflicts({ scheduleChanged, currentStatus, nextStatus, skipConflictCheck }) {
  return statusActivatesSchedule(currentStatus, nextStatus) || (scheduleChanged && !skipConflictCheck);
}

module.exports = {
  BOOKING_STATUSES,
  bookingBlocksSchedule,
  statusActivatesSchedule,
  shouldCheckBookingConflicts,
};
