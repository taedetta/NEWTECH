'use strict';

const NON_BLOCKING_BOOKING_STATUSES = new Set(['cancelled', 'completed']);

function normalizeBookingStatus(status) {
  if (status === null || status === undefined) return null;
  return String(status).trim().toLowerCase();
}

function bookingStatusBlocksSchedule(status) {
  const normalized = normalizeBookingStatus(status);
  return Boolean(normalized) && !NON_BLOCKING_BOOKING_STATUSES.has(normalized);
}

function bookingUpdateNeedsConflictCheck({ currentStatus, nextStatus, scheduleChanged }) {
  const currentlyBlocks = bookingStatusBlocksSchedule(currentStatus);
  const willBlock = bookingStatusBlocksSchedule(nextStatus);
  return willBlock && (Boolean(scheduleChanged) || !currentlyBlocks);
}

module.exports = {
  bookingStatusBlocksSchedule,
  bookingUpdateNeedsConflictCheck,
};
