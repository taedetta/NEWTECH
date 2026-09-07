'use strict';

process.env.APP_URL = process.env.APP_URL || 'https://example.test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'critical-regression-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

const assert = require('assert');

const dbIndexPath = require.resolve('../db/index');
require.cache[dbIndexPath] = {
  id: dbIndexPath,
  filename: dbIndexPath,
  loaded: true,
  exports: {
    query() {
      throw new Error('Unexpected database query in critical regression tests');
    },
    connect() {
      throw new Error('Unexpected database connection in critical regression tests');
    },
  },
};

const { EMAIL_TYPES, isRequiredEmailType } = require('../lib/email-types');
const { getPreferenceCatalog, appendUnsubscribeFooter } = require('../lib/notification-prefs');
const { signUnsubscribeToken, verifyUnsubscribeToken, buildUnsubscribeUrl } = require('../lib/unsubscribe-token');
const { rowToPrefs, WRITABLE_PREF_COLUMNS } = require('../db/notification-prefs');
const { shiftBookingTimesToFlightDate } = require('../lib/sync-flight-record');
const { shouldRunUpdateConflictCheck } = require('../routes/bookings-routes');
const { instructorHourRatesForUpdate } = require('../routes/instructor-hours');

function testRequiredEmailPreferences() {
  assert.strictEqual(isRequiredEmailType(EMAIL_TYPES.password_reset), true);
  assert.strictEqual(WRITABLE_PREF_COLUMNS.includes(EMAIL_TYPES.password_reset), false);
  assert.strictEqual(rowToPrefs({ password_reset: false }).password_reset, true);

  const catalogTypes = getPreferenceCatalog('student', false).flatMap((category) => category.types.map((type) => type.key));
  assert.strictEqual(catalogTypes.includes(EMAIL_TYPES.password_reset), false);

  const email = appendUnsubscribeFooter('<p>Reset</p>', 'Reset', 42, EMAIL_TYPES.password_reset);
  assert.strictEqual(email.html, '<p>Reset</p>');
  assert.strictEqual(email.text, 'Reset');
}

function testUnsubscribeTokenScope() {
  const token = signUnsubscribeToken(42, EMAIL_TYPES.preflight_reminder);
  assert.deepStrictEqual(verifyUnsubscribeToken(token), {
    userId: 42,
    type: EMAIL_TYPES.preflight_reminder,
  });

  assert.throws(() => signUnsubscribeToken(42, EMAIL_TYPES.password_reset), /Invalid unsubscribe type/);

  const url = new URL(buildUnsubscribeUrl(42, EMAIL_TYPES.booking_cancelled));
  const verified = verifyUnsubscribeToken(url.searchParams.get('token'));
  assert.strictEqual(url.searchParams.get('type'), EMAIL_TYPES.booking_cancelled);
  assert.strictEqual(verified.type, EMAIL_TYPES.booking_cancelled);
}

function testBookingDateShift() {
  const booking = {
    start_time: '2026-08-01T18:30:00.000Z',
    end_time: '2026-08-01T20:00:00.000Z',
  };

  assert.strictEqual(shiftBookingTimesToFlightDate(booking, '2026-08-01'), null);

  const shifted = shiftBookingTimesToFlightDate(booking, '2026-08-03');
  assert.strictEqual(shifted.startTime.toISOString(), '2026-08-03T18:30:00.000Z');
  assert.strictEqual(shifted.endTime.toISOString(), '2026-08-03T20:00:00.000Z');
}

function testBookingConflictDecision() {
  assert.strictEqual(shouldRunUpdateConflictCheck({
    scheduleChanged: false,
    statusChanged: true,
    nextStatus: 'confirmed',
  }), true);
  assert.strictEqual(shouldRunUpdateConflictCheck({
    scheduleChanged: true,
    statusChanged: false,
    nextStatus: 'confirmed',
  }), true);
  assert.strictEqual(shouldRunUpdateConflictCheck({
    scheduleChanged: true,
    statusChanged: false,
    nextStatus: 'completed',
  }), false);
}

function testInstructorRatePreservation() {
  const existing = { aircraft_rate: '150.00', instructor_rate: '80.00' };
  assert.deepStrictEqual(instructorHourRatesForUpdate('instructor', existing, {
    aircraft_rate: 1,
    instructor_rate: 1,
  }), {
    aircraftRate: '150.00',
    instructorRate: '80.00',
  });

  assert.deepStrictEqual(instructorHourRatesForUpdate('admin', existing, {
    aircraft_rate: '175.50',
    instructor_rate: '90.25',
  }), {
    aircraftRate: 175.5,
    instructorRate: 90.25,
  });

  assert.deepStrictEqual(instructorHourRatesForUpdate('owner', existing, {}), {
    aircraftRate: '150.00',
    instructorRate: '80.00',
  });
}

testRequiredEmailPreferences();
testUnsubscribeTokenScope();
testBookingDateShift();
testBookingConflictDecision();
testInstructorRatePreservation();

console.log('critical bug regressions passed');
