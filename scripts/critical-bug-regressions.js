'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  canEditHistoricalBooking,
  isKnownBookingStatus,
  isScheduleBlockingStatus,
  shouldCheckScheduleConflicts,
} = require('../lib/booking-status');

function testBookingStatusConflictRules() {
  assert.strictEqual(isScheduleBlockingStatus('confirmed'), true);
  assert.strictEqual(isScheduleBlockingStatus('pending'), true);
  assert.strictEqual(isScheduleBlockingStatus('completed'), false);
  assert.strictEqual(isScheduleBlockingStatus('cancelled'), false);
  assert.strictEqual(isKnownBookingStatus(''), false);
  assert.strictEqual(isKnownBookingStatus('confirmed'), true);

  assert.strictEqual(
    shouldCheckScheduleConflicts({
      existingStatus: 'confirmed',
      effectiveStatus: 'confirmed',
      scheduleChanged: true,
    }),
    true,
    'active schedule edits must check conflicts'
  );

  assert.strictEqual(
    shouldCheckScheduleConflicts({
      existingStatus: 'completed',
      effectiveStatus: 'confirmed',
      scheduleChanged: false,
    }),
    true,
    'reactivating a completed booking must check conflicts even when times are unchanged'
  );

  assert.strictEqual(
    shouldCheckScheduleConflicts({
      existingStatus: 'cancelled',
      effectiveStatus: 'confirmed',
      scheduleChanged: false,
    }),
    true,
    'reactivating a cancelled booking must check conflicts even when times are unchanged'
  );

  assert.strictEqual(
    shouldCheckScheduleConflicts({
      existingStatus: 'completed',
      effectiveStatus: 'completed',
      scheduleChanged: true,
    }),
    false,
    'historical edits that remain non-blocking do not need schedule conflicts'
  );
}

function testHistoricalEditPermissions() {
  const completedSolo = { status: 'completed', student_id: 10, instructor_id: null };
  const completedDual = { status: 'completed', student_id: 10, instructor_id: 20 };

  assert.strictEqual(canEditHistoricalBooking({ id: 10, role: 'student' }, completedSolo), false);
  assert.strictEqual(canEditHistoricalBooking({ id: 10, role: 'renter' }, completedSolo), false);
  assert.strictEqual(canEditHistoricalBooking({ id: 20, role: 'instructor' }, completedDual), true);
  assert.strictEqual(canEditHistoricalBooking({ id: 30, role: 'instructor' }, completedDual), false);
  assert.strictEqual(canEditHistoricalBooking({ id: 1, role: 'admin' }, completedSolo), true);
  assert.strictEqual(canEditHistoricalBooking({ id: 2, role: 'owner' }, completedSolo), true);
}

function testRouteWiring() {
  const routeSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'bookings-routes.js'), 'utf8');
  assert.match(routeSource, /shouldCheckScheduleConflicts\(\{/);
  assert.match(routeSource, /canEditHistoricalBooking\(req\.user, b\)/);
  assert.doesNotMatch(routeSource, /const skipConflictCheck = isStaffHistoricalEdit/);
}

testBookingStatusConflictRules();
testHistoricalEditPermissions();
testRouteWiring();

console.log('critical bug regressions passed');
