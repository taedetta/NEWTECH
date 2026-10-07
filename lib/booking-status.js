'use strict';

const NON_BLOCKING_STATUSES = new Set(['cancelled', 'completed']);

function normalizeBookingStatus(status) {
  return String(status || '').trim().toLowerCase();
}

function bookingBlocksSchedule(status) {
  return !NON_BLOCKING_STATUSES.has(normalizeBookingStatus(status));
}

function shouldCheckBookingUpdateConflicts({ currentStatus, nextStatus, scheduleChanged }) {
  const currentBlocks = bookingBlocksSchedule(currentStatus);
  const nextBlocks = bookingBlocksSchedule(nextStatus);
  return nextBlocks && (Boolean(scheduleChanged) || !currentBlocks);
}

module.exports = {
  bookingBlocksSchedule,
  shouldCheckBookingUpdateConflicts,
};
