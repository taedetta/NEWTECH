'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  bookingStatusBlocksSchedule,
  shouldCheckBookingConflicts,
} = require('../lib/booking-status');

function runBookingConflictUpdateRegressions() {
  assert.strictEqual(bookingStatusBlocksSchedule('confirmed'), true);
  assert.strictEqual(bookingStatusBlocksSchedule('pending'), true);
  assert.strictEqual(bookingStatusBlocksSchedule('cancelled'), false);
  assert.strictEqual(bookingStatusBlocksSchedule('completed'), false);

  assert.strictEqual(
    shouldCheckBookingConflicts({
      scheduleChanged: true,
      previousStatus: 'confirmed',
      nextStatus: 'confirmed',
    }),
    true,
    'active booking reschedules must check conflicts, including owner/admin edits'
  );

  assert.strictEqual(
    shouldCheckBookingConflicts({
      scheduleChanged: false,
      previousStatus: 'cancelled',
      nextStatus: 'confirmed',
    }),
    true,
    'reactivating a cancelled booking must check conflicts even if times did not change'
  );

  assert.strictEqual(
    shouldCheckBookingConflicts({
      scheduleChanged: false,
      previousStatus: 'completed',
      nextStatus: 'confirmed',
    }),
    true,
    'reactivating a completed booking must check conflicts even if times did not change'
  );

  assert.strictEqual(
    shouldCheckBookingConflicts({
      scheduleChanged: true,
      previousStatus: 'completed',
      nextStatus: 'completed',
    }),
    false,
    'completed bookings that remain completed do not block the schedule'
  );

  assert.strictEqual(
    shouldCheckBookingConflicts({
      scheduleChanged: true,
      previousStatus: 'confirmed',
      nextStatus: 'cancelled',
    }),
    false,
    'bookings cancelled by the same update should not block the schedule'
  );

  assert.strictEqual(
    shouldCheckBookingConflicts({
      scheduleChanged: false,
      previousStatus: 'confirmed',
      nextStatus: 'confirmed',
    }),
    false,
    'metadata-only active booking edits do not need conflict checks'
  );

  const routeSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'bookings-routes.js'), 'utf8');
  assert(
    routeSource.includes('shouldCheckBookingConflicts({'),
    'booking update route must use the conflict-check decision helper'
  );
}

runBookingConflictUpdateRegressions();
console.log('Critical booking conflict regressions passed.');
