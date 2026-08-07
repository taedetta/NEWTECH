'use strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'critical-bug-regression-secret';
process.env.APP_URL = process.env.APP_URL || 'https://example.test';

const assert = require('assert');
const jwt = require('jsonwebtoken');
const {
  buildUnsubscribeUrl,
  normalizeUnsubscribeType,
  verifyUnsubscribeToken,
} = require('../lib/unsubscribe-token');
const {
  EMAIL_TYPES,
  OPTIONAL_EMAIL_TYPES,
  REQUIRED_EMAIL_TYPES,
  TYPE_CATEGORIES,
} = require('../lib/email-types');
const { shouldRunBookingConflictCheck } = require('../lib/booking-status');

function tokenFrom(url) {
  return new URL(url).searchParams.get('token');
}

function queryTypeFrom(url) {
  return new URL(url).searchParams.get('type');
}

function testUnsubscribeTokensBindType() {
  const url = buildUnsubscribeUrl(123, EMAIL_TYPES.booking_confirmation);
  const token = tokenFrom(url);
  const verified = verifyUnsubscribeToken(token);

  assert.deepStrictEqual(verified, {
    userId: 123,
    type: EMAIL_TYPES.booking_confirmation,
  });
  assert.strictEqual(queryTypeFrom(url), EMAIL_TYPES.booking_confirmation);

  const tamperedUrl = new URL(url);
  tamperedUrl.searchParams.set('type', 'all');
  assert.notStrictEqual(
    tamperedUrl.searchParams.get('type'),
    verifyUnsubscribeToken(token).type,
    'route-level query comparison must reject tampered unsubscribe types'
  );
}

function testUserOnlyLegacyTokensAreRejected() {
  const userOnlyToken = jwt.sign(
    { uid: 123, aud: 'email-unsub' },
    process.env.JWT_SECRET,
    { expiresIn: '365d' }
  );
  assert.strictEqual(
    verifyUnsubscribeToken(userOnlyToken),
    null,
    'tokens without a bound unsubscribe type must not be accepted'
  );

  const typedLegacyToken = jwt.sign(
    { uid: 123, type: EMAIL_TYPES.booking_cancelled },
    process.env.JWT_SECRET,
    { expiresIn: '365d' }
  );
  assert.deepStrictEqual(verifyUnsubscribeToken(typedLegacyToken), {
    userId: 123,
    type: EMAIL_TYPES.booking_cancelled,
  });
}

function testPasswordResetIsRequired() {
  assert.strictEqual(REQUIRED_EMAIL_TYPES.password_reset, EMAIL_TYPES.password_reset);
  assert.strictEqual(OPTIONAL_EMAIL_TYPES.password_reset, undefined);
  assert.strictEqual(normalizeUnsubscribeType(EMAIL_TYPES.password_reset), 'all');

  const visiblePreferenceTypes = TYPE_CATEGORIES.flatMap((category) => category.types);
  assert.ok(
    !visiblePreferenceTypes.includes(EMAIL_TYPES.password_reset),
    'password reset must not be exposed as a user-disableable preference'
  );
}

function testBookingConflictChecksForBlockingUpdates() {
  assert.strictEqual(
    shouldRunBookingConflictCheck({
      currentStatus: 'confirmed',
      nextStatus: 'confirmed',
      scheduleChanged: true,
    }),
    true,
    'rescheduling an active booking must check conflicts, including admin edits'
  );

  assert.strictEqual(
    shouldRunBookingConflictCheck({
      currentStatus: 'cancelled',
      nextStatus: 'confirmed',
      scheduleChanged: false,
    }),
    true,
    'reactivating a cancelled booking must check conflicts even if times did not change'
  );

  assert.strictEqual(
    shouldRunBookingConflictCheck({
      currentStatus: 'completed',
      nextStatus: 'completed',
      scheduleChanged: true,
    }),
    false,
    'historical completed edits should not block schedule maintenance'
  );

  assert.strictEqual(
    shouldRunBookingConflictCheck({
      currentStatus: 'confirmed',
      nextStatus: 'cancelled',
      scheduleChanged: true,
    }),
    false,
    'moving a booking while cancelling it does not create a schedule blocker'
  );
}

testUnsubscribeTokensBindType();
testUserOnlyLegacyTokensAreRejected();
testPasswordResetIsRequired();
testBookingConflictChecksForBlockingUpdates();

console.log('critical bug regressions passed');
