'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const dbPath = path.join(ROOT, 'db', 'index.js');
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    query: async () => ({ rows: [] }),
    on: () => {},
  },
};

const {
  bookingBlocksSchedule,
  bookingScheduleChanged,
  shouldCheckScheduleConflicts,
} = require('../lib/booking-status');
const { syncFlightRecord } = require('../lib/sync-flight-record');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function booking(overrides = {}) {
  return {
    id: 10,
    aircraft_id: 1,
    instructor_id: 2,
    student_id: 3,
    start_time: '2026-07-01T14:00:00.000Z',
    end_time: '2026-07-01T15:00:00.000Z',
    status: 'confirmed',
    ...overrides,
  };
}

function testBookingConflictDecisions() {
  assert.strictEqual(bookingBlocksSchedule('confirmed'), true);
  assert.strictEqual(bookingBlocksSchedule('completed'), false);
  assert.strictEqual(bookingBlocksSchedule('cancelled'), false);

  const existing = booking();
  assert.strictEqual(bookingScheduleChanged(existing, booking({ start_time: '2026-07-01T15:00:00.000Z', end_time: '2026-07-01T16:00:00.000Z' })), true);
  assert.strictEqual(shouldCheckScheduleConflicts(existing, booking({ aircraft_id: 4 })), true, 'active schedule edits must conflict-check');
  assert.strictEqual(shouldCheckScheduleConflicts(booking({ status: 'completed' }), booking({ status: 'confirmed' })), true, 'reactivating historical bookings must conflict-check');
  assert.strictEqual(shouldCheckScheduleConflicts(booking({ status: 'completed' }), booking({ status: 'completed', start_time: '2026-07-02T14:00:00.000Z', end_time: '2026-07-02T15:00:00.000Z' })), false, 'non-blocking historical edits do not need schedule conflicts');
}

class FakeClient {
  constructor(row) {
    this.row = { ...row };
    this.bookingUpdates = [];
  }

  async query(sql, params = []) {
    if (sql.startsWith('SELECT * FROM bookings WHERE id = $1')) {
      return { rows: [this.row] };
    }
    if (sql.startsWith('SELECT * FROM flight_logs WHERE booking_id = $1')) {
      return { rows: [] };
    }
    if (sql.startsWith('SELECT hourly_rate FROM aircraft WHERE id = $1')) {
      return { rows: [{ hourly_rate: 100 }] };
    }
    if (sql.startsWith('UPDATE bookings SET')) {
      this.bookingUpdates.push({ sql, params });
      return { rows: [{ ...this.row }] };
    }
    throw new Error(`Unexpected query in fake client: ${sql}`);
  }
}

async function testFlightDateSyncPreservesSchedule() {
  const row = booking({
    start_time: '2026-07-01T22:00:00.000Z', // 6 PM ET
    end_time: '2026-07-01T23:30:00.000Z',
    aircraft_id: 1,
    instructor_id: null,
    student_id: 3,
    status: 'confirmed',
    booking_type: 'student_solo',
    lesson_type: 'solo',
  });

  const sameDateClient = new FakeClient(row);
  await syncFlightRecord(sameDateClient, row.id, {
    flight_date: '2026-07-01',
    hobbs_start: 10,
    hobbs_end: 11,
  });
  assert(sameDateClient.bookingUpdates.length === 1, 'same-date edit should still persist meter changes');
  assert(!sameDateClient.bookingUpdates[0].sql.includes('start_time ='), 'same-date flight edits must not rewrite booking start_time');
  assert(!sameDateClient.bookingUpdates[0].sql.includes('end_time ='), 'same-date flight edits must not rewrite booking end_time');

  const movedDateClient = new FakeClient(row);
  await syncFlightRecord(movedDateClient, row.id, {
    flight_date: '2026-07-02',
    hobbs_start: 10,
    hobbs_end: 11,
  });
  const movedUpdate = movedDateClient.bookingUpdates[0];
  assert(movedUpdate.sql.includes('start_time ='), 'explicit date changes should move booking start_time');
  assert(movedUpdate.sql.includes('end_time ='), 'explicit date changes should move booking end_time');
  assert(movedUpdate.params.includes('2026-07-02T22:00:00.000Z'), 'date moves preserve the original school-local start time');
  assert(movedUpdate.params.includes('2026-07-02T23:30:00.000Z'), 'date moves preserve duration');
}

function testRouteWiring() {
  const bookingRoutes = read('routes/bookings-routes.js');
  assert(bookingRoutes.includes('shouldCheckScheduleConflicts'), 'booking PUT must use schedule conflict helper');
  assert(!bookingRoutes.includes('const skipConflictCheck = isStaffHistoricalEdit'), 'admin edits must not skip conflicts just because they are staff');
  assert(bookingRoutes.includes('Only admins can edit completed or cancelled bookings'), 'participants must not edit completed/cancelled bookings through generic PUT');

  const historyRoutes = read('routes/booking-history.js');
  assert(!historyRoutes.includes('flight_date: dateVal'), 'history edits must not always pass a default flight_date');
  assert(historyRoutes.includes('if (flight_date) patch.flight_date = dateVal;'), 'history edits should only move booking dates when explicitly requested');
  assert(historyRoutes.includes('lesson_type: canOverrideBilling ?'), 'instructors must not change billing-affecting lesson types');
  assert(historyRoutes.includes('aircraft_charge_amount: canOverrideBilling ?'), 'instructors must not override aircraft charges');
  assert(historyRoutes.includes('instruction_charge_amount: canOverrideBilling ?'), 'instructors must not override instruction charges');

  const instructorHours = read('routes/instructor-hours.js');
  assert(instructorHours.includes("const canOverrideRates = ['owner', 'admin'].includes(verifiedRole);"), 'instructor-hours create must ignore instructor-supplied rates');
  assert(instructorHours.includes("const canOverrideRates = ['owner', 'admin'].includes(role);"), 'instructor-hours update must ignore instructor-supplied rates');
}

(async () => {
  testBookingConflictDecisions();
  await testFlightDateSyncPreservesSchedule();
  testRouteWiring();
  console.log('critical bug regressions passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
