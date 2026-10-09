'use strict';

const NON_SCHEDULE_BLOCKING_STATUSES = new Set(['cancelled', 'completed']);

function normalizeBookingStatus(status) {
  return String(status || '').trim().toLowerCase();
}

function isScheduleBlockingStatus(status) {
  return !NON_SCHEDULE_BLOCKING_STATUSES.has(normalizeBookingStatus(status));
}

function needsScheduleConflictCheck({ previousStatus, nextStatus, scheduleChanged }) {
  const previouslyBlocked = isScheduleBlockingStatus(previousStatus);
  const willBlock = isScheduleBlockingStatus(nextStatus);
  return willBlock && (Boolean(scheduleChanged) || !previouslyBlocked);
}

function canEditHistoricalBooking(userRole, { isAssignedInstructor = false } = {}) {
  if (userRole === 'owner' || userRole === 'admin') return true;
  return userRole === 'instructor' && Boolean(isAssignedInstructor);
}

function canManageBookingBilling(userRole) {
  return userRole === 'owner' || userRole === 'admin';
}

module.exports = {
  canEditHistoricalBooking,
  canManageBookingBilling,
  isScheduleBlockingStatus,
  needsScheduleConflictCheck,
  normalizeBookingStatus,
};
