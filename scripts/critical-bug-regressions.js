'use strict';

const assert = require('assert');
const jwt = require('jsonwebtoken');

const { EMAIL_TYPES, REQUIRED_EMAIL_TYPES } = require('../lib/email-types');
const {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
  buildUnsubscribeUrl,
} = require('../lib/unsubscribe-token');
const {
  appendUnsubscribeFooter,
  getPreferenceCatalog,
  shouldSendEmail,
} = require('../lib/notification-prefs');
const { rowToPrefs } = require('../db/notification-prefs');

const JWT_SECRET = process.env.JWT_SECRET || 'REDACTED';

async function run() {
  const bookingToken = signUnsubscribeToken(42, EMAIL_TYPES.booking_confirmation);
  assert.deepStrictEqual(
    verifyUnsubscribeToken(bookingToken),
    { userId: 42, type: EMAIL_TYPES.booking_confirmation },
    'unsubscribe token must bind the requested email type'
  );

  const url = new URL(buildUnsubscribeUrl(42, EMAIL_TYPES.preflight_reminder));
  url.searchParams.set('type', 'all');
  assert.strictEqual(
    verifyUnsubscribeToken(url.searchParams.get('token')).type,
    EMAIL_TYPES.preflight_reminder,
    'query-string type tampering must not broaden unsubscribe scope'
  );

  const unscopedRegressionToken = jwt.sign({ uid: 42, aud: 'email-unsub' }, JWT_SECRET);
  assert.strictEqual(
    verifyUnsubscribeToken(unscopedRegressionToken),
    null,
    'unscoped user-only unsubscribe tokens must be rejected'
  );

  const legacyScopedToken = jwt.sign({ uid: 42, type: EMAIL_TYPES.booking_cancelled }, JWT_SECRET);
  assert.deepStrictEqual(
    verifyUnsubscribeToken(legacyScopedToken),
    { userId: 42, type: EMAIL_TYPES.booking_cancelled },
    'older scoped tokens remain safe to honor'
  );

  const categories = getPreferenceCatalog('student', false);
  const exposedTypes = new Set(categories.flatMap((category) => category.types.map((type) => type.key)));
  for (const requiredType of REQUIRED_EMAIL_TYPES) {
    assert.strictEqual(exposedTypes.has(requiredType), false, `${requiredType} must not be user-toggleable`);
  }

  const prefs = rowToPrefs({ email_all_off: true, password_reset: false, profile_change: false });
  assert.strictEqual(prefs.password_reset, true, 'password reset preference reads must normalize to enabled');
  assert.strictEqual(prefs.profile_change, true, 'profile/security preference reads must normalize to enabled');

  assert.strictEqual(
    await shouldSendEmail(42, EMAIL_TYPES.password_reset),
    true,
    'required emails must bypass opt-out checks'
  );

  const textOnly = appendUnsubscribeFooter(null, 'Plain text alert', 42, EMAIL_TYPES.endorsement_expiry);
  assert.strictEqual(textOnly.html, null, 'text-only optional email should remain text-only');
  assert.match(textOnly.text, /Unsubscribe from Endorsement expiry alerts:/);

  const requiredEmail = appendUnsubscribeFooter('<p>Reset</p>', 'Reset', 42, EMAIL_TYPES.password_reset);
  assert.strictEqual(requiredEmail.html, '<p>Reset</p>', 'required emails must not include unsubscribe footer');
  assert.strictEqual(requiredEmail.text, 'Reset', 'required text emails must not include unsubscribe footer');
}

run()
  .then(() => {
    console.log('critical bug regressions passed');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
