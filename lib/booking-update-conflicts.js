'use strict';

function isScheduleBlockingStatus(status) {
  return !['cancelled', 'completed'].includes(String(status || 'confirmed').toLowerCase());
}

function shouldCheckBookingUpdateConflicts({ currentStatus, nextStatus, scheduleChanged }) {
  const nextBlocksSchedule = isScheduleBlockingStatus(nextStatus);
  const statusReactivated = !isScheduleBlockingStatus(currentStatus) && nextBlocksSchedule;
  return nextBlocksSchedule && (Boolean(scheduleChanged) || statusReactivated);
}

module.exports = {
  isScheduleBlockingStatus,
  shouldCheckBookingUpdateConflicts,
};
