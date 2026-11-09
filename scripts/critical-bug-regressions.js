'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  shouldRunScheduleConflictCheck,
  nonAdminHistoricalEditError,
} = require('../lib/booking-status');

function runBookingStatusRegressions() {
  assert.strictEqual(
    shouldRunScheduleConflictCheck({ currentStatus: 'confirmed', nextStatus: 'confirmed', scheduleChanged: true }),
    true,
    'active booking schedule edits must run conflict checks'
  );
  assert.strictEqual(
    shouldRunScheduleConflictCheck({ currentStatus: 'confirmed', nextStatus: 'confirmed', scheduleChanged: false }),
    false,
    'metadata-only active booking edits do not need conflict checks'
  );
  assert.strictEqual(
    shouldRunScheduleConflictCheck({ currentStatus: 'cancelled', nextStatus: 'confirmed', scheduleChanged: false }),
    true,
    'reactivating a historical booking must run conflict checks even if times are unchanged'
  );
  assert.strictEqual(
    shouldRunScheduleConflictCheck({ currentStatus: 'completed', nextStatus: 'cancelled', scheduleChanged: true }),
    false,
    'historical edits that remain non-blocking should not block on schedule conflicts'
  );
  assert.strictEqual(
    shouldRunScheduleConflictCheck({ currentStatus: 'completed', nextStatus: 'confirmed', scheduleChanged: true }),
    true,
    'historical bookings moved back onto the active schedule must be conflict-checked'
  );

  assert.ok(
    nonAdminHistoricalEditError({
      isAdmin: false,
      userRole: 'student',
      isAssignedInstructor: false,
      isHistoricalBooking: true,
      body: { notes: 'change' },
    }),
    'students must not edit completed/cancelled bookings'
  );
  assert.ok(
    nonAdminHistoricalEditError({
      isAdmin: false,
      userRole: 'instructor',
      isAssignedInstructor: true,
      isHistoricalBooking: true,
      body: { lesson_type: 'Discovery Flight' },
    }),
    'instructors must not change historical billing-affecting fields'
  );
  assert.strictEqual(
    nonAdminHistoricalEditError({
      isAdmin: false,
      userRole: 'instructor',
      isAssignedInstructor: true,
      isHistoricalBooking: true,
      body: { notes: 'post-flight note' },
    }),
    null,
    'assigned instructors may still update notes on historical bookings'
  );
  assert.strictEqual(
    nonAdminHistoricalEditError({
      isAdmin: true,
      userRole: 'admin',
      isAssignedInstructor: false,
      isHistoricalBooking: true,
      body: { lesson_type: 'Discovery Flight' },
    }),
    null,
    'admins retain historical edit access'
  );
}

function runBookingRouteWiringRegressions() {
  const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'bookings-routes.js'), 'utf8');
  assert.match(
    route,
    /shouldRunScheduleConflictCheck\(\{/,
    'booking PUT route must use the schedule-blocking conflict decision helper'
  );
  assert.doesNotMatch(
    route,
    /skipConflictCheck\s*=\s*isStaffHistoricalEdit/,
    'admin/staff edits must not bypass conflict checks solely because the user is staff'
  );
  assert.match(
    route,
    /nonAdminHistoricalEditError\(\{/,
    'booking PUT route must reject non-admin historical edits that can rewrite billing'
  );
}

runBookingStatusRegressions();
runBookingRouteWiringRegressions();
console.log('critical booking regressions passed');
