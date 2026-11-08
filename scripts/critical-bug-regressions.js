'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  bookingBlocksSchedule,
  isHistoricalBookingStatus,
  needsScheduleConflictCheck,
  restrictedHistoricalUpdateFields,
} = require('../lib/booking-status');

function testBookingStatusHelpers() {
  assert.strictEqual(bookingBlocksSchedule('confirmed'), true, 'confirmed bookings block the schedule');
  assert.strictEqual(bookingBlocksSchedule('completed'), false, 'completed bookings do not block the schedule');
  assert.strictEqual(bookingBlocksSchedule('cancelled'), false, 'cancelled bookings do not block the schedule');
  assert.strictEqual(isHistoricalBookingStatus('completed'), true, 'completed is historical');
  assert.strictEqual(isHistoricalBookingStatus('cancelled'), true, 'cancelled is historical');

  assert.strictEqual(
    needsScheduleConflictCheck({ previousStatus: 'confirmed', nextStatus: 'confirmed', scheduleChanged: true }),
    true,
    'active schedule edits must run conflict checks'
  );
  assert.strictEqual(
    needsScheduleConflictCheck({ previousStatus: 'completed', nextStatus: 'confirmed', scheduleChanged: false }),
    true,
    'reactivating historical bookings must run conflict checks even when times do not change'
  );
  assert.strictEqual(
    needsScheduleConflictCheck({ previousStatus: 'cancelled', nextStatus: 'completed', scheduleChanged: true }),
    false,
    'historical edits that remain non-blocking should not run schedule conflict checks'
  );
  assert.strictEqual(
    needsScheduleConflictCheck({ previousStatus: 'confirmed', nextStatus: 'cancelled', scheduleChanged: true }),
    false,
    'cancelling a booking should not be blocked by schedule conflicts'
  );

  assert.deepStrictEqual(
    restrictedHistoricalUpdateFields({ notes: 'ok', lesson_type: 'Discovery', start_time: '2026-07-01T12:00:00Z' }),
    ['start_time', 'lesson_type'],
    'historical billing/schedule fields are restricted while notes remain editable'
  );
}

function testBookingRouteWiring() {
  const routePath = path.join(__dirname, '..', 'routes', 'bookings-routes.js');
  const source = fs.readFileSync(routePath, 'utf8');
  assert(
    source.includes('needsScheduleConflictCheck({'),
    'PUT /api/bookings/:id must use the centralized schedule conflict decision'
  );
  assert(
    source.includes('restrictedHistoricalUpdateFields(req.body)'),
    'PUT /api/bookings/:id must reject non-admin historical schedule/billing edits'
  );
  assert(
    source.includes('if (needsConflictCheck) {'),
    'conflict queries must be guarded by the conflict decision'
  );
}

testBookingStatusHelpers();
testBookingRouteWiring();

console.log('critical booking regression checks passed');
