'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  shouldRunScheduleConflictCheck,
  nonAdminHistoricalEditError,
} = require('../lib/booking-status');
const {
  REQUIRED_EMAIL_TYPES,
  OPTIONAL_EMAIL_TYPES,
} = require('../lib/email-types');

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

function runEmailPreferenceRegressions() {
  assert.ok(REQUIRED_EMAIL_TYPES.has('password_reset'), 'password reset must be a required email');
  assert.ok(REQUIRED_EMAIL_TYPES.has('account_invite'), 'account invites must be required emails');
  assert.ok(!OPTIONAL_EMAIL_TYPES.includes('password_reset'), 'required emails must not be optional preferences');

  const token = fs.readFileSync(path.join(__dirname, '..', 'lib', 'unsubscribe-token.js'), 'utf8');
  assert.match(
    token,
    /jwt\.sign\(\{ uid: userId, type: safeType, aud: 'email-unsub' \}/,
    'unsubscribe tokens must bind the email type they can change'
  );
  assert.match(
    token,
    /Object\.prototype\.hasOwnProperty\.call\(payload \|\| \{\}, 'type'\)/,
    'legacy user-only unsubscribe tokens must be rejected'
  );
  assert.match(
    token,
    /OPTIONAL_EMAIL_TYPES\.includes\(raw\)/,
    'unsubscribe URLs must only be issued for optional email types'
  );

  const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'email-unsubscribe.js'), 'utf8');
  assert.match(route, /router\.post\('\/unsubscribe'/, 'unsubscribe mutation must be POST-only');
  assert.match(route, /title: 'Confirm unsubscribe'/, 'GET unsubscribe must render a confirmation page');
  const getUnsubscribeBlock = route.slice(
    route.indexOf("router.get('/unsubscribe'"),
    route.indexOf("router.post('/unsubscribe'")
  );
  assert.ok(getUnsubscribeBlock.length > 0, 'GET unsubscribe route must be present');
  assert.doesNotMatch(getUnsubscribeBlock, /updatePrefs/, 'GET unsubscribe must not mutate preferences');
  assert.match(
    route,
    /requestedType !== verified\.type/,
    'unsubscribe route must reject tampered type query/body values'
  );

  const prefs = fs.readFileSync(path.join(__dirname, '..', 'lib', 'notification-prefs.js'), 'utf8');
  assert.match(
    prefs,
    /REQUIRED_EMAIL_TYPES\.has\(emailType\)/,
    'required emails must not receive unsubscribe footers'
  );
  assert.match(
    prefs,
    /REQUIRED_EMAIL_TYPES\.has\(type\)/,
    'required emails must bypass opt-out preferences'
  );
  assert.match(
    prefs,
    /typeof html === 'string'/,
    'text-only optional emails must not crash footer insertion'
  );

  const dbPrefs = fs.readFileSync(path.join(__dirname, '..', 'db', 'notification-prefs.js'), 'utf8');
  assert.match(
    dbPrefs,
    /if \(REQUIRED_EMAIL_TYPES\.has\(col\)\) continue;/,
    'direct preference updates must ignore required email columns'
  );
}

runBookingStatusRegressions();
runBookingRouteWiringRegressions();
runEmailPreferenceRegressions();
console.log('critical regressions passed');
