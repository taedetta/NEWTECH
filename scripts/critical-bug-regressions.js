'use strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'critical-bug-test-secret';
process.env.APP_URL = process.env.APP_URL || 'https://example.test';

const assert = require('assert');
const jwt = require('jsonwebtoken');

const { EMAIL_TYPES } = require('../lib/email-types');
const {
  appendUnsubscribeFooter,
  getPreferenceCatalog,
  shouldSendEmail,
} = require('../lib/notification-prefs');
const {
  buildUnsubscribeUrl,
  verifyUnsubscribeToken,
} = require('../lib/unsubscribe-token');
const { rowToPrefs } = require('../db/notification-prefs');

async function run() {
  const unsubUrl = new URL(buildUnsubscribeUrl(42, EMAIL_TYPES.preflight_reminder));
  assert.strictEqual(unsubUrl.searchParams.get('type'), EMAIL_TYPES.preflight_reminder);

  const verified = verifyUnsubscribeToken(unsubUrl.searchParams.get('token'));
  assert.deepStrictEqual(verified, { userId: 42, type: EMAIL_TYPES.preflight_reminder });
  assert.notStrictEqual(verified.type, 'all', 'type-specific unsubscribe token must not authorize unsubscribe-all');

  const userOnlyToken = jwt.sign({ uid: 42, aud: 'email-unsub' }, process.env.JWT_SECRET);
  assert.strictEqual(
    verifyUnsubscribeToken(userOnlyToken),
    null,
    'legacy user-only tokens must be rejected because the query string is mutable'
  );

  const legacyTypeBoundToken = jwt.sign({ uid: 42, type: EMAIL_TYPES.booking_confirmation }, process.env.JWT_SECRET);
  assert.deepStrictEqual(
    verifyUnsubscribeToken(legacyTypeBoundToken),
    { userId: 42, type: EMAIL_TYPES.booking_confirmation },
    'old tokens that already bind a type remain safe'
  );

  const catalogTypes = getPreferenceCatalog('student', false).flatMap((category) => category.types.map((t) => t.key));
  assert.ok(!catalogTypes.includes(EMAIL_TYPES.password_reset), 'password reset must not be user-configurable');

  const html = '<html><body>Reset your password</body></html>';
  const text = 'Reset your password';
  const requiredWithFooter = appendUnsubscribeFooter(html, text, 42, EMAIL_TYPES.password_reset);
  assert.deepStrictEqual(requiredWithFooter, { html, text }, 'password reset emails must not include unsubscribe links');

  assert.strictEqual(
    await shouldSendEmail(42, EMAIL_TYPES.password_reset),
    true,
    'password reset must bypass opt-out preferences and email_all_off'
  );

  const prefs = rowToPrefs({ email_all_off: true, password_reset: false });
  assert.strictEqual(prefs.email_all_off, true);
  assert.strictEqual(prefs.password_reset, true, 'persisted false values must not disable password reset');
}

run()
  .then(() => {
    console.log('critical bug regressions passed');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
