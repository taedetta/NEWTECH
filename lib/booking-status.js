'use strict';

const NON_BLOCKING_STATUSES = new Set(['cancelled', 'completed']);

function normalizeStatus(status) {
  return String(status || '').toLowerCase();
}

function bookingBlocksSchedule(status) {
  return !NON_BLOCKING_STATUSES.has(normalizeStatus(status));
}

function canEditHistoricalBooking(user, booking) {
  if (!user || !booking) return false;
  if (['owner', 'admin'].includes(user.role)) return true;
  return user.role === 'instructor' && booking.instructor_id === user.id;
}

function shouldCheckBookingConflict({ previousStatus, nextStatus, scheduleChanged }) {
  const wasBlocking = bookingBlocksSchedule(previousStatus);
  const willBlock = bookingBlocksSchedule(nextStatus);
  return willBlock && (Boolean(scheduleChanged) || !wasBlocking);
}

module.exports = {
  bookingBlocksSchedule,
  canEditHistoricalBooking,
  shouldCheckBookingConflict,
};
