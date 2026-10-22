'use strict';

const NON_BLOCKING_STATUSES = new Set(['cancelled', 'completed']);
const KNOWN_BOOKING_STATUSES = new Set(['confirmed', 'cancelled', 'completed']);

function normalizeBookingStatus(status) {
  return String(status || '').trim().toLowerCase();
}

function isScheduleBlockingStatus(status) {
  return !NON_BLOCKING_STATUSES.has(normalizeBookingStatus(status));
}

function isKnownBookingStatus(status) {
  return KNOWN_BOOKING_STATUSES.has(normalizeBookingStatus(status));
}

function shouldCheckScheduleConflicts({ existingStatus, effectiveStatus, scheduleChanged }) {
  const existingBlocksSchedule = isScheduleBlockingStatus(existingStatus);
  const resultingBlocksSchedule = isScheduleBlockingStatus(effectiveStatus);
  return resultingBlocksSchedule && (Boolean(scheduleChanged) || !existingBlocksSchedule);
}

function canEditHistoricalBooking(user, booking) {
  if (!user || !booking || isScheduleBlockingStatus(booking.status)) return true;
  if (['owner', 'admin'].includes(user.role)) return true;
  return user.role === 'instructor' && booking.instructor_id === user.id;
}

module.exports = {
  canEditHistoricalBooking,
  isKnownBookingStatus,
  isScheduleBlockingStatus,
  normalizeBookingStatus,
  shouldCheckScheduleConflicts,
};
