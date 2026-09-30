'use strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'critical-bug-regression-secret';

const assert = require('assert');

const {
  EMAIL_TYPES,
  REQUIRED_EMAIL_TYPES,
  getPreferenceCatalog,
  appendUnsubscribeFooter,
  shouldSendEmail,
} = require('../lib/notification-prefs');
const {
  buildUnsubscribeUrl,
  signUnsubscribeToken,
  verifyUnsubscribeToken,
  resolveUnsubscribeRequest,
} = require('../lib/unsubscribe-token');

async function run() {
  const url = new URL(buildUnsubscribeUrl(123, EMAIL_TYPES.preflight_reminder));
  const token = url.searchParams.get('token');

  assert.strictEqual(url.searchParams.get('type'), EMAIL_TYPES.preflight_reminder);
  assert.deepStrictEqual(verifyUnsubscribeToken(token), {
    userId: 123,
    type: EMAIL_TYPES.preflight_reminder,
  });

  const tampered = resolveUnsubscribeRequest(token, 'all');
  assert.strictEqual(tampered.ok, false, 'signed unsubscribe type must reject query-string tampering');

  const requiredToken = signUnsubscribeToken(123, EMAIL_TYPES.password_reset);
  const required = resolveUnsubscribeRequest(
    requiredToken,
    EMAIL_TYPES.password_reset
  );
  assert.strictEqual(required.ok, false, 'required emails must not be directly unsubscribable');

  assert.strictEqual(
    await shouldSendEmail(123, EMAIL_TYPES.password_reset),
    true,
    'password resets must bypass opt-out preferences'
  );

  const requiredFooter = appendUnsubscribeFooter(
    '<html><body>Password reset</body></html>',
    'Password reset',
    123,
    EMAIL_TYPES.password_reset
  );
  assert.strictEqual(requiredFooter.html, '<html><body>Password reset</body></html>');
  assert.strictEqual(requiredFooter.text, 'Password reset');

  const textOnlyFooter = appendUnsubscribeFooter(null, 'Endorsement expiring', 123, EMAIL_TYPES.endorsement_expiry);
  assert.strictEqual(textOnlyFooter.html, null);
  assert.match(textOnlyFooter.text, /Unsubscribe from Endorsement expiry alerts/);

  const studentCatalogTypes = getPreferenceCatalog('student', false).flatMap((category) =>
    category.types.map((type) => type.key)
  );
  for (const requiredType of REQUIRED_EMAIL_TYPES) {
    assert.strictEqual(
      studentCatalogTypes.includes(requiredType),
      false,
      `${requiredType} should be hidden from editable preference catalog`
    );
  }
}

run()
  .then(() => {
    console.log('critical bug regressions passed');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
