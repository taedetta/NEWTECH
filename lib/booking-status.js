'use strict';

const NON_BLOCKING_BOOKING_STATUSES = new Set(['cancelled', 'completed']);

function normalizeBookingStatus(status) {
  return String(status || 'confirmed').trim().toLowerCase();
}

function isScheduleBlockingStatus(status) {
  return !NON_BLOCKING_BOOKING_STATUSES.has(normalizeBookingStatus(status));
}

function shouldCheckUpdateConflicts({ scheduleChanged, previousStatus, nextStatus }) {
  const prevBlocking = isScheduleBlockingStatus(previousStatus);
  const effectiveNextStatus = nextStatus == null ? previousStatus : nextStatus;
  const nextBlocking = isScheduleBlockingStatus(effectiveNextStatus);
  return nextBlocking && (Boolean(scheduleChanged) || !prevBlocking);
}

module.exports = {
  NON_BLOCKING_BOOKING_STATUSES,
  normalizeBookingStatus,
  isScheduleBlockingStatus,
  shouldCheckUpdateConflicts,
};
