'use strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'critical-bug-test-secret';

const assert = require('assert');
const jwt = require('jsonwebtoken');

const {
  bookingBlocksSchedule,
  bookingUpdateNeedsConflictCheck,
} = require('../lib/booking-status');
const {
  buildUnsubscribeUrl,
  verifyUnsubscribeToken,
} = require('../lib/unsubscribe-token');
const {
  appendUnsubscribeFooter,
  getPreferenceCatalog,
  shouldSendEmail,
} = require('../lib/notification-prefs');
const { rowToPrefs } = require('../db/notification-prefs');
const { getValidatedUnsubscribeRequest } = require('../routes/email-unsubscribe');

function mockRes() {
  return {
    statusCode: 200,
    body: '',
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
  };
}

async function main() {
  assert.strictEqual(bookingBlocksSchedule('confirmed'), true);
  assert.strictEqual(bookingBlocksSchedule('cancelled'), false);
  assert.strictEqual(bookingBlocksSchedule('completed'), false);
  assert.strictEqual(
    bookingUpdateNeedsConflictCheck({ currentStatus: 'confirmed', nextStatus: 'confirmed', scheduleChanged: true }),
    true,
    'active booking schedule edits must check conflicts'
  );
  assert.strictEqual(
    bookingUpdateNeedsConflictCheck({ currentStatus: 'cancelled', nextStatus: 'confirmed', scheduleChanged: false }),
    true,
    'reactivating a non-blocking booking must check conflicts even without a time change'
  );
  assert.strictEqual(
    bookingUpdateNeedsConflictCheck({ currentStatus: 'confirmed', nextStatus: 'cancelled', scheduleChanged: true }),
    false,
    'updates ending in a non-blocking status do not need schedule conflicts'
  );

  const unsubscribeUrl = new URL(buildUnsubscribeUrl(123, 'booking_cancelled'));
  const token = unsubscribeUrl.searchParams.get('token');
  const verified = verifyUnsubscribeToken(token);
  assert.deepStrictEqual(verified, { userId: 123, type: 'booking_cancelled' });

  const tamperedRes = mockRes();
  const tampered = getValidatedUnsubscribeRequest({
    query: { token, type: 'all' },
    body: {},
  }, tamperedRes);
  assert.strictEqual(tampered, null, 'query string must not be able to change a token-bound unsubscribe type');
  assert.strictEqual(tamperedRes.statusCode, 400);

  const legacyToken = jwt.sign({ uid: 123, aud: 'email-unsub' }, process.env.JWT_SECRET, { expiresIn: '365d' });
  assert.strictEqual(verifyUnsubscribeToken(legacyToken), null, 'unbound legacy unsubscribe tokens must be rejected');

  const requiredPrefs = rowToPrefs({ email_all_off: true, password_reset: false, profile_change: false });
  assert.strictEqual(requiredPrefs.password_reset, true);
  assert.strictEqual(requiredPrefs.profile_change, true);
  assert.strictEqual(await shouldSendEmail(123, 'password_reset'), true, 'required email bypasses opt-out prefs');

  const catalogKeys = getPreferenceCatalog('student', false).flatMap((category) => category.types.map((type) => type.key));
  assert(!catalogKeys.includes('password_reset'), 'required emails should not appear in preference catalog');
  assert(!catalogKeys.includes('profile_change'), 'account-security emails should not appear in preference catalog');

  const requiredFooter = appendUnsubscribeFooter('<body>reset</body>', 'reset', 123, 'password_reset');
  assert.strictEqual(requiredFooter.html, '<body>reset</body>');
  assert.strictEqual(requiredFooter.text, 'reset');

  const textOnlyFooter = appendUnsubscribeFooter(null, 'briefing', 123, 'instructor_briefing');
  assert.strictEqual(textOnlyFooter.html, null);
  assert(textOnlyFooter.text.includes('Unsubscribe from Daily instructor briefing'));

  console.log('critical bug regression checks passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
