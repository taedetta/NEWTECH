'use strict';

const assert = require('assert');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'critical-regression-test-secret';

const {
  EMAIL_TYPES,
  isRequiredEmailType,
  isEmailTypeMutable,
} = require('../lib/email-types');
const {
  getPreferenceCatalog,
  appendUnsubscribeFooter,
  shouldSendEmail,
} = require('../lib/notification-prefs');
const {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} = require('../lib/unsubscribe-token');
const { resolveUnsubscribeType } = require('../routes/email-unsubscribe');
const {
  rowToPrefs,
  updatePrefs,
} = require('../db/notification-prefs');

async function testRequiredAccountEmailsAreNotUserMutable() {
  const required = [
    EMAIL_TYPES.password_reset,
    EMAIL_TYPES.account_approved,
    EMAIL_TYPES.account_rejected,
    EMAIL_TYPES.signup_pending,
    EMAIL_TYPES.account_invite,
    EMAIL_TYPES.profile_change,
    EMAIL_TYPES.welcome,
  ];

  for (const type of required) {
    assert.strictEqual(isRequiredEmailType(type), true, `${type} should be required`);
    assert.strictEqual(isEmailTypeMutable(type), false, `${type} should not be user-mutable`);
  }

  const catalogTypes = getPreferenceCatalog('student', false)
    .flatMap((category) => category.types.map((type) => type.key));
  for (const type of required) {
    assert.ok(!catalogTypes.includes(type), `${type} should be hidden from preference UI catalog`);
  }

  const prefs = rowToPrefs({
    email_all_off: true,
    password_reset: false,
    account_approved: false,
    profile_change: false,
  });
  assert.strictEqual(prefs.email_all_off, true);
  assert.strictEqual(prefs.password_reset, true);
  assert.strictEqual(prefs.account_approved, true);
  assert.strictEqual(prefs.profile_change, true);

  assert.strictEqual(await shouldSendEmail(123, EMAIL_TYPES.password_reset), true);
}

function testRequiredEmailsDoNotGetUnsubscribeFooters() {
  const html = '<html><body>Password reset</body></html>';
  const text = 'Password reset';
  const withFooter = appendUnsubscribeFooter(html, text, 123, EMAIL_TYPES.password_reset);
  assert.strictEqual(withFooter.html, html);
  assert.strictEqual(withFooter.text, text);

  const textOnly = appendUnsubscribeFooter(null, 'Endorsement expiring', 123, EMAIL_TYPES.endorsement_expiry);
  assert.strictEqual(textOnly.html, null);
  assert.match(textOnly.text, /Unsubscribe from Endorsement expiry alerts/);
}

function testUnsubscribeTokensAreBoundToType() {
  const token = signUnsubscribeToken(123, EMAIL_TYPES.booking_confirmation);
  const verified = verifyUnsubscribeToken(token);
  assert.deepStrictEqual(verified, { userId: 123, type: EMAIL_TYPES.booking_confirmation });

  assert.deepStrictEqual(
    resolveUnsubscribeType(EMAIL_TYPES.booking_confirmation, verified),
    { ok: true, type: EMAIL_TYPES.booking_confirmation }
  );
  assert.strictEqual(resolveUnsubscribeType(EMAIL_TYPES.preflight_reminder, verified).ok, false);
  assert.strictEqual(resolveUnsubscribeType(EMAIL_TYPES.password_reset, verified).ok, false);

  const allToken = signUnsubscribeToken(123, 'all');
  assert.deepStrictEqual(verifyUnsubscribeToken(allToken), { userId: 123, type: 'all' });
  assert.deepStrictEqual(resolveUnsubscribeType('all', verifyUnsubscribeToken(allToken)), { ok: true, type: 'all' });
}

async function testRequiredPreferencePatchesAreIgnored() {
  const statements = [];
  const fakeDb = {
    async query(sql) {
      statements.push(String(sql));
      if (String(sql).startsWith('SELECT * FROM user_email_preferences')) {
        return { rows: [{ user_id: 123, email_all_off: true, booking_confirmation: false, password_reset: false }] };
      }
      return { rows: [] };
    },
  };

  await updatePrefs(123, {
    email_all_off: true,
    booking_confirmation: false,
    password_reset: false,
    account_approved: false,
    profile_change: false,
  }, fakeDb);

  const updateStatement = statements.find((sql) => sql.startsWith('UPDATE user_email_preferences SET'));
  assert.ok(updateStatement, 'expected update statement');
  assert.match(updateStatement, /email_all_off/);
  assert.match(updateStatement, /booking_confirmation/);
  assert.doesNotMatch(updateStatement, /password_reset/);
  assert.doesNotMatch(updateStatement, /account_approved/);
  assert.doesNotMatch(updateStatement, /profile_change/);
}

async function main() {
  await testRequiredAccountEmailsAreNotUserMutable();
  testRequiredEmailsDoNotGetUnsubscribeFooters();
  testUnsubscribeTokensAreBoundToType();
  await testRequiredPreferencePatchesAreIgnored();
  console.log('critical bug regression checks passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
