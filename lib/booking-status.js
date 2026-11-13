'use strict';

const NON_BLOCKING_BOOKING_STATUSES = new Set(['cancelled', 'completed']);

function bookingBlocksSchedule(status) {
  return !NON_BLOCKING_BOOKING_STATUSES.has(String(status || '').toLowerCase());
}

function shouldCheckBookingConflicts({ currentStatus, nextStatus, scheduleChanged }) {
  const currentBlocks = bookingBlocksSchedule(currentStatus);
  const nextBlocks = bookingBlocksSchedule(nextStatus || currentStatus);
  return nextBlocks && (!!scheduleChanged || !currentBlocks);
}

module.exports = {
  bookingBlocksSchedule,
  shouldCheckBookingConflicts,
};
