'use strict';

const assert = require('assert');
const jwt = require('jsonwebtoken');

const { EMAIL_TYPES, REQUIRED_EMAIL_TYPES } = require('../lib/email-types');
const {
  appendUnsubscribeFooter,
  getPreferenceCatalog,
  shouldSendEmail,
} = require('../lib/notification-prefs');
const {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
  buildUnsubscribeUrl,
} = require('../lib/unsubscribe-token');
const {
  rowToPrefs,
  sanitizePreferencePatch,
} = require('../lib/notification-prefs-policy');
const {
  normalizeUnsubscribeRequest,
} = require('../lib/unsubscribe-request');

async function run() {
  const token = signUnsubscribeToken(42, EMAIL_TYPES.booking_confirmation);
  assert.deepStrictEqual(verifyUnsubscribeToken(token), {
    userId: 42,
    type: EMAIL_TYPES.booking_confirmation,
  });

  const legacyUserOnlyToken = jwt.sign({ uid: 42, aud: 'email-unsub' }, process.env.JWT_SECRET || 'REDACTED');
  assert.strictEqual(verifyUnsubscribeToken(legacyUserOnlyToken), null, 'legacy user-only unsubscribe tokens must be rejected');

  const legacyTypedToken = jwt.sign({ uid: 42, type: EMAIL_TYPES.booking_confirmation }, process.env.JWT_SECRET || 'REDACTED');
  assert.strictEqual(verifyUnsubscribeToken(legacyTypedToken), null, 'tokens without the email-unsub audience must be rejected');

  const validRequest = normalizeUnsubscribeRequest({ token, type: EMAIL_TYPES.booking_confirmation });
  assert.strictEqual(validRequest.errorStatus, undefined);
  assert.strictEqual(validRequest.userId, 42);
  assert.strictEqual(validRequest.type, EMAIL_TYPES.booking_confirmation);

  const tamperedRequest = normalizeUnsubscribeRequest({ token, type: 'all' });
  assert.strictEqual(tamperedRequest.errorStatus, 400, 'query-string type tampering must not change the signed unsubscribe scope');

  const requiredToken = signUnsubscribeToken(42, EMAIL_TYPES.password_reset);
  const requiredRequest = normalizeUnsubscribeRequest({ token: requiredToken, type: EMAIL_TYPES.password_reset });
  assert.strictEqual(requiredRequest.errorStatus, 400, 'required account/security email types cannot be unsubscribed');

  const url = buildUnsubscribeUrl(42, EMAIL_TYPES.preflight_reminder);
  const parsed = new URL(url);
  assert.strictEqual(parsed.searchParams.get('type'), EMAIL_TYPES.preflight_reminder);
  assert.strictEqual(verifyUnsubscribeToken(parsed.searchParams.get('token')).type, EMAIL_TYPES.preflight_reminder);

  assert(REQUIRED_EMAIL_TYPES.has(EMAIL_TYPES.password_reset));
  assert(REQUIRED_EMAIL_TYPES.has(EMAIL_TYPES.profile_change));

  const catalogTypes = getPreferenceCatalog('student', false).flatMap((cat) => cat.types.map((type) => type.key));
  for (const requiredType of REQUIRED_EMAIL_TYPES) {
    assert(!catalogTypes.includes(requiredType), `${requiredType} should not be shown as an opt-out preference`);
  }

  const sanitized = sanitizePreferencePatch({
    email_all_off: true,
    booking_confirmation: false,
    password_reset: false,
    profile_change: false,
  });
  assert.deepStrictEqual(sanitized, {
    email_all_off: true,
    booking_confirmation: false,
  });

  const prefs = rowToPrefs({
    email_all_off: true,
    booking_confirmation: false,
    password_reset: false,
    profile_change: false,
  });
  assert.strictEqual(prefs.email_all_off, true);
  assert.strictEqual(prefs.booking_confirmation, false);
  assert.strictEqual(prefs.password_reset, true);
  assert.strictEqual(prefs.profile_change, true);

  assert.strictEqual(await shouldSendEmail(42, EMAIL_TYPES.password_reset), true, 'required email sends must bypass opt-out lookups');

  const requiredFooter = appendUnsubscribeFooter('<p>Reset</p>', 'Reset', 42, EMAIL_TYPES.password_reset);
  assert.deepStrictEqual(requiredFooter, { html: '<p>Reset</p>', text: 'Reset' });

  const textOnly = appendUnsubscribeFooter(null, 'Endorsement expires soon', 42, EMAIL_TYPES.endorsement_expiry);
  assert.strictEqual(textOnly.html, null);
  assert(textOnly.text.includes('Unsubscribe from Endorsement expiry alerts'));
}

run()
  .then(() => {
    console.log('critical bug regression checks passed');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
