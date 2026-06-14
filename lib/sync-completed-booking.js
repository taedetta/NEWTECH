'use strict';

const { syncFlightRecord } = require('./sync-flight-record');

/** Sync flight_logs, instructor_hours, and charges after a completed booking row changes. */
async function syncCompletedBookingSideEffects(client, booking, lessonType) {
  if (booking.status !== 'completed') return null;
  return syncFlightRecord(client, booking.id, {
    lesson_type: lessonType != null ? lessonType : booking.lesson_type,
  });
}

module.exports = { syncCompletedBookingSideEffects };
