'use strict';

const assert = require('assert');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'test-critical-bug-fixes-secret';
process.env.APP_URL = 'https://example.test';

const {
  buildUnsubscribeUrl,
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} = require('../lib/unsubscribe-token');
const {
  bookingStatusBlocksSchedule,
  bookingUpdateNeedsConflictCheck,
} = require('../lib/booking-status');

function testUnsubscribeTokens() {
  const url = new URL(buildUnsubscribeUrl(42, 'booking_confirmation'));
  const token = url.searchParams.get('token');

  assert.strictEqual(url.searchParams.get('type'), 'booking_confirmation');
  assert.deepStrictEqual(
    verifyUnsubscribeToken(token, 'booking_confirmation'),
    { userId: 42, type: 'booking_confirmation' }
  );
  assert.strictEqual(
    verifyUnsubscribeToken(token, 'password_reset'),
    null,
    'a token for one email type must not authorize another type'
  );

  const allToken = signUnsubscribeToken(42, 'all');
  assert.deepStrictEqual(verifyUnsubscribeToken(allToken, 'all'), { userId: 42, type: 'all' });

  const legacyUserOnlyToken = jwt.sign(
    { uid: 42, aud: 'email-unsub' },
    process.env.JWT_SECRET,
    { expiresIn: '365d' }
  );
  assert.strictEqual(
    verifyUnsubscribeToken(legacyUserOnlyToken, 'booking_confirmation'),
    null,
    'legacy user-only tokens are unsafe because the query string can choose the type'
  );
}

function testBookingConflictGate() {
  assert.strictEqual(bookingStatusBlocksSchedule('confirmed'), true);
  assert.strictEqual(bookingStatusBlocksSchedule('completed'), false);
  assert.strictEqual(bookingStatusBlocksSchedule('cancelled'), false);

  assert.strictEqual(
    bookingUpdateNeedsConflictCheck({
      previousStatus: 'confirmed',
      nextStatus: 'confirmed',
      scheduleChanged: true,
    }),
    true,
    'moving an active booking must check conflicts'
  );
  assert.strictEqual(
    bookingUpdateNeedsConflictCheck({
      previousStatus: 'completed',
      nextStatus: 'confirmed',
      scheduleChanged: false,
    }),
    true,
    'reactivating a historical booking must check conflicts even if times did not change'
  );
  assert.strictEqual(
    bookingUpdateNeedsConflictCheck({
      previousStatus: 'cancelled',
      nextStatus: 'confirmed',
      scheduleChanged: false,
    }),
    true,
    'reactivating a cancelled booking must check conflicts'
  );
  assert.strictEqual(
    bookingUpdateNeedsConflictCheck({
      previousStatus: 'confirmed',
      nextStatus: 'cancelled',
      scheduleChanged: true,
    }),
    false,
    'moving a booking while cancelling it does not create an active schedule blocker'
  );
  assert.strictEqual(
    bookingUpdateNeedsConflictCheck({
      previousStatus: 'completed',
      nextStatus: 'completed',
      scheduleChanged: true,
    }),
    false,
    'historical-only edits do not need active schedule conflict checks'
  );
}

testUnsubscribeTokens();
testBookingConflictGate();
console.log('critical bug regression checks passed');
