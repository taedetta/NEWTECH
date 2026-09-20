'use strict';

function bookingBlocksSchedule(status) {
  return !['cancelled', 'completed'].includes(String(status || '').toLowerCase());
}

function shouldCheckScheduleConflicts({ existingStatus, effectiveStatus, scheduleChanged }) {
  if (!bookingBlocksSchedule(effectiveStatus)) return false;
  return Boolean(scheduleChanged) || !bookingBlocksSchedule(existingStatus);
}

module.exports = {
  bookingBlocksSchedule,
  shouldCheckScheduleConflicts,
};
