'use strict';

const assert = require('assert');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'critical-bug-test-secret';

function installModuleStub(modulePath, exports) {
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports,
  };
}

function clearModule(modulePath) {
  delete require.cache[modulePath];
}

async function invokeRouteHandler(layer, req) {
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;
  let statusCode = 200;
  let body = '';
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    send(value) {
      body = value;
      return this;
    },
  };
  await handler(req, res, (err) => {
    if (err) throw err;
  });
  return { statusCode, body };
}

async function testUnsubscribeTokensBindType() {
  const { EMAIL_TYPES } = require('../lib/email-types');
  const {
    buildUnsubscribeUrl,
    verifyUnsubscribeToken,
  } = require('../lib/unsubscribe-token');

  const url = new URL(buildUnsubscribeUrl(42, EMAIL_TYPES.booking_confirmation));
  const token = url.searchParams.get('token');

  assert.strictEqual(url.searchParams.get('type'), EMAIL_TYPES.booking_confirmation);
  assert.deepStrictEqual(
    verifyUnsubscribeToken(token, EMAIL_TYPES.booking_confirmation),
    { userId: 42, type: EMAIL_TYPES.booking_confirmation }
  );
  assert.strictEqual(verifyUnsubscribeToken(token, EMAIL_TYPES.preflight_reminder), null);
  assert.strictEqual(verifyUnsubscribeToken(token, 'all'), null);

  const legacyToken = jwt.sign({ uid: 42, aud: 'email-unsub' }, process.env.JWT_SECRET);
  assert.strictEqual(verifyUnsubscribeToken(legacyToken, EMAIL_TYPES.booking_confirmation), null);

  const requiredUrl = new URL(buildUnsubscribeUrl(42, EMAIL_TYPES.password_reset));
  assert.strictEqual(requiredUrl.searchParams.get('type'), 'all');
}

async function testNotificationPreferencesProtectRequiredTypes() {
  const { EMAIL_TYPES, TYPE_CATEGORIES } = require('../lib/email-types');
  const dbPrefsPath = require.resolve('../db/notification-prefs');
  const notificationPrefsPath = require.resolve('../lib/notification-prefs');

  clearModule(notificationPrefsPath);
  installModuleStub(dbPrefsPath, {
    getPrefs: async () => ({
      email_all_off: true,
      booking_confirmation: true,
      password_reset: false,
    }),
  });

  const {
    appendUnsubscribeFooter,
    getPreferenceCatalog,
    shouldSendEmail,
  } = require('../lib/notification-prefs');

  assert.strictEqual(await shouldSendEmail(42, EMAIL_TYPES.password_reset), true);
  assert.strictEqual(await shouldSendEmail(42, EMAIL_TYPES.booking_confirmation), false);

  const required = appendUnsubscribeFooter('<body>Reset</body>', 'Reset', 42, EMAIL_TYPES.password_reset);
  assert.deepStrictEqual(required, { html: '<body>Reset</body>', text: 'Reset' });

  const textOnly = appendUnsubscribeFooter(null, 'Expiry notice', 42, EMAIL_TYPES.endorsement_expiry);
  assert.strictEqual(textOnly.html, null);
  assert.match(textOnly.text, /Unsubscribe from Endorsement expiry alerts:/);

  const visibleKeys = getPreferenceCatalog('student', false).flatMap((category) => category.types.map((type) => type.key));
  assert(visibleKeys.includes(EMAIL_TYPES.booking_confirmation));
  for (const key of TYPE_CATEGORIES.find((category) => category.id === 'account').types) {
    assert(!visibleKeys.includes(key), `${key} should not be exposed as an optional preference`);
  }
}

async function testUnsubscribeGetDoesNotMutateAndPostRequiresBoundType() {
  const { EMAIL_TYPES } = require('../lib/email-types');
  const { buildUnsubscribeUrl } = require('../lib/unsubscribe-token');
  const dbPrefsPath = require.resolve('../db/notification-prefs');
  const routePath = require.resolve('../routes/email-unsubscribe');

  const calls = { ensure: [], updates: [] };
  installModuleStub(dbPrefsPath, {
    ensureDefaultPrefs: async (userId) => calls.ensure.push(userId),
    updatePrefs: async (userId, patch) => calls.updates.push({ userId, patch }),
  });
  clearModule(routePath);
  const router = require('../routes/email-unsubscribe');

  const url = new URL(buildUnsubscribeUrl(42, EMAIL_TYPES.booking_confirmation));
  const token = url.searchParams.get('token');
  const type = url.searchParams.get('type');
  const getLayer = router.stack.find((layer) => layer.route?.path === '/unsubscribe' && layer.route.methods.get);
  const postLayer = router.stack.find((layer) => layer.route?.path === '/unsubscribe' && layer.route.methods.post);

  const getResult = await invokeRouteHandler(getLayer, { query: { token, type } });
  assert.strictEqual(getResult.statusCode, 200);
  assert.match(getResult.body, /Confirm unsubscribe/);
  assert.deepStrictEqual(calls.ensure, []);
  assert.deepStrictEqual(calls.updates, []);

  const tampered = await invokeRouteHandler(postLayer, { body: { token, type: 'all' }, query: {} });
  assert.strictEqual(tampered.statusCode, 400);
  assert.deepStrictEqual(calls.ensure, []);
  assert.deepStrictEqual(calls.updates, []);

  const postResult = await invokeRouteHandler(postLayer, { body: { token, type }, query: {} });
  assert.strictEqual(postResult.statusCode, 200);
  assert.deepStrictEqual(calls.ensure, [42]);
  assert.deepStrictEqual(calls.updates, [
    { userId: 42, patch: { [EMAIL_TYPES.booking_confirmation]: false } },
  ]);
}

async function testDirectPreferenceUpdatesCannotDisableRequiredTypes() {
  const dbPrefsPath = require.resolve('../db/notification-prefs');
  const poolPath = require.resolve('../db/index');

  clearModule(dbPrefsPath);
  const queries = [];
  installModuleStub(poolPath, {
    query: async (sql, params = []) => {
      queries.push({ sql, params });
      if (/^\s*SELECT \*/.test(sql)) {
        return { rows: [{ email_all_off: true, booking_confirmation: false, password_reset: true }] };
      }
      return { rows: [] };
    },
  });

  const { EMAIL_TYPES } = require('../lib/email-types');
  const { updatePrefs } = require('../db/notification-prefs');
  await updatePrefs(42, {
    email_all_off: true,
    [EMAIL_TYPES.booking_confirmation]: false,
    [EMAIL_TYPES.password_reset]: false,
  });

  const updateQuery = queries.find((entry) => /^\s*UPDATE user_email_preferences SET/.test(entry.sql));
  assert(updateQuery, 'expected an UPDATE statement');
  assert.match(updateQuery.sql, /email_all_off/);
  assert.match(updateQuery.sql, /booking_confirmation/);
  assert(!/password_reset/.test(updateQuery.sql), 'required email columns must not be mutable');
}

async function main() {
  await testUnsubscribeTokensBindType();
  await testNotificationPreferencesProtectRequiredTypes();
  await testUnsubscribeGetDoesNotMutateAndPostRequiresBoundType();
  await testDirectPreferenceUpdatesCannotDisableRequiredTypes();
  console.log('critical bug regression checks passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
