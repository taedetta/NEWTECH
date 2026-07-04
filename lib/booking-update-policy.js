'use strict';

const HISTORICAL_BOOKING_STATUSES = new Set(['completed', 'cancelled']);

function isHistoricalBookingStatus(status) {
  return HISTORICAL_BOOKING_STATUSES.has(String(status || '').toLowerCase());
}

function blocksSchedule(status) {
  return !isHistoricalBookingStatus(status);
}

function getBookingUpdateConflictPolicy({ currentStatus, nextStatus, scheduleChanged, skipForHistoricalEdit }) {
  const effectiveNextStatus = nextStatus === undefined || nextStatus === null || nextStatus === ''
    ? currentStatus
    : nextStatus;
  const activatesBlockingStatus = !blocksSchedule(currentStatus) && blocksSchedule(effectiveNextStatus);
  const skipConflictCheck = !!skipForHistoricalEdit && !activatesBlockingStatus;

  return {
    activatesBlockingStatus,
    skipConflictCheck,
    needsConflictCheck: (!!scheduleChanged || activatesBlockingStatus) && !skipConflictCheck,
  };
}

module.exports = {
  HISTORICAL_BOOKING_STATUSES,
  isHistoricalBookingStatus,
  blocksSchedule,
  getBookingUpdateConflictPolicy,
};
