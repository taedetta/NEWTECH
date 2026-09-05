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
const { getPreferenceCatalog, appendUnsubscribeFooter, shouldSendEmail } = require('../lib/notification-prefs');
const { signUnsubscribeToken, verifyUnsubscribeToken, buildUnsubscribeUrl } = require('../lib/unsubscribe-token');
const { rowToPrefs, WRITABLE_PREF_COLUMNS } = require('../db/notification-prefs');
const { readUnsubscribeRequest } = require('../routes/email-unsubscribe');
const { shouldRunUpdateConflictCheck } = require('../routes/bookings-routes');

async function testRequiredEmailPreferences() {
  for (const type of [
    EMAIL_TYPES.password_reset,
    EMAIL_TYPES.account_approved,
    EMAIL_TYPES.account_rejected,
    EMAIL_TYPES.signup_pending,
    EMAIL_TYPES.account_invite,
    EMAIL_TYPES.profile_change,
    EMAIL_TYPES.welcome,
  ]) {
    assert.strictEqual(isRequiredEmailType(type), true);
    assert.strictEqual(WRITABLE_PREF_COLUMNS.includes(type), false);
    assert.strictEqual(rowToPrefs({ [type]: false })[type], true);
    assert.strictEqual(await shouldSendEmail(42, type), true);

    const email = appendUnsubscribeFooter('<p>Required</p>', 'Required', 42, type);
    assert.strictEqual(email.html, '<p>Required</p>');
    assert.strictEqual(email.text, 'Required');
  }

  const catalogTypes = getPreferenceCatalog('student', false)
    .flatMap((category) => category.types.map((type) => type.key));
  assert.strictEqual(catalogTypes.includes(EMAIL_TYPES.password_reset), false);
  assert.strictEqual(catalogTypes.includes(EMAIL_TYPES.profile_change), false);
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

  const tampered = readUnsubscribeRequest({
    query: { token, type: 'all' },
    body: {},
  });
  assert.deepStrictEqual(tampered, { error: 'invalid_type' });

  const valid = readUnsubscribeRequest({
    query: { token, type: EMAIL_TYPES.preflight_reminder },
    body: {},
  });
  assert.strictEqual(valid.error, undefined);
  assert.strictEqual(valid.verified.type, EMAIL_TYPES.preflight_reminder);
}

function testBookingConflictDecision() {
  assert.strictEqual(shouldRunUpdateConflictCheck({
    scheduleChanged: true,
    statusChanged: false,
    nextStatus: 'confirmed',
  }), true);

  assert.strictEqual(shouldRunUpdateConflictCheck({
    scheduleChanged: false,
    statusChanged: true,
    nextStatus: 'confirmed',
  }), true);

  assert.strictEqual(shouldRunUpdateConflictCheck({
    scheduleChanged: true,
    statusChanged: false,
    nextStatus: 'completed',
  }), false);
}

(async () => {
  await testRequiredEmailPreferences();
  testUnsubscribeTokenScope();
  testBookingConflictDecision();
  console.log('critical bug regressions passed');
})();
