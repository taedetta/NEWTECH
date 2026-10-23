'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  bookingBlocksSchedule,
  shouldCheckBookingConflicts,
} = require('../lib/booking-status');

function caseLabel(input) {
  return JSON.stringify(input);
}

assert.strictEqual(bookingBlocksSchedule('confirmed'), true, 'confirmed bookings block the schedule');
assert.strictEqual(bookingBlocksSchedule('pending'), true, 'unknown active statuses block conservatively');
assert.strictEqual(bookingBlocksSchedule('cancelled'), false, 'cancelled bookings do not block the schedule');
assert.strictEqual(bookingBlocksSchedule('completed'), false, 'completed bookings do not block the schedule');

[
  {
    input: { existingStatus: 'confirmed', nextStatus: 'confirmed', scheduleChanged: true },
    expected: true,
    reason: 'active schedule edits must detect double-booking',
  },
  {
    input: { existingStatus: 'cancelled', nextStatus: 'confirmed', scheduleChanged: false },
    expected: true,
    reason: 'reactivating a cancelled booking can collide with bookings created while it was cancelled',
  },
  {
    input: { existingStatus: 'completed', nextStatus: 'confirmed', scheduleChanged: false },
    expected: true,
    reason: 'reactivating a completed booking can collide with active bookings',
  },
  {
    input: { existingStatus: 'confirmed', nextStatus: 'cancelled', scheduleChanged: true },
    expected: false,
    reason: 'cancelling a booking releases schedule capacity',
  },
  {
    input: { existingStatus: 'completed', nextStatus: 'completed', scheduleChanged: true },
    expected: false,
    reason: 'historical edits do not reserve schedule capacity',
  },
  {
    input: { existingStatus: 'confirmed', nextStatus: 'confirmed', scheduleChanged: false },
    expected: false,
    reason: 'metadata-only active edits do not need conflict checks',
  },
].forEach(({ input, expected, reason }) => {
  assert.strictEqual(shouldCheckBookingConflicts(input), expected, `${reason}: ${caseLabel(input)}`);
});

const routesSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'bookings-routes.js'), 'utf8');
assert(
  routesSource.includes('shouldCheckBookingConflicts({'),
  'booking update route must use shared conflict decision helper'
);
assert(
  !routesSource.includes('skipConflictCheck = isStaffHistoricalEdit'),
  'admin/historical policy flags must not disable conflict checks for schedule-blocking updates'
);

console.log('critical booking regressions passed');
