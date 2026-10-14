'use strict';

function bookingBlocksSchedule(status) {
  return status !== 'cancelled' && status !== 'completed';
}

function bookingUpdateNeedsConflictCheck({ existingStatus, resultingStatus, scheduleChanged }) {
  const currentlyBlocksSchedule = bookingBlocksSchedule(existingStatus);
  const resultingBlocksSchedule = bookingBlocksSchedule(resultingStatus);
  const reactivatesHistoricalBooking = !currentlyBlocksSchedule && resultingBlocksSchedule;
  return resultingBlocksSchedule && (scheduleChanged || reactivatesHistoricalBooking);
}

module.exports = {
  bookingBlocksSchedule,
  bookingUpdateNeedsConflictCheck,
};
