'use strict';

const NON_BLOCKING_BOOKING_STATUSES = new Set(['cancelled', 'completed']);

function normalizeBookingStatus(status) {
  return String(status || '').toLowerCase();
}

function isScheduleBlockingStatus(status) {
  return !NON_BLOCKING_BOOKING_STATUSES.has(normalizeBookingStatus(status));
}

function shouldRunUpdateConflictCheck({ scheduleChanged, currentStatus, nextStatus }) {
  const nextBlocksSchedule = isScheduleBlockingStatus(nextStatus);
  const currentlyBlocksSchedule = isScheduleBlockingStatus(currentStatus);
  return nextBlocksSchedule && (Boolean(scheduleChanged) || !currentlyBlocksSchedule);
}

module.exports = {
  isScheduleBlockingStatus,
  shouldRunUpdateConflictCheck,
};
