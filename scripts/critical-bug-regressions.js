'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  canEditHistoricalBooking,
  canManageBookingBilling,
  isScheduleBlockingStatus,
  needsScheduleConflictCheck,
} = require('../lib/booking-status');

function runBookingStatusRegressions() {
  assert.strictEqual(isScheduleBlockingStatus('confirmed'), true, 'confirmed bookings block the schedule');
  assert.strictEqual(isScheduleBlockingStatus('cancelled'), false, 'cancelled bookings do not block the schedule');
  assert.strictEqual(isScheduleBlockingStatus('completed'), false, 'completed bookings do not block the schedule');

  assert.strictEqual(
    needsScheduleConflictCheck({
      previousStatus: 'confirmed',
      nextStatus: 'confirmed',
      scheduleChanged: true,
    }),
    true,
    'active booking reschedules must be conflict-checked, including admin edits'
  );

  assert.strictEqual(
    needsScheduleConflictCheck({
      previousStatus: 'cancelled',
      nextStatus: 'confirmed',
      scheduleChanged: false,
    }),
    true,
    'reactivating a cancelled booking must be conflict-checked even if times do not change'
  );

  assert.strictEqual(
    needsScheduleConflictCheck({
      previousStatus: 'completed',
      nextStatus: 'confirmed',
      scheduleChanged: false,
    }),
    true,
    'reactivating a completed booking must be conflict-checked even if times do not change'
  );

  assert.strictEqual(
    needsScheduleConflictCheck({
      previousStatus: 'completed',
      nextStatus: 'completed',
      scheduleChanged: true,
    }),
    false,
    'historical booking edits that remain historical can skip schedule conflicts'
  );

  assert.strictEqual(
    needsScheduleConflictCheck({
      previousStatus: 'confirmed',
      nextStatus: 'cancelled',
      scheduleChanged: true,
    }),
    false,
    'updates that make a booking non-blocking do not need schedule conflict checks'
  );

  assert.strictEqual(canEditHistoricalBooking('student'), false, 'students cannot edit historical bookings');
  assert.strictEqual(canEditHistoricalBooking('renter'), false, 'renters cannot edit historical bookings');
  assert.strictEqual(
    canEditHistoricalBooking('instructor', { isAssignedInstructor: true }),
    true,
    'assigned instructors can edit their own historical bookings'
  );
  assert.strictEqual(canEditHistoricalBooking('admin'), true, 'admins can edit historical bookings');
  assert.strictEqual(canEditHistoricalBooking('owner'), true, 'owners can edit historical bookings');

  assert.strictEqual(canManageBookingBilling('instructor'), false, 'instructors cannot override billing totals');
  assert.strictEqual(canManageBookingBilling('admin'), true, 'admins can override billing totals');
  assert.strictEqual(canManageBookingBilling('owner'), true, 'owners can override billing totals');
}

runBookingStatusRegressions();

const bookingRoutesSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'bookings-routes.js'), 'utf8');
assert(
  bookingRoutesSource.includes('needsScheduleConflictCheck({'),
  'booking update route must use the shared conflict decision helper'
);
assert(
  !bookingRoutesSource.includes('skipConflictCheck = isStaffHistoricalEdit'),
  'staff/historical policy flags must not disable conflict checks for schedule-blocking updates'
);

console.log('critical booking regressions passed');
