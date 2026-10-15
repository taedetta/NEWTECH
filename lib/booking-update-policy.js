'use strict';

const INACTIVE_BOOKING_STATUSES = new Set(['cancelled', 'completed']);

function normalizedStatus(status) {
  return String(status || '').toLowerCase();
}

function isInactiveBookingStatus(status) {
  return INACTIVE_BOOKING_STATUSES.has(normalizedStatus(status));
}

function isHistoricalBookingEdit(existingStatus, nextStatus) {
  const effectiveNextStatus = nextStatus || existingStatus;
  return isInactiveBookingStatus(existingStatus) && isInactiveBookingStatus(effectiveNextStatus);
}

function shouldCheckBookingUpdateConflicts({ existingStatus, nextStatus, scheduleChanged }) {
  const effectiveNextStatus = nextStatus || existingStatus;
  if (isInactiveBookingStatus(effectiveNextStatus)) return false;

  // Active bookings must be rechecked when moved, reassigned, or restored from history.
  return Boolean(scheduleChanged) || isInactiveBookingStatus(existingStatus);
}

module.exports = {
  isInactiveBookingStatus,
  isHistoricalBookingEdit,
  shouldCheckBookingUpdateConflicts,
};
