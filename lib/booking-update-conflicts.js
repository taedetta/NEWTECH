'use strict';

const NON_BLOCKING_STATUSES = new Set(['cancelled', 'completed']);

function isScheduleBlockingStatus(status) {
  return !NON_BLOCKING_STATUSES.has(String(status || 'confirmed'));
}

function shouldCheckBookingUpdateConflicts({ currentStatus, nextStatus, scheduleChanged }) {
  const currentBlocksSchedule = isScheduleBlockingStatus(currentStatus);
  const nextBlocksSchedule = isScheduleBlockingStatus(nextStatus);
  if (!nextBlocksSchedule) return false;
  return scheduleChanged || !currentBlocksSchedule;
}

module.exports = {
  isScheduleBlockingStatus,
  shouldCheckBookingUpdateConflicts,
};
