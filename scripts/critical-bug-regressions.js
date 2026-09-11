'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bookingsOverlap } = require('../lib/booking-overlap');
const {
  bookingStatusBlocksSchedule,
  shouldCheckBookingConflict,
  canEditHistoricalBooking,
} = require('../lib/booking-status');
const { REQUIRED_EMAIL_TYPES, isRequiredEmailType } = require('../lib/email-types');

function iso(hour, minute = 0) {
  return new Date(Date.UTC(2026, 8, 11, hour, minute)).toISOString();
}

function testHalfOpenBookingOverlap() {
  assert.strictEqual(
    bookingsOverlap(iso(13), iso(14), iso(14), iso(15)),
    false,
    'back-to-back bookings must not conflict'
  );
  assert.strictEqual(
    bookingsOverlap(iso(13), iso(14, 30), iso(14), iso(15)),
    true,
    'partially overlapping bookings must conflict'
  );
}

function testConflictPolicy() {
  assert.strictEqual(bookingStatusBlocksSchedule('confirmed'), true);
  assert.strictEqual(bookingStatusBlocksSchedule('completed'), false);
  assert.strictEqual(bookingStatusBlocksSchedule('cancelled'), false);

  assert.strictEqual(
    shouldCheckBookingConflict({
      currentStatus: 'confirmed',
      nextStatus: 'confirmed',
      scheduleChanged: true,
    }),
    true,
    'active booking reschedules must check conflicts for every role, including admins'
  );

  assert.strictEqual(
    shouldCheckBookingConflict({
      currentStatus: 'cancelled',
      nextStatus: 'confirmed',
      scheduleChanged: false,
    }),
    true,
    'reactivating a non-blocking booking must check conflicts even if times did not change'
  );

  assert.strictEqual(
    shouldCheckBookingConflict({
      currentStatus: 'completed',
      nextStatus: 'completed',
      scheduleChanged: false,
    }),
    false,
    'metadata-only completed booking edits do not need schedule conflict checks'
  );
}

function testHistoricalEditPermissions() {
  const completedBooking = {
    status: 'completed',
    student_id: 10,
    instructor_id: 20,
  };

  assert.strictEqual(
    canEditHistoricalBooking({ role: 'student', id: 10 }, completedBooking),
    false,
    'students must not edit completed bookings through the generic booking update route'
  );
  assert.strictEqual(
    canEditHistoricalBooking({ role: 'renter', id: 10 }, completedBooking),
    false,
    'renters must not edit completed bookings through the generic booking update route'
  );
  assert.strictEqual(
    canEditHistoricalBooking({ role: 'maintenance', id: 99 }, completedBooking),
    false,
    'maintenance users must not edit completed bookings through the generic booking update route'
  );
  assert.strictEqual(
    canEditHistoricalBooking({ role: 'instructor', id: 20 }, completedBooking),
    true,
    'assigned instructors may edit their own historical flight records'
  );
  assert.strictEqual(
    canEditHistoricalBooking({ role: 'admin', id: 1 }, completedBooking),
    true,
    'admins may edit historical bookings'
  );
}

function testRequiredEmailTypes() {
  for (const type of [
    'password_reset',
    'account_approved',
    'account_rejected',
    'signup_pending',
    'account_invite',
    'profile_change',
    'welcome',
  ]) {
    assert.ok(REQUIRED_EMAIL_TYPES.includes(type), `${type} must be classified as required`);
    assert.strictEqual(isRequiredEmailType(type), true, `${type} must bypass opt-out preferences`);
  }
  assert.strictEqual(
    isRequiredEmailType('preflight_reminder'),
    false,
    'optional operational reminders should remain user-configurable'
  );
}

function testCfiProfileRouteNotShadowed() {
  const profileRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'profile.js'), 'utf8');
  const endorsementsRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'endorsements.js'), 'utf8');
  assert.ok(
    endorsementsRoutes.includes("router.get('/cfi-profile'") && endorsementsRoutes.includes("router.put('/cfi-profile'"),
    'endorsements router must continue to provide legacy CFI profile routes'
  );
  assert.ok(
    !/router\.use\(\s*\(\s*req\s*,\s*res\s*\)\s*=>\s*\{\s*res\.status\(404\)/.test(profileRoutes),
    'profile router must not end with a catch-all that shadows /api/users/me/cfi-profile'
  );
}

testHalfOpenBookingOverlap();
testConflictPolicy();
testHistoricalEditPermissions();
testRequiredEmailTypes();
testCfiProfileRouteNotShadowed();

console.log('critical bug regressions passed');
