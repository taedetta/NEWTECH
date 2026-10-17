'use strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'critical-regression-secret';
process.env.APP_URL = process.env.APP_URL || 'https://example.test';

const assert = require('assert/strict');

async function invokeRoute(router, method, path, { query = {}, body = {} } = {}) {
  const layer = router.stack.find((item) => item.route?.path === path && item.route.methods[method]);
  assert.ok(layer, `Expected ${method.toUpperCase()} ${path} route`);
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;
  const req = { query, body };
  const res = {
    statusCode: 200,
    body: '',
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(content) {
      this.body = content;
      return this;
    },
  };
  await handler(req, res);
  return res;
}

async function testEmailUnsubscribeSafety() {
  const dbPath = require.resolve('../db/notification-prefs');
  const updateCalls = [];
  const ensureCalls = [];
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      updatePrefs: async (userId, patch) => {
        updateCalls.push({ userId, patch });
        return {};
      },
      ensureDefaultPrefs: async (userId) => {
        ensureCalls.push(userId);
      },
    },
  };

  const tokenPath = require.resolve('../lib/unsubscribe-token');
  delete require.cache[tokenPath];
  const { buildUnsubscribeUrl, signUnsubscribeToken, verifyUnsubscribeToken } = require('../lib/unsubscribe-token');
  const url = new URL(buildUnsubscribeUrl(123, 'booking_confirmation'));
  const token = url.searchParams.get('token');
  assert.equal(url.searchParams.get('type'), 'booking_confirmation');
  assert.deepEqual(verifyUnsubscribeToken(token), { userId: 123, type: 'booking_confirmation' });
  const legacyUnboundToken = require('jsonwebtoken').sign({ uid: 123, aud: 'email-unsub' }, process.env.JWT_SECRET);
  assert.equal(verifyUnsubscribeToken(legacyUnboundToken), null, 'Tokens must bind the unsubscribe type');

  const routePath = require.resolve('../routes/email-unsubscribe');
  delete require.cache[routePath];
  const router = require('../routes/email-unsubscribe');

  let res = await invokeRoute(router, 'get', '/unsubscribe', {
    query: { token, type: 'booking_confirmation' },
  });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Confirm unsubscribe/);
  assert.equal(updateCalls.length, 0, 'GET unsubscribe must not mutate preferences');
  assert.equal(ensureCalls.length, 0, 'GET unsubscribe must not create preference rows');

  res = await invokeRoute(router, 'post', '/unsubscribe', {
    body: { token, type: 'all' },
  });
  assert.equal(res.statusCode, 400, 'Changing the query/body type must invalidate the token');
  assert.equal(updateCalls.length, 0);

  res = await invokeRoute(router, 'post', '/unsubscribe', {
    body: { token, type: 'booking_confirmation' },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(updateCalls, [{ userId: 123, patch: { booking_confirmation: false } }]);

  const requiredToken = signUnsubscribeToken(123, 'password_reset');
  res = await invokeRoute(router, 'post', '/unsubscribe', {
    body: { token: requiredToken, type: 'password_reset' },
  });
  assert.equal(res.statusCode, 400, 'Required account/security emails cannot be unsubscribed');
  assert.equal(updateCalls.length, 1);
}

async function testRequiredEmailAndTextOnlyFooters() {
  const {
    EMAIL_TYPES,
    REQUIRED_EMAIL_TYPES,
    appendUnsubscribeFooter,
    getPreferenceCatalog,
    shouldSendEmail,
  } = require('../lib/notification-prefs');

  assert.ok(REQUIRED_EMAIL_TYPES.has(EMAIL_TYPES.password_reset));
  assert.equal(await shouldSendEmail(123, EMAIL_TYPES.password_reset), true);

  const requiredFooter = appendUnsubscribeFooter('<body>Reset</body>', 'Reset', 123, EMAIL_TYPES.password_reset);
  assert.equal(requiredFooter.html, '<body>Reset</body>');
  assert.equal(requiredFooter.text, 'Reset');

  const textOnly = appendUnsubscribeFooter(null, 'Endorsement expires soon', 123, EMAIL_TYPES.endorsement_expiry);
  assert.equal(textOnly.html, null);
  assert.match(textOnly.text, /Unsubscribe from Endorsement expiry alerts/);

  const catalogTypes = getPreferenceCatalog('student', false).flatMap((category) => category.types.map((type) => type.key));
  for (const requiredType of REQUIRED_EMAIL_TYPES) {
    assert.ok(!catalogTypes.includes(requiredType), `${requiredType} should not be user-configurable`);
  }
}

(async () => {
  await testEmailUnsubscribeSafety();
  await testRequiredEmailAndTextOnlyFooters();
  console.log('critical bug regressions passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
