'use strict';

const assert = require('assert');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'critical-bug-regression-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://user:pass@127.0.0.1:5432/flightslate_test';

const dbIndexPath = require.resolve('../db/index');
require.cache[dbIndexPath] = {
  id: dbIndexPath,
  filename: dbIndexPath,
  loaded: true,
  exports: {
    query: async () => {
      throw new Error('Regression test attempted an unexpected database query');
    },
  },
};

const { EMAIL_TYPES, REQUIRED_EMAIL_TYPES } = require('../lib/email-types');
const {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
  buildUnsubscribeUrl,
} = require('../lib/unsubscribe-token');
const { rowToPrefs, USER_MUTABLE_COLUMNS } = require('../db/notification-prefs');
const {
  appendUnsubscribeFooter,
  getPreferenceCatalog,
  shouldSendEmail,
} = require('../lib/notification-prefs');
const unsubscribeRouter = require('../routes/email-unsubscribe');

function invokeUnsubscribeGet(query) {
  const layer = unsubscribeRouter.stack.find((l) => l.route?.path === '/unsubscribe' && l.route.methods.get);
  assert(layer, 'GET /unsubscribe route is registered');
  const handler = layer.route.stack[0].handle;
  const res = {
    statusCode: 200,
    body: '',
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(body) {
      this.body = String(body);
      return this;
    },
  };
  handler({ query }, res);
  return res;
}

async function main() {
  const optionalType = EMAIL_TYPES.booking_confirmation;
  const optionalToken = signUnsubscribeToken(123, optionalType);
  assert.deepStrictEqual(
    verifyUnsubscribeToken(optionalToken, optionalType),
    { userId: 123, type: optionalType },
    'unsubscribe tokens verify for the signed type'
  );
  assert.strictEqual(
    verifyUnsubscribeToken(optionalToken, 'all'),
    null,
    'editing the type query string cannot widen a token to unsubscribe all'
  );

  const legacyToken = jwt.sign({ uid: 123, aud: 'email-unsub' }, process.env.JWT_SECRET);
  assert.strictEqual(
    verifyUnsubscribeToken(legacyToken, optionalType),
    null,
    'legacy user-only unsubscribe tokens are rejected'
  );

  const url = new URL(buildUnsubscribeUrl(123, optionalType));
  const getRes = invokeUnsubscribeGet({
    token: url.searchParams.get('token'),
    type: url.searchParams.get('type'),
  });
  assert.strictEqual(getRes.statusCode, 200, 'GET unsubscribe confirmation succeeds');
  assert.match(getRes.body, /Confirm unsubscribe/, 'GET renders a confirmation page');
  assert.doesNotMatch(getRes.body, /You have been unsubscribed/, 'GET does not mutate preferences');

  const required = new Set(REQUIRED_EMAIL_TYPES);
  for (const key of REQUIRED_EMAIL_TYPES) {
    assert.strictEqual(USER_MUTABLE_COLUMNS.includes(key), false, `${key} cannot be directly updated`);
    assert.strictEqual(rowToPrefs({ [key]: false })[key], true, `${key} is always exposed as enabled`);
  }
  assert.strictEqual(
    rowToPrefs({ email_all_off: true, password_reset: false }).password_reset,
    true,
    'stored false values cannot suppress password resets'
  );

  const catalogTypes = getPreferenceCatalog('owner', true).flatMap((cat) => cat.types.map((t) => t.key));
  for (const key of REQUIRED_EMAIL_TYPES) {
    assert.strictEqual(catalogTypes.includes(key), false, `${key} is hidden from preference catalog`);
  }

  assert.strictEqual(
    await shouldSendEmail(123, EMAIL_TYPES.password_reset),
    true,
    'required email delivery bypasses email_all_off and per-type opt-outs'
  );

  const textOnly = appendUnsubscribeFooter(null, 'Body', 123, EMAIL_TYPES.endorsement_expiry);
  assert.strictEqual(textOnly.html, null, 'text-only optional email keeps null html');
  assert.match(textOnly.text, /Unsubscribe from Endorsement expiry alerts/, 'text-only optional email gets text footer');

  const requiredFooter = appendUnsubscribeFooter('<p>Reset</p>', 'Reset', 123, EMAIL_TYPES.password_reset);
  assert.deepStrictEqual(
    requiredFooter,
    { html: '<p>Reset</p>', text: 'Reset' },
    'required emails do not include unsubscribe footers'
  );

  assert(required.has(EMAIL_TYPES.profile_change), 'profile_change remains a required account/security email');
}

main()
  .then(() => console.log('critical bug regressions passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
