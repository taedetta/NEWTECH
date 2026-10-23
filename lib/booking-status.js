'use strict';

const NON_BLOCKING_STATUSES = new Set(['cancelled', 'completed']);

function normalizeStatus(status) {
  return String(status || 'confirmed').toLowerCase();
}

function bookingBlocksSchedule(status) {
  return !NON_BLOCKING_STATUSES.has(normalizeStatus(status));
}

function shouldCheckBookingConflicts({ existingStatus, nextStatus, scheduleChanged }) {
  const wasBlocking = bookingBlocksSchedule(existingStatus);
  const willBlock = bookingBlocksSchedule(nextStatus);
  return willBlock && (Boolean(scheduleChanged) || !wasBlocking);
}

module.exports = {
  bookingBlocksSchedule,
  shouldCheckBookingConflicts,
};
