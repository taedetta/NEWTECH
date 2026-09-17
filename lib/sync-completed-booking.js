'use strict';

const { syncFlightRecord } = require('./sync-flight-record');

/** Sync flight_logs, instructor_hours, and charges after a completed booking row changes. */
async function syncCompletedBookingSideEffects(client, booking, patch = {}) {
  if (booking.status !== 'completed') return null;
  return syncFlightRecord(client, booking.id, patch);
}

module.exports = { syncCompletedBookingSideEffects };
