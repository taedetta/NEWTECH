'use strict';

const NON_SCHEDULE_BLOCKING_STATUSES = new Set(['cancelled', 'completed']);

function normalizeStatus(status) {
  return String(status || '').trim().toLowerCase();
}

function bookingBlocksSchedule(status) {
  return !NON_SCHEDULE_BLOCKING_STATUSES.has(normalizeStatus(status));
}

function bookingUpdateNeedsConflictCheck({ currentStatus, nextStatus, scheduleChanged }) {
  const currentBlocks = bookingBlocksSchedule(currentStatus);
  const nextBlocks = bookingBlocksSchedule(nextStatus);
  return nextBlocks && (Boolean(scheduleChanged) || !currentBlocks);
}

module.exports = {
  bookingBlocksSchedule,
  bookingUpdateNeedsConflictCheck,
};
