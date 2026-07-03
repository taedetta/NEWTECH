'use strict';

const INACTIVE_BOOKING_STATUSES = new Set(['cancelled', 'completed']);

function isInactiveBookingStatus(status) {
  return INACTIVE_BOOKING_STATUSES.has(String(status || '').toLowerCase());
}

function getBookingUpdatePolicy({ existingStatus, requestedStatus, scheduleChanged }) {
  const previousInactive = isInactiveBookingStatus(existingStatus);
  const resultingStatus = requestedStatus === undefined || requestedStatus === null || requestedStatus === ''
    ? existingStatus
    : requestedStatus;
  const resultingInactive = isInactiveBookingStatus(resultingStatus);
  const resultingActive = !resultingInactive;
  const reactivating = previousInactive && resultingActive;

  return {
    resultingStatus,
    resultingActive,
    reactivating,
    needsConflictCheck: resultingActive && (Boolean(scheduleChanged) || reactivating),
    needsDowntimeCheck: resultingActive && (Boolean(scheduleChanged) || reactivating),
  };
}

module.exports = {
  getBookingUpdatePolicy,
  isInactiveBookingStatus,
};
