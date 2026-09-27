'use strict';

function bookingBlocksSchedule(status) {
  return status !== 'cancelled' && status !== 'completed';
}

function shouldCheckScheduleConflict({ oldStatus, newStatus, scheduleChanged }) {
  const oldBlocksSchedule = bookingBlocksSchedule(oldStatus);
  const newBlocksSchedule = bookingBlocksSchedule(newStatus);
  return newBlocksSchedule && (scheduleChanged || !oldBlocksSchedule);
}

module.exports = {
  bookingBlocksSchedule,
  shouldCheckScheduleConflict,
};
