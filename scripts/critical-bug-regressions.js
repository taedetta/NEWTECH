'use strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'critical-bug-regression-secret';

const assert = require('assert');
const jwt = require('jsonwebtoken');

const {
  buildUnsubscribeUrl,
  verifyUnsubscribeToken,
} = require('../lib/unsubscribe-token');
const { REQUIRED_EMAIL_TYPES } = require('../lib/email-types');
const { computeFlightCharges } = require('../lib/flight-charges');
const {
  shiftedBookingTimesForDate,
  toDateOnly,
} = require('../lib/booking-date-shift');
const {
  bookingStatusBlocksSchedule,
} = require('../lib/booking-status');

function tokenFromUrl(url) {
  return new URL(url).searchParams.get('token');
}

function run() {
  const scopedUrl = buildUnsubscribeUrl(42, 'booking_confirmation');
  const scopedToken = tokenFromUrl(scopedUrl);
  assert.deepStrictEqual(
    verifyUnsubscribeToken(scopedToken),
    { userId: 42, type: 'booking_confirmation' },
    'unsubscribe token must bind the exact preference type'
  );

  const legacyUserOnlyToken = jwt.sign(
    { uid: 42, aud: 'email-unsub' },
    process.env.JWT_SECRET,
    { expiresIn: '365d' }
  );
  assert.strictEqual(
    verifyUnsubscribeToken(legacyUserOnlyToken),
    null,
    'legacy user-only unsubscribe tokens must not authorize mutable query-string scopes'
  );

  assert.ok(REQUIRED_EMAIL_TYPES.has('password_reset'), 'password reset must be marked as a required email type');

  const dualCharge = computeFlightCharges({
    lessonType: 'lesson',
    bookingType: 'dual',
    hobbsDelta: 1.2,
    dualHrs: 0,
    hourlyRate: 150,
    instructorRate: 75,
  });
  assert.strictEqual(dualCharge.instructionChargeAmount, 90, 'dual flights with blank dual hours bill instruction from Hobbs');

  const soloCharge = computeFlightCharges({
    lessonType: 'solo',
    bookingType: 'student_solo',
    hobbsDelta: 1.2,
    dualHrs: 0,
    hourlyRate: 150,
    instructorRate: 75,
  });
  assert.strictEqual(soloCharge.instructionChargeAmount, 0, 'solo flights must not default to Hobbs instruction billing');

  assert.strictEqual(toDateOnly('2026-08-03T15:30:00Z'), '2026-08-03');
  assert.strictEqual(
    shiftedBookingTimesForDate('2026-08-03T14:30:00.000Z', '2026-08-03T16:00:00.000Z', '2026-08-03'),
    null,
    'same-date history edits must not rewrite booking timestamps'
  );
  assert.deepStrictEqual(
    shiftedBookingTimesForDate('2026-08-03T14:30:00.000Z', '2026-08-03T16:00:00.000Z', '2026-08-04'),
    {
      startTime: '2026-08-04T14:30:00.000Z',
      endTime: '2026-08-04T16:00:00.000Z',
    },
    'date changes must preserve booking time-of-day and duration'
  );

  assert.strictEqual(bookingStatusBlocksSchedule('completed'), false);
  assert.strictEqual(bookingStatusBlocksSchedule('cancelled'), false);
  assert.strictEqual(bookingStatusBlocksSchedule('confirmed'), true);

  console.log('critical bug regression checks passed');
}

run();
