'use strict';

function bookingStatusBlocksSchedule(status) {
  return !['cancelled', 'completed'].includes(String(status || 'confirmed').toLowerCase());
}

function bookingUpdateNeedsConflictCheck({ previousStatus, nextStatus, scheduleChanged }) {
  const wasActive = bookingStatusBlocksSchedule(previousStatus);
  const willBeActive = bookingStatusBlocksSchedule(nextStatus);
  return willBeActive && (scheduleChanged || !wasActive);
}

module.exports = {
  bookingStatusBlocksSchedule,
  bookingUpdateNeedsConflictCheck,
};
