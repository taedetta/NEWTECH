'use strict';

const { syncFlightRecord } = require('./sync-flight-record');

/** Sync flight_logs, instructor_hours, and charges after a completed booking row changes. */
async function syncCompletedBookingSideEffects(client, booking, lessonType, previousBooking = null) {
  if (booking.status !== 'completed') return null;
  return syncFlightRecord(client, booking.id, {
    lesson_type: lessonType != null ? lessonType : booking.lesson_type,
    previous_student_id: previousBooking?.student_id,
    previous_instructor_id: previousBooking?.instructor_id,
  });
}

module.exports = { syncCompletedBookingSideEffects };
