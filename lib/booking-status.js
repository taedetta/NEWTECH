'use strict';

const NON_SCHEDULE_BLOCKING_STATUSES = new Set(['cancelled', 'completed']);

function normalizedBookingStatus(status) {
  return String(status || '').trim().toLowerCase();
}

function bookingStatusBlocksSchedule(status) {
  return !NON_SCHEDULE_BLOCKING_STATUSES.has(normalizedBookingStatus(status));
}

function isHistoricalBookingStatus(status) {
  return !bookingStatusBlocksSchedule(status);
}

function shouldCheckBookingConflict({ currentStatus, nextStatus, scheduleChanged }) {
  const currentBlocks = bookingStatusBlocksSchedule(currentStatus);
  const nextBlocks = bookingStatusBlocksSchedule(nextStatus ?? currentStatus);
  return nextBlocks && (Boolean(scheduleChanged) || !currentBlocks);
}

function canEditHistoricalBooking(user, booking) {
  if (!user || !booking || !isHistoricalBookingStatus(booking.status)) return false;
  if (['owner', 'admin'].includes(user.role)) return true;
  return user.role === 'instructor' && Number(user.id) === Number(booking.instructor_id);
}

module.exports = {
  bookingStatusBlocksSchedule,
  isHistoricalBookingStatus,
  shouldCheckBookingConflict,
  canEditHistoricalBooking,
};
