'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  isScheduleBlockingStatus,
  shouldRunUpdateConflictCheck,
} = require('../lib/booking-status');

function testBookingStatusHelpers() {
  assert.strictEqual(isScheduleBlockingStatus('confirmed'), true);
  assert.strictEqual(isScheduleBlockingStatus('pending'), true);
  assert.strictEqual(isScheduleBlockingStatus('cancelled'), false);
  assert.strictEqual(isScheduleBlockingStatus('completed'), false);

  assert.strictEqual(
    shouldRunUpdateConflictCheck({
      scheduleChanged: true,
      currentStatus: 'confirmed',
      nextStatus: 'confirmed',
    }),
    true,
    'active booking reschedules must run conflict checks'
  );
  assert.strictEqual(
    shouldRunUpdateConflictCheck({
      scheduleChanged: false,
      currentStatus: 'cancelled',
      nextStatus: 'confirmed',
    }),
    true,
    'reactivating a cancelled booking must run conflict checks even if times do not change'
  );
  assert.strictEqual(
    shouldRunUpdateConflictCheck({
      scheduleChanged: true,
      currentStatus: 'confirmed',
      nextStatus: 'cancelled',
    }),
    false,
    'updates ending in a non-blocking status do not need schedule conflict checks'
  );
  assert.strictEqual(
    shouldRunUpdateConflictCheck({
      scheduleChanged: false,
      currentStatus: 'confirmed',
      nextStatus: 'confirmed',
    }),
    false,
    'metadata-only edits to already-active bookings do not need schedule conflict checks'
  );
}

function testBookingRouteUsesConflictGuard() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'bookings-routes.js'), 'utf8');
  assert(
    src.includes("const { shouldRunUpdateConflictCheck } = require('../lib/booking-status')"),
    'booking PUT route must import the schedule-blocking conflict helper'
  );
  assert(
    src.includes('const isStaffHistoricalEdit = isHistoricalBooking && (isAdmin || isAssignedInstructor);'),
    'admin edits to active bookings must not be treated as historical edits'
  );
  assert(
    src.includes('const needsConflictCheck = shouldRunUpdateConflictCheck({'),
    'booking PUT route must use the helper when deciding whether to check conflicts'
  );
  assert(
    !src.includes('const skipConflictCheck = isStaffHistoricalEdit'),
    'historical edit bypass must not skip conflicts for admin active booking updates'
  );
}

testBookingStatusHelpers();
testBookingRouteUsesConflictGuard();
console.log('critical booking regressions passed');
