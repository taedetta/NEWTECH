'use strict';

function isScheduleBlockingStatus(status) {
  return status !== 'cancelled' && status !== 'completed';
}

function shouldRunUpdateConflictCheck({ scheduleChanged, statusChanged, nextStatus }) {
  return isScheduleBlockingStatus(nextStatus) && (scheduleChanged || statusChanged);
}

module.exports = {
  isScheduleBlockingStatus,
  shouldRunUpdateConflictCheck,
};
