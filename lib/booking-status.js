'use strict';

const NON_BLOCKING_STATUSES = new Set(['cancelled', 'completed']);

function normalizedStatus(status) {
  return String(status || 'confirmed').toLowerCase();
}

function isHistoricalBookingStatus(status) {
  return NON_BLOCKING_STATUSES.has(normalizedStatus(status));
}

function isScheduleBlockingStatus(status) {
  return !isHistoricalBookingStatus(status);
}

function isAssignedInstructor(user, booking) {
  return user?.role === 'instructor' && booking?.instructor_id === user.id;
}

function canEditHistoricalBooking(user, booking) {
  if (!isHistoricalBookingStatus(booking?.status)) return true;
  return ['owner', 'admin'].includes(user?.role) || isAssignedInstructor(user, booking);
}

function shouldCheckBookingConflict({ previousStatus, nextStatus, scheduleChanged }) {
  const wasBlocking = isScheduleBlockingStatus(previousStatus);
  const willBlock = isScheduleBlockingStatus(nextStatus || previousStatus);
  return willBlock && (Boolean(scheduleChanged) || !wasBlocking);
}

module.exports = {
  canEditHistoricalBooking,
  isAssignedInstructor,
  isHistoricalBookingStatus,
  isScheduleBlockingStatus,
  shouldCheckBookingConflict,
};
