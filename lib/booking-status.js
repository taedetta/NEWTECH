'use strict';

function bookingBlocksSchedule(status) {
  const normalized = String(status || '').toLowerCase();
  return normalized !== 'cancelled' && normalized !== 'completed';
}

function bookingUpdateNeedsConflictCheck({ currentStatus, nextStatus, scheduleChanged }) {
  const nextBlocks = bookingBlocksSchedule(nextStatus);
  const currentBlocks = bookingBlocksSchedule(currentStatus);
  return nextBlocks && (scheduleChanged || !currentBlocks);
}

module.exports = {
  bookingBlocksSchedule,
  bookingUpdateNeedsConflictCheck,
};
