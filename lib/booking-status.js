'use strict';

const NON_BLOCKING_STATUSES = new Set(['cancelled', 'completed']);
const VALID_BOOKING_STATUSES = new Set(['confirmed', 'completed', 'cancelled']);

function normalizeBookingStatus(status) {
  return String(status || '').trim().toLowerCase();
}

function isHistoricalStatus(status) {
  return NON_BLOCKING_STATUSES.has(normalizeBookingStatus(status));
}

function isScheduleBlockingStatus(status) {
  return !isHistoricalStatus(status);
}

function canEditHistoricalBooking(user, booking) {
  if (!user || !booking || !isHistoricalStatus(booking.status)) return true;
  if (['owner', 'admin'].includes(user.role)) return true;
  return user.role === 'instructor' && booking.instructor_id === user.id;
}

function shouldCheckBookingConflict({ scheduleChanged, previousStatus, nextStatus }) {
  return isScheduleBlockingStatus(nextStatus)
    && (Boolean(scheduleChanged) || !isScheduleBlockingStatus(previousStatus));
}

module.exports = {
  VALID_BOOKING_STATUSES,
  isHistoricalStatus,
  isScheduleBlockingStatus,
  canEditHistoricalBooking,
  shouldCheckBookingConflict,
};
