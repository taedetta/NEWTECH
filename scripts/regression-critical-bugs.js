'use strict';

const assert = require('assert');
const { syncFlightRecord, _private: syncPrivate } = require('../lib/sync-flight-record');
const { canReassignEnrollmentInstructor } = require('../lib/training-permissions');

function fakeSyncClient(initialBooking) {
  const state = { booking: { ...initialBooking }, bookingUpdates: [] };
  return {
    state,
    async query(sql, params = []) {
      const compact = sql.replace(/\s+/g, ' ').trim();
      if (compact.startsWith('SELECT * FROM bookings WHERE id = $1')) {
        return { rows: [{ ...state.booking }] };
      }
      if (compact.startsWith('SELECT * FROM flight_logs WHERE booking_id = $1')) {
        return { rows: [] };
      }
      if (compact.startsWith('UPDATE bookings SET')) {
        state.bookingUpdates.push({ sql, params });
        if (sql.includes('start_time = $1')) state.booking.start_time = params[0];
        if (sql.includes('end_time = $2')) state.booking.end_time = params[1];
        return { rowCount: 1, rows: [] };
      }
      return { rows: [] };
    },
  };
}

async function testSyncFlightRecordDoesNotRewriteSameDate() {
  const client = fakeSyncClient({
    id: 42,
    status: 'confirmed',
    start_time: '2026-01-15T14:30:00.000Z',
    end_time: '2026-01-15T16:00:00.000Z',
    aircraft_id: null,
    instructor_id: null,
    student_id: null,
    booking_type: 'dual',
    lesson_type: 'flight',
  });

  await syncFlightRecord(client, 42, { flight_date: '2026-01-15' });

  assert.strictEqual(
    client.state.bookingUpdates.some((u) => u.sql.includes('start_time')),
    false,
    'same-date billing/history edits must not rewrite booking start/end times'
  );
}

async function testSyncFlightRecordPreservesTimeWhenDateChanges() {
  const client = fakeSyncClient({
    id: 43,
    status: 'confirmed',
    start_time: '2026-01-15T14:30:00.000Z',
    end_time: '2026-01-15T16:00:00.000Z',
    aircraft_id: null,
    instructor_id: null,
    student_id: null,
    booking_type: 'dual',
    lesson_type: 'flight',
  });

  await syncFlightRecord(client, 43, { flight_date: '2026-01-16' });

  assert.strictEqual(client.state.booking.start_time, '2026-01-16T14:30:00.000Z');
  assert.strictEqual(client.state.booking.end_time, '2026-01-16T16:00:00.000Z');

  const shifted = syncPrivate.shiftBookingDatePreservingTime({
    flightDate: '2026-01-17',
    currentStartTime: '2026-01-15T14:30:00.000Z',
    currentEndTime: '2026-01-15T16:00:00.000Z',
  });
  assert.strictEqual(shifted.startTime.toISOString(), '2026-01-17T14:30:00.000Z');
  assert.strictEqual(shifted.endTime.toISOString(), '2026-01-17T16:00:00.000Z');
}

function testEnrollmentReassignmentPermissions() {
  const enrollment = { id: 10, instructor_id: 5 };

  assert.strictEqual(canReassignEnrollmentInstructor({ id: 1, role: 'owner' }, enrollment), true);
  assert.strictEqual(canReassignEnrollmentInstructor({ id: 2, role: 'admin' }, enrollment), true);
  assert.strictEqual(canReassignEnrollmentInstructor({ id: 5, role: 'instructor' }, enrollment), true);
  assert.strictEqual(canReassignEnrollmentInstructor({ id: 6, role: 'instructor' }, enrollment), false);
  assert.strictEqual(canReassignEnrollmentInstructor({ id: 5, role: 'student' }, enrollment), false);
  assert.strictEqual(canReassignEnrollmentInstructor({ id: 5, role: 'instructor' }, { id: 11, instructor_id: null }), false);
}

(async () => {
  await testSyncFlightRecordDoesNotRewriteSameDate();
  await testSyncFlightRecordPreservesTimeWhenDateChanges();
  testEnrollmentReassignmentPermissions();
  console.log('critical regression tests passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
