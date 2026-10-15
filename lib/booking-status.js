'use strict';

const NON_BLOCKING_BOOKING_STATUSES = new Set(['cancelled', 'completed']);

function normalizeBookingStatus(status) {
  return String(status || '').trim().toLowerCase();
}

function bookingStatusBlocksSchedule(status) {
  return !NON_BLOCKING_BOOKING_STATUSES.has(normalizeBookingStatus(status));
}

function shouldCheckBookingUpdateConflicts({ currentStatus, nextStatus, scheduleChanged }) {
  const currentlyBlocksSchedule = bookingStatusBlocksSchedule(currentStatus);
  const resolvedNextStatus = nextStatus == null ? currentStatus : nextStatus;
  const nextBlocksSchedule = bookingStatusBlocksSchedule(resolvedNextStatus);

  return nextBlocksSchedule && (Boolean(scheduleChanged) || !currentlyBlocksSchedule);
}

module.exports = {
  bookingStatusBlocksSchedule,
  shouldCheckBookingUpdateConflicts,
};
