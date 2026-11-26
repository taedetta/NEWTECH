'use strict';

const assert = require('assert');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'critical-regression-secret';

function fresh(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  return require(modulePath);
}

function mockModule(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports,
  };
}

function makeRes() {
  return {
    statusCode: 200,
    body: '',
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
  };
}

async function callRoute(router, method, path, req) {
  const layer = router.stack.find((entry) => (
    entry.route
    && entry.route.path === path
    && entry.route.methods[method]
  ));
  assert(layer, `Missing ${method.toUpperCase()} ${path} route`);
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;
  const res = makeRes();
  await handler({ query: {}, body: {}, ...req }, res);
  return res;
}

async function testUnsubscribeTokensAndRoute() {
  const tokenLib = fresh('../lib/unsubscribe-token');
  const token = tokenLib.signUnsubscribeToken(42, 'booking_confirmation');
  assert.deepStrictEqual(tokenLib.verifyUnsubscribeToken(token), {
    userId: 42,
    type: 'booking_confirmation',
  });

  const legacyUserOnly = jwt.sign({ uid: 42, aud: 'email-unsub' }, process.env.JWT_SECRET);
  assert.strictEqual(tokenLib.verifyUnsubscribeToken(legacyUserOnly), null);
  assert.throws(() => tokenLib.signUnsubscribeToken(42, 'password_reset'), /Cannot build unsubscribe token/);
  assert.throws(() => tokenLib.buildUnsubscribeUrl(42, 'password_reset'), /Cannot build unsubscribe URL/);

  const updateCalls = [];
  const ensureCalls = [];
  mockModule('../db/notification-prefs', {
    ensureDefaultPrefs: async (userId) => { ensureCalls.push(userId); },
    updatePrefs: async (userId, patch) => { updateCalls.push({ userId, patch }); return patch; },
  });
  delete require.cache[require.resolve('../routes/email-unsubscribe')];
  const router = require('../routes/email-unsubscribe');

  const getRes = await callRoute(router, 'get', '/unsubscribe', {
    query: { token, type: 'booking_confirmation' },
  });
  assert.strictEqual(getRes.statusCode, 200);
  assert.match(getRes.body, /Confirm unsubscribe/);
  assert.match(getRes.body, /method="POST"/);
  assert.deepStrictEqual(updateCalls, [], 'GET unsubscribe must not mutate preferences');

  const tamperedRes = await callRoute(router, 'post', '/unsubscribe', {
    body: { token, type: 'password_reset' },
  });
  assert.strictEqual(tamperedRes.statusCode, 400);
  assert.deepStrictEqual(updateCalls, [], 'tampered type must not mutate preferences');

  const postRes = await callRoute(router, 'post', '/unsubscribe', {
    body: { token, type: 'booking_confirmation' },
  });
  assert.strictEqual(postRes.statusCode, 200);
  assert.deepStrictEqual(ensureCalls, [42]);
  assert.deepStrictEqual(updateCalls, [{ userId: 42, patch: { booking_confirmation: false } }]);
}

async function testRequiredEmailBypassAndFooters() {
  mockModule('../db/notification-prefs', {
    getPrefs: async () => ({
      email_all_off: true,
      booking_confirmation: false,
      password_reset: false,
    }),
  });
  delete require.cache[require.resolve('../lib/notification-prefs')];
  const prefs = require('../lib/notification-prefs');

  assert.strictEqual(await prefs.shouldSendEmail(7, prefs.EMAIL_TYPES.password_reset), true);
  assert.strictEqual(await prefs.shouldSendEmail(7, prefs.EMAIL_TYPES.booking_confirmation), false);

  const requiredFooter = prefs.appendUnsubscribeFooter(
    '<html><body>Reset</body></html>',
    'Reset',
    7,
    prefs.EMAIL_TYPES.password_reset
  );
  assert.strictEqual(requiredFooter.html, '<html><body>Reset</body></html>');
  assert.strictEqual(requiredFooter.text, 'Reset');

  const textOnly = prefs.appendUnsubscribeFooter(
    null,
    'Your endorsement expires soon.',
    7,
    prefs.EMAIL_TYPES.endorsement_expiry
  );
  assert.strictEqual(textOnly.html, null);
  assert.match(textOnly.text, /Unsubscribe from Endorsement expiry alerts/);

  const catalog = prefs.getPreferenceCatalog('student', false);
  const visibleTypes = catalog.flatMap((category) => category.types.map((type) => type.key));
  assert(!visibleTypes.includes('password_reset'));
  assert(!visibleTypes.includes('profile_change'));
  assert(visibleTypes.includes('booking_confirmation'));
}

async function testRequiredPrefsCannotBePersistedAsDisabled() {
  const queries = [];
  mockModule('../db/index', {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (/SELECT \*/.test(sql)) {
        return { rows: [{ user_id: 9, email_all_off: true, password_reset: false }] };
      }
      return { rows: [] };
    },
  });
  delete require.cache[require.resolve('../db/notification-prefs')];
  const dbPrefs = require('../db/notification-prefs');
  const prefs = await dbPrefs.updatePrefs(9, { email_all_off: true, password_reset: false });
  const update = queries.find((q) => /^\s*UPDATE user_email_preferences/.test(q.sql));
  assert(update, 'expected an UPDATE for non-required preference changes');
  assert(!/password_reset/.test(update.sql), 'required email columns must not be updated from preferences');
  assert.strictEqual(prefs.password_reset, true, 'required email preferences are reported as enabled');
}

async function main() {
  await testUnsubscribeTokensAndRoute();
  await testRequiredEmailBypassAndFooters();
  await testRequiredPrefsCannotBePersistedAsDisabled();
  console.log('critical bug regressions passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
