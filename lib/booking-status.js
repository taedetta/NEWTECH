'use strict';

function isScheduleBlockingStatus(status) {
  return status !== 'cancelled' && status !== 'completed';
}

function isHistoricalBookingStatus(status) {
  return status === 'cancelled' || status === 'completed';
}

function shouldRunUpdateConflictCheck({ scheduleChanged, statusChanged, nextStatus }) {
  return isScheduleBlockingStatus(nextStatus) && (Boolean(scheduleChanged) || Boolean(statusChanged));
}

function shouldSyncCompletedBookingSideEffects({
  nextStatus,
  lessonTypeChanged,
  scheduleChanged,
  participantChanged,
  aircraftChanged,
  bookingTypeChanged,
}) {
  return nextStatus === 'completed' && (
    Boolean(lessonTypeChanged)
    || Boolean(scheduleChanged)
    || Boolean(participantChanged)
    || Boolean(aircraftChanged)
    || Boolean(bookingTypeChanged)
  );
}

module.exports = {
  isScheduleBlockingStatus,
  isHistoricalBookingStatus,
  shouldRunUpdateConflictCheck,
  shouldSyncCompletedBookingSideEffects,
};
