'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  bookingBlocksSchedule,
  canMutateBooking,
  canEditHistoricalBooking,
  isHistoricalBookingStatus,
  shouldCheckBookingConflicts,
} = require('../lib/booking-status');

function testBookingMutationPermissions() {
  const active = { id: 10, status: 'confirmed', student_id: 100, instructor_id: 200 };
  const completed = { ...active, status: 'completed' };
  const cancelled = { ...active, status: 'cancelled' };

  assert.strictEqual(canMutateBooking({ id: 1, role: 'owner' }, active), true);
  assert.strictEqual(canMutateBooking({ id: 2, role: 'admin' }, active), true);
  assert.strictEqual(canMutateBooking({ id: 100, role: 'student' }, active), true);
  assert.strictEqual(canMutateBooking({ id: 200, role: 'instructor' }, active), true);
  assert.strictEqual(canMutateBooking({ id: 300, role: 'maintenance' }, active), false);

  assert.strictEqual(canEditHistoricalBooking({ id: 1, role: 'owner' }, completed), true);
  assert.strictEqual(canEditHistoricalBooking({ id: 2, role: 'admin' }, cancelled), true);
  assert.strictEqual(canEditHistoricalBooking({ id: 200, role: 'instructor' }, completed), true);
  assert.strictEqual(canEditHistoricalBooking({ id: 100, role: 'student' }, completed), false);
  assert.strictEqual(canEditHistoricalBooking({ id: 100, role: 'renter' }, completed), false);
  assert.strictEqual(canEditHistoricalBooking({ id: 300, role: 'maintenance' }, completed), false);
  assert.strictEqual(canEditHistoricalBooking({ id: 201, role: 'instructor' }, completed), false);
}

function testBookingConflictDecisions() {
  assert.strictEqual(isHistoricalBookingStatus('completed'), true);
  assert.strictEqual(isHistoricalBookingStatus('cancelled'), true);
  assert.strictEqual(bookingBlocksSchedule('confirmed'), true);
  assert.strictEqual(bookingBlocksSchedule('completed'), false);
  assert.strictEqual(bookingBlocksSchedule('cancelled'), false);

  assert.strictEqual(shouldCheckBookingConflicts({
    currentStatus: 'confirmed',
    nextStatus: 'confirmed',
    scheduleChanged: true,
  }), true);
  assert.strictEqual(shouldCheckBookingConflicts({
    currentStatus: 'confirmed',
    nextStatus: 'confirmed',
    scheduleChanged: false,
  }), false);
  assert.strictEqual(shouldCheckBookingConflicts({
    currentStatus: 'cancelled',
    nextStatus: 'confirmed',
    scheduleChanged: false,
  }), true);
  assert.strictEqual(shouldCheckBookingConflicts({
    currentStatus: 'completed',
    nextStatus: 'confirmed',
    scheduleChanged: false,
  }), true);
  assert.strictEqual(shouldCheckBookingConflicts({
    currentStatus: 'completed',
    nextStatus: 'completed',
    scheduleChanged: true,
  }), false);
}

function testBookingRouteWiring() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'bookings-routes.js'), 'utf8');
  assert(src.includes("require('../lib/booking-status')"), 'booking route must use shared booking status guards');
  assert(src.includes('if (isHistoricalBooking && !isStaffHistoricalEdit)'), 'historical participant edits must fail before side-effect sync');
  assert(!src.includes("['owner', 'admin', 'maintenance'].includes(user.role)"), 'maintenance must not mutate arbitrary bookings');
  assert(!src.includes('isAdmin || isHistoricalBooking ||'), 'historical edits must not be treated as staff edits for every participant');
  assert(src.includes('shouldCheckBookingConflicts({'), 'admin active edits and reactivations must run conflict checks');
}

testBookingMutationPermissions();
testBookingConflictDecisions();
testBookingRouteWiring();

console.log('critical bug regression checks passed');
