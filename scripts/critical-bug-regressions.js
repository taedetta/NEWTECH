'use strict';

const assert = require('assert');
const { bookingsOverlap } = require('../lib/booking-overlap');
const { canEditHistoricalBooking, isHistoricalBookingStatus } = require('../lib/booking-status');

function user(role, id) {
  return { role, id };
}

function booking(status, overrides = {}) {
  return {
    status,
    student_id: 10,
    instructor_id: 20,
    ...overrides,
  };
}

function runBookingStatusTests() {
  assert.strictEqual(isHistoricalBookingStatus('completed'), true);
  assert.strictEqual(isHistoricalBookingStatus('cancelled'), true);
  assert.strictEqual(isHistoricalBookingStatus('confirmed'), false);

  const completed = booking('completed');
  const cancelled = booking('cancelled');

  assert.strictEqual(canEditHistoricalBooking(user('student', 10), completed), false);
  assert.strictEqual(canEditHistoricalBooking(user('renter', 10), completed), false);
  assert.strictEqual(canEditHistoricalBooking(user('maintenance', 99), completed), false);
  assert.strictEqual(canEditHistoricalBooking(user('instructor', 21), completed), false);
  assert.strictEqual(canEditHistoricalBooking(user('instructor', 20), completed), true);
  assert.strictEqual(canEditHistoricalBooking(user('admin', 99), completed), true);
  assert.strictEqual(canEditHistoricalBooking(user('owner', 99), cancelled), true);

  // Non-historical bookings continue through the route's normal access checks.
  assert.strictEqual(canEditHistoricalBooking(user('student', 10), booking('confirmed')), true);
}

function runOverlapTests() {
  const firstStart = '2026-09-17T17:00:00.000Z';
  const firstEnd = '2026-09-17T18:00:00.000Z';

  assert.strictEqual(bookingsOverlap(firstStart, firstEnd, '2026-09-17T18:00:00.000Z', '2026-09-17T19:00:00.000Z'), false);
  assert.strictEqual(bookingsOverlap(firstStart, firstEnd, '2026-09-17T17:30:00.000Z', '2026-09-17T18:30:00.000Z'), true);
}

runBookingStatusTests();
runOverlapTests();

console.log('critical bug regression checks passed');
