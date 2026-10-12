'use strict';

const NON_BLOCKING_BOOKING_STATUSES = new Set(['cancelled', 'completed']);

function normalizeBookingStatus(status) {
  return String(status || '').trim().toLowerCase();
}

function bookingStatusBlocksSchedule(status) {
  return !NON_BLOCKING_BOOKING_STATUSES.has(normalizeBookingStatus(status));
}

function shouldCheckBookingConflicts({ scheduleChanged, previousStatus, nextStatus }) {
  const nextBlocksSchedule = bookingStatusBlocksSchedule(nextStatus);
  const previousBlockedSchedule = bookingStatusBlocksSchedule(previousStatus);

  return nextBlocksSchedule && (Boolean(scheduleChanged) || !previousBlockedSchedule);
}

module.exports = {
  bookingStatusBlocksSchedule,
  shouldCheckBookingConflicts,
};
