'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  bookingBlocksSchedule,
  historicalBookingEditRestriction,
  shouldCheckScheduleConflicts,
} = require('../lib/booking-status');

assert.strictEqual(bookingBlocksSchedule('confirmed'), true, 'confirmed bookings block the schedule');
assert.strictEqual(bookingBlocksSchedule('cancelled'), false, 'cancelled bookings do not block the schedule');
assert.strictEqual(bookingBlocksSchedule('completed'), false, 'completed bookings do not block the schedule');

assert.strictEqual(
  shouldCheckScheduleConflicts({
    currentStatus: 'confirmed',
    nextStatus: 'confirmed',
    scheduleChanged: true,
  }),
  true,
  'active booking schedule edits must run conflict checks'
);

assert.strictEqual(
  shouldCheckScheduleConflicts({
    currentStatus: 'cancelled',
    nextStatus: 'confirmed',
    scheduleChanged: false,
  }),
  true,
  'reactivating a cancelled booking must run conflict checks even if times/resources did not change'
);

assert.strictEqual(
  shouldCheckScheduleConflicts({
    currentStatus: 'completed',
    nextStatus: 'completed',
    scheduleChanged: true,
  }),
  false,
  'completed bookings that remain completed do not block the active schedule'
);

assert.strictEqual(
  shouldCheckScheduleConflicts({
    currentStatus: 'confirmed',
    nextStatus: 'cancelled',
    scheduleChanged: true,
  }),
  false,
  'cancelling an active booking does not need an overlap conflict check'
);

assert.strictEqual(
  historicalBookingEditRestriction({
    userRole: 'student',
    isAdmin: false,
    bookingStatus: 'completed',
    body: { notes: 'change after completion' },
  }) !== null,
  true,
  'students/renters must not edit completed or cancelled bookings'
);

assert.strictEqual(
  historicalBookingEditRestriction({
    userRole: 'instructor',
    isAdmin: false,
    bookingStatus: 'completed',
    body: { lesson_type: 'Discovery Flight' },
  }) !== null,
  true,
  'non-admin instructors must not change billing-affecting historical fields'
);

assert.strictEqual(
  historicalBookingEditRestriction({
    userRole: 'instructor',
    isAdmin: false,
    bookingStatus: 'completed',
    body: { notes: 'debrief note' },
  }),
  null,
  'assigned instructors may still add non-billing notes to historical bookings'
);

assert.strictEqual(
  historicalBookingEditRestriction({
    userRole: 'admin',
    isAdmin: true,
    bookingStatus: 'completed',
    body: { lesson_type: 'Discovery Flight' },
  }),
  null,
  'admins retain historical correction access'
);

const routeSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'bookings-routes.js'), 'utf8');
assert(
  routeSource.includes('shouldCheckScheduleConflicts({'),
  'booking PUT route must use the shared conflict-check decision helper'
);
assert(
  !routeSource.includes('const isStaffHistoricalEdit = isAdmin || isHistoricalBooking'),
  'admin active booking edits must not be classified as historical edits'
);

console.log('critical booking regressions passed');
