'use strict';

const NON_BLOCKING_BOOKING_STATUSES = new Set(['cancelled', 'completed']);
const HISTORICAL_BOOKING_STATUSES = new Set(['cancelled', 'completed']);

function bookingBlocksSchedule(status) {
  return !NON_BLOCKING_BOOKING_STATUSES.has(String(status || '').toLowerCase());
}

function isHistoricalBookingStatus(status) {
  return HISTORICAL_BOOKING_STATUSES.has(String(status || '').toLowerCase());
}

function isAssignedParticipant(user, booking) {
  if (!user || !booking) return false;
  return user.id === booking.instructor_id || user.id === booking.student_id;
}

function canMutateBooking(user, booking) {
  if (!user || !booking) return false;
  if (['owner', 'admin'].includes(user.role)) return true;
  return isAssignedParticipant(user, booking);
}

function canEditHistoricalBooking(user, booking) {
  if (!isHistoricalBookingStatus(booking?.status)) return false;
  if (!user || !booking) return false;
  if (['owner', 'admin'].includes(user.role)) return true;
  return user.role === 'instructor' && user.id === booking.instructor_id;
}

function shouldCheckBookingConflicts({ currentStatus, nextStatus, scheduleChanged }) {
  const currentBlocks = bookingBlocksSchedule(currentStatus);
  const nextBlocks = bookingBlocksSchedule(nextStatus || currentStatus);
  return nextBlocks && (!!scheduleChanged || !currentBlocks);
}

module.exports = {
  bookingBlocksSchedule,
  isHistoricalBookingStatus,
  canMutateBooking,
  canEditHistoricalBooking,
  shouldCheckBookingConflicts,
};
