'use strict';

const INACTIVE_BOOKING_STATUSES = new Set(['cancelled', 'completed']);

function isActiveBookingStatus(status) {
  return !INACTIVE_BOOKING_STATUSES.has(status);
}

function effectiveBookingStatus(existingStatus, requestedStatus) {
  return requestedStatus !== undefined && requestedStatus !== null
    ? requestedStatus
    : existingStatus;
}

function bookingUpdateNeedsConflictCheck({ existingStatus, requestedStatus, scheduleChanged }) {
  const nextStatus = effectiveBookingStatus(existingStatus, requestedStatus);
  const wasActive = isActiveBookingStatus(existingStatus);
  const willBeActive = isActiveBookingStatus(nextStatus);
  return willBeActive && (scheduleChanged || !wasActive);
}

module.exports = {
  INACTIVE_BOOKING_STATUSES,
  isActiveBookingStatus,
  effectiveBookingStatus,
  bookingUpdateNeedsConflictCheck,
};
