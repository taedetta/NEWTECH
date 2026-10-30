'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const {
  EMAIL_TYPES,
  REQUIRED_EMAIL_TYPES,
} = require('../lib/email-types');
const {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
  normalizeUnsubscribeType,
} = require('../lib/unsubscribe-token');

const dbPrefsPath = require.resolve('../db/notification-prefs');
require.cache[dbPrefsPath] = {
  id: dbPrefsPath,
  filename: dbPrefsPath,
  loaded: true,
  exports: {
    getPrefs: async () => ({
      email_all_off: true,
      booking_confirmation: false,
      password_reset: false,
    }),
  },
};

const {
  getPreferenceCatalog,
  appendUnsubscribeFooter,
  shouldSendEmail,
} = require('../lib/notification-prefs');

async function testUnsubscribeTokensBindType() {
  const bookingToken = signUnsubscribeToken(42, EMAIL_TYPES.booking_confirmation);
  assert.deepStrictEqual(verifyUnsubscribeToken(bookingToken, EMAIL_TYPES.booking_confirmation), {
    userId: 42,
    type: EMAIL_TYPES.booking_confirmation,
  });
  assert.strictEqual(verifyUnsubscribeToken(bookingToken, EMAIL_TYPES.preflight_reminder), null);
  assert.strictEqual(verifyUnsubscribeToken(bookingToken, 'all'), null);

  const legacyUserOnlyToken = jwt.sign({ uid: 42, aud: 'email-unsub' }, process.env.JWT_SECRET);
  assert.strictEqual(verifyUnsubscribeToken(legacyUserOnlyToken, EMAIL_TYPES.booking_confirmation), null);

  assert.strictEqual(normalizeUnsubscribeType(EMAIL_TYPES.password_reset), null);
  assert.strictEqual(normalizeUnsubscribeType('not-a-type'), null);
}

function testRequiredEmailTypesAreNotUserConfigurable() {
  for (const required of [
    EMAIL_TYPES.password_reset,
    EMAIL_TYPES.account_approved,
    EMAIL_TYPES.account_rejected,
    EMAIL_TYPES.signup_pending,
    EMAIL_TYPES.account_invite,
    EMAIL_TYPES.profile_change,
    EMAIL_TYPES.welcome,
  ]) {
    assert(REQUIRED_EMAIL_TYPES.has(required), `${required} must be required`);
  }

  const catalog = getPreferenceCatalog('student', false);
  const visibleTypes = new Set(catalog.flatMap((category) => category.types.map((type) => type.key)));
  for (const required of REQUIRED_EMAIL_TYPES) {
    assert(!visibleTypes.has(required), `${required} must not appear in preference catalog`);
  }

}

function testUnsubscribeFooterRules() {
  const required = appendUnsubscribeFooter(
    '<html><body>Password reset</body></html>',
    'Password reset',
    7,
    EMAIL_TYPES.password_reset
  );
  assert(!required.html.includes('Unsubscribe'), 'required emails must not get unsubscribe links');
  assert(!required.text.includes('Unsubscribe'), 'required email text must not get unsubscribe links');

  const textOnly = appendUnsubscribeFooter(null, 'Your endorsement expires soon', 7, EMAIL_TYPES.endorsement_expiry);
  assert.strictEqual(textOnly.html, null);
  assert(textOnly.text.includes('Unsubscribe from Endorsement expiry alerts'));
}

async function testRequiredEmailsBypassPrefs() {
  assert.strictEqual(await shouldSendEmail(7, EMAIL_TYPES.password_reset), true);
}

function testRequiredPrefsIgnoredOnDirectUpdate() {
  const dbSource = fs.readFileSync(path.join(__dirname, '..', 'db', 'notification-prefs.js'), 'utf8');
  assert(dbSource.includes("const { REQUIRED_EMAIL_TYPES } = require('../lib/email-types');"));
  assert(dbSource.includes('if (REQUIRED_EMAIL_TYPES.has(col)) continue;'));
  assert(dbSource.includes('out[type] = true;'));
}

function testGetUnsubscribeIsConfirmationOnly() {
  const routeSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'email-unsubscribe.js'), 'utf8');
  const getStart = routeSource.indexOf("router.get('/unsubscribe'");
  const postStart = routeSource.indexOf("router.post('/unsubscribe'");
  assert(getStart !== -1 && postStart !== -1 && postStart > getStart);
  const getHandler = routeSource.slice(getStart, postStart);
  assert(!getHandler.includes('updatePrefs('), 'GET /unsubscribe must not mutate preferences');
  assert(getHandler.includes('Confirm unsubscribe'), 'GET /unsubscribe should render a confirmation page');
}

async function main() {
  await testUnsubscribeTokensBindType();
  testRequiredEmailTypesAreNotUserConfigurable();
  testUnsubscribeFooterRules();
  await testRequiredEmailsBypassPrefs();
  await testRequiredPrefsIgnoredOnDirectUpdate();
  testGetUnsubscribeIsConfirmationOnly();
  console.log('critical bug regressions passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
