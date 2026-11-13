'use strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'critical-bug-regression-secret';

const assert = require('assert');
const jwt = require('jsonwebtoken');

const { EMAIL_TYPES, REQUIRED_EMAIL_TYPES } = require('../lib/email-types');
const {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} = require('../lib/unsubscribe-token');
const {
  appendUnsubscribeFooter,
  getPreferenceCatalog,
  shouldSendEmail,
} = require('../lib/notification-prefs');
const { updatePrefs } = require('../db/notification-prefs');
const { readUnsubscribeTarget } = require('../routes/email-unsubscribe');
const {
  bookingBlocksSchedule,
  shouldCheckBookingConflicts,
} = require('../lib/booking-status');

async function testUnsubscribeSafety() {
  const token = signUnsubscribeToken(42, EMAIL_TYPES.booking_confirmation);
  assert.deepStrictEqual(
    verifyUnsubscribeToken(token, EMAIL_TYPES.booking_confirmation),
    { userId: 42, type: EMAIL_TYPES.booking_confirmation }
  );
  assert.strictEqual(verifyUnsubscribeToken(token, EMAIL_TYPES.flight_completed), null);

  const legacyToken = jwt.sign({ uid: 42, aud: 'email-unsub' }, process.env.JWT_SECRET);
  assert.strictEqual(verifyUnsubscribeToken(legacyToken, EMAIL_TYPES.booking_confirmation), null);

  assert.deepStrictEqual(
    readUnsubscribeTarget({ query: { token, type: EMAIL_TYPES.booking_confirmation } }),
    { token, type: EMAIL_TYPES.booking_confirmation, userId: 42 }
  );
  assert.ok(readUnsubscribeTarget({ query: { token, type: EMAIL_TYPES.flight_completed } }).error);
  assert.ok(readUnsubscribeTarget({ query: { token, type: EMAIL_TYPES.password_reset } }).error);
}

async function testRequiredEmailsCannotBeDisabled() {
  assert.strictEqual(await shouldSendEmail(42, EMAIL_TYPES.password_reset), true);

  const catalogTypes = getPreferenceCatalog('owner', false).flatMap((category) => category.types.map((t) => t.key));
  for (const type of REQUIRED_EMAIL_TYPES) {
    assert.ok(!catalogTypes.includes(type), `${type} should not be exposed as a preference`);
  }

  const requiredWithFooter = appendUnsubscribeFooter('<body>Reset</body>', 'Reset', 42, EMAIL_TYPES.password_reset);
  assert.strictEqual(requiredWithFooter.html, '<body>Reset</body>');
  assert.strictEqual(requiredWithFooter.text, 'Reset');

  const textOnly = appendUnsubscribeFooter(null, 'Endorsement expiring', 42, EMAIL_TYPES.endorsement_expiry);
  assert.strictEqual(textOnly.html, null);
  assert.match(textOnly.text, /Unsubscribe from Endorsement expiry alerts/);

  const queries = [];
  const fakeDb = {
    async query(sql, args) {
      queries.push({ sql, args });
      if (/SELECT \*/.test(sql)) {
        return { rows: [{ user_id: 42, email_all_off: true, booking_confirmation: false, password_reset: false }] };
      }
      return { rows: [] };
    },
  };

  await updatePrefs(42, {
    email_all_off: true,
    booking_confirmation: false,
    password_reset: false,
    profile_change: false,
  }, fakeDb);

  const update = queries.find((q) => q.sql.trim().startsWith('UPDATE user_email_preferences'));
  assert.ok(update, 'expected preferences UPDATE');
  assert.match(update.sql, /email_all_off/);
  assert.match(update.sql, /booking_confirmation/);
  assert.doesNotMatch(update.sql, /password_reset/);
  assert.doesNotMatch(update.sql, /profile_change/);
}

function testBookingConflictDecisions() {
  assert.strictEqual(bookingBlocksSchedule('confirmed'), true);
  assert.strictEqual(bookingBlocksSchedule('completed'), false);
  assert.strictEqual(bookingBlocksSchedule('cancelled'), false);

  assert.strictEqual(shouldCheckBookingConflicts({
    currentStatus: 'confirmed',
    nextStatus: 'confirmed',
    scheduleChanged: true,
  }), true);
  assert.strictEqual(shouldCheckBookingConflicts({
    currentStatus: 'cancelled',
    nextStatus: 'confirmed',
    scheduleChanged: false,
  }), true);
  assert.strictEqual(shouldCheckBookingConflicts({
    currentStatus: 'completed',
    nextStatus: 'completed',
    scheduleChanged: true,
  }), false);
  assert.strictEqual(shouldCheckBookingConflicts({
    currentStatus: 'confirmed',
    nextStatus: 'confirmed',
    scheduleChanged: false,
  }), false);
}

(async () => {
  await testUnsubscribeSafety();
  await testRequiredEmailsCannotBeDisabled();
  testBookingConflictDecisions();
  console.log('critical bug regression checks passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
