'use strict';

const assert = require('assert');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'critical-bug-test-secret';
process.env.APP_URL = process.env.APP_URL || 'https://example.test';

const dbIndexPath = require.resolve('../db/index');
require.cache[dbIndexPath] = {
  id: dbIndexPath,
  filename: dbIndexPath,
  loaded: true,
  exports: {
    query: async () => {
      throw new Error('Unexpected real pool query in regression test');
    },
  },
};

const {
  EMAIL_TYPES,
  isRequiredEmailType,
  isPreferenceMutable,
} = require('../lib/email-types');
const {
  appendUnsubscribeFooter,
  getPreferenceCatalog,
  isEmailEnabledByPrefs,
} = require('../lib/notification-prefs');
const {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
  isUnsubscribableEmailType,
} = require('../lib/unsubscribe-token');
const { resolveRequest } = require('../routes/email-unsubscribe');
const { DEFAULT_PREFS, updatePrefs } = require('../db/notification-prefs');

function testRequiredEmailPolicy() {
  for (const type of [
    EMAIL_TYPES.password_reset,
    EMAIL_TYPES.account_approved,
    EMAIL_TYPES.account_rejected,
    EMAIL_TYPES.signup_pending,
    EMAIL_TYPES.account_invite,
    EMAIL_TYPES.profile_change,
    EMAIL_TYPES.welcome,
  ]) {
    assert.strictEqual(isRequiredEmailType(type), true, `${type} should be required`);
    assert.strictEqual(isPreferenceMutable(type), false, `${type} should not be directly mutable`);
    assert.strictEqual(isUnsubscribableEmailType(type), false, `${type} should not get unsubscribe tokens`);
    assert.strictEqual(
      isEmailEnabledByPrefs(type, { email_all_off: true, [type]: false }),
      true,
      `${type} must bypass opt-out preferences`
    );
  }

  assert.strictEqual(
    isEmailEnabledByPrefs(EMAIL_TYPES.booking_confirmation, { email_all_off: true }),
    false,
    'optional email types should still honor the all-off toggle'
  );
}

function testCatalogHidesRequiredTypes() {
  const visibleTypes = getPreferenceCatalog('student', false)
    .flatMap((category) => category.types.map((type) => type.key));

  assert(visibleTypes.includes(EMAIL_TYPES.booking_confirmation), 'optional booking preferences should remain visible');
  assert(!visibleTypes.includes(EMAIL_TYPES.password_reset), 'password reset should be hidden from preferences');
  assert(!visibleTypes.includes(EMAIL_TYPES.profile_change), 'profile change should be hidden from preferences');
}

function testUnsubscribeFooterPolicy() {
  const resetEmail = appendUnsubscribeFooter(
    '<html><body>Reset your password</body></html>',
    'Reset your password',
    42,
    EMAIL_TYPES.password_reset
  );
  assert(!resetEmail.html.includes('Unsubscribe'), 'required emails should not include unsubscribe HTML');
  assert(!resetEmail.text.includes('Unsubscribe'), 'required emails should not include unsubscribe text');

  const textOnlyOptional = appendUnsubscribeFooter(null, 'Endorsement expiring', 42, EMAIL_TYPES.endorsement_expiry);
  assert.strictEqual(textOnlyOptional.html, null, 'text-only optional emails should stay text-only');
  assert(textOnlyOptional.text.includes('Unsubscribe from Endorsement expiry alerts'), 'text-only optional emails should get text unsubscribe links');
}

function testSignedUnsubscribeScope() {
  const token = signUnsubscribeToken(42, EMAIL_TYPES.booking_confirmation);
  const verified = verifyUnsubscribeToken(token);
  assert.deepStrictEqual(verified, { userId: 42, emailType: EMAIL_TYPES.booking_confirmation });

  const ok = resolveRequest({ token, type: EMAIL_TYPES.booking_confirmation });
  assert.strictEqual(ok.userId, 42);
  assert.strictEqual(ok.emailType, EMAIL_TYPES.booking_confirmation);

  const tampered = resolveRequest({ token, type: EMAIL_TYPES.preflight_reminder });
  assert.strictEqual(tampered.errorStatus, 400, 'changing the type query string should invalidate the request');

  const legacyToken = jwt.sign({ uid: 42, aud: 'email-unsub' }, process.env.JWT_SECRET, { expiresIn: '365d' });
  assert.strictEqual(verifyUnsubscribeToken(legacyToken), null, 'legacy user-only tokens should not verify');
}

async function testRequiredColumnsAreNotUpdated() {
  const calls = [];
  const fakeDb = {
    async query(sql) {
      calls.push(sql);
      if (sql.startsWith('SELECT * FROM user_email_preferences')) {
        return { rows: [{ ...DEFAULT_PREFS, user_id: 42 }] };
      }
      return { rows: [] };
    },
  };

  await updatePrefs(42, { password_reset: false, booking_confirmation: false }, fakeDb);
  const updateSql = calls.find((sql) => sql.startsWith('UPDATE user_email_preferences SET'));
  assert(updateSql, 'optional preference update should still run');
  assert(updateSql.includes('booking_confirmation ='), 'optional preference should be updated');
  assert(!updateSql.includes('password_reset ='), 'required preference must not be updated');
}

async function main() {
  testRequiredEmailPolicy();
  testCatalogHidesRequiredTypes();
  testUnsubscribeFooterPolicy();
  testSignedUnsubscribeScope();
  await testRequiredColumnsAreNotUpdated();
  console.log('critical bug regressions passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
