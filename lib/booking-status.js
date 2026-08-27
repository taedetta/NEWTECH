'use strict';

function bookingStatusBlocksSchedule(status) {
  return !['cancelled', 'completed'].includes(String(status || '').toLowerCase());
}

function shouldCheckUpdateConflicts({ scheduleChanged, currentStatus, nextStatus }) {
  const wasBlocking = bookingStatusBlocksSchedule(currentStatus);
  const willBlock = bookingStatusBlocksSchedule(nextStatus);
  return willBlock && (scheduleChanged || !wasBlocking);
}

module.exports = {
  bookingStatusBlocksSchedule,
  shouldCheckUpdateConflicts,
};
