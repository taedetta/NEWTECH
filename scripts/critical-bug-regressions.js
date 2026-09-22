'use strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'critical-bug-regression-secret';
process.env.APP_URL = process.env.APP_URL || 'https://example.test';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

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

function getRouteHandler(router, method, path) {
  const layer = router.stack.find((entry) => entry.route?.path === path && entry.route.methods[method]);
  assert(layer, `Expected ${method.toUpperCase()} ${path} route`);
  return layer.route.stack[0].handle;
}

async function testUnsubscribeRoute() {
  const calls = { ensureDefaultPrefs: 0, updatePrefs: [] };
  const fakePrefsDb = {
    ensureDefaultPrefs: async () => { calls.ensureDefaultPrefs += 1; },
    updatePrefs: async (_userId, patch) => { calls.updatePrefs.push(patch); return patch; },
  };

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '../db/notification-prefs' && parent?.filename?.endsWith('/routes/email-unsubscribe.js')) {
      return fakePrefsDb;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  let router;
  try {
    delete require.cache[require.resolve('../routes/email-unsubscribe')];
    router = require('../routes/email-unsubscribe');
  } finally {
    Module._load = originalLoad;
  }

  const { buildUnsubscribeUrl, signUnsubscribeToken } = require('../lib/unsubscribe-token');
  const getUnsubscribe = getRouteHandler(router, 'get', '/unsubscribe');
  const postUnsubscribe = getRouteHandler(router, 'post', '/unsubscribe');

  const url = new URL(buildUnsubscribeUrl(42, 'booking_confirmation'));
  const token = url.searchParams.get('token');
  const type = url.searchParams.get('type');

  const getRes = makeRes();
  await getUnsubscribe({ query: { token, type } }, getRes);
  assert.strictEqual(getRes.statusCode, 200);
  assert.match(getRes.body, /Confirm unsubscribe/);
  assert.deepStrictEqual(calls.updatePrefs, [], 'GET must not mutate email preferences');

  const postRes = makeRes();
  await postUnsubscribe({ query: { token, type } }, postRes);
  assert.strictEqual(postRes.statusCode, 200);
  assert.deepStrictEqual(calls.updatePrefs, [{ booking_confirmation: false }]);

  const mismatchRes = makeRes();
  await getUnsubscribe({ query: { token, type: 'preflight_reminder' } }, mismatchRes);
  assert.strictEqual(mismatchRes.statusCode, 400, 'edited type query must not be accepted');
  assert.strictEqual(calls.updatePrefs.length, 1, 'mismatched query must not mutate');

  const requiredToken = signUnsubscribeToken(42, 'password_reset');
  const requiredRes = makeRes();
  await postUnsubscribe({ query: { token: requiredToken, type: 'password_reset' } }, requiredRes);
  assert.strictEqual(requiredRes.statusCode, 400, 'required email types cannot be unsubscribed');
  assert.strictEqual(calls.updatePrefs.length, 1, 'required email unsubscribe must not mutate');
}

async function testNotificationPreferenceInvariants() {
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '../db/notification-prefs' && parent?.filename?.endsWith('/lib/notification-prefs.js')) {
      return {
        getPrefs: async () => ({
          email_all_off: true,
          password_reset: false,
          booking_confirmation: false,
        }),
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  let prefs;
  try {
    delete require.cache[require.resolve('../lib/notification-prefs')];
    prefs = require('../lib/notification-prefs');
  } finally {
    Module._load = originalLoad;
  }

  assert.strictEqual(await prefs.shouldSendEmail(42, 'password_reset'), true, 'required emails bypass all opt-outs');
  assert.strictEqual(await prefs.shouldSendEmail(42, 'booking_confirmation'), false, 'optional emails still honor opt-outs');

  const requiredFooter = prefs.appendUnsubscribeFooter('<body>reset</body>', 'reset', 42, 'password_reset');
  assert.strictEqual(requiredFooter.html, '<body>reset</body>');
  assert.strictEqual(requiredFooter.text, 'reset');

  const textOnly = prefs.appendUnsubscribeFooter(null, 'endorsement body', 42, 'endorsement_expiry');
  assert.strictEqual(textOnly.html, null);
  assert.match(textOnly.text, /Unsubscribe from Endorsement expiry alerts/);

  const catalog = prefs.getPreferenceCatalog('student', false);
  const visibleTypes = catalog.flatMap((category) => category.types.map((type) => type.key));
  assert(!visibleTypes.includes('password_reset'), 'required account/security emails are not optional preferences');
}

function testPreferenceRowNormalization() {
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === './index' && parent?.filename?.endsWith('/db/notification-prefs.js')) {
      return { query: async () => ({ rows: [] }) };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  let rowToPrefs;
  try {
    delete require.cache[require.resolve('../db/notification-prefs')];
    ({ rowToPrefs } = require('../db/notification-prefs'));
  } finally {
    Module._load = originalLoad;
  }

  const prefs = rowToPrefs({
    email_all_off: true,
    password_reset: false,
    profile_change: false,
    booking_confirmation: false,
  });
  assert.strictEqual(prefs.password_reset, true);
  assert.strictEqual(prefs.profile_change, true);
  assert.strictEqual(prefs.booking_confirmation, false);
}

function testCfiProfileRouteOrdering() {
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const endorsementsMount = "app.use('/api/users/me', endorsementsRoutes)";
  const profileMount = "app.use('/api/users/me', profileRoutes)";
  const endorsementsIdx = serverSource.indexOf(endorsementsMount);
  const profileIdx = serverSource.indexOf(profileMount);
  assert(endorsementsIdx !== -1, 'Expected /api/users/me endorsements route mount');
  assert(profileIdx !== -1, 'Expected /api/users/me profile route mount');
  assert(
    endorsementsIdx < profileIdx,
    'CFI profile routes must be mounted before profileRoutes catch-all'
  );
}

(async () => {
  await testUnsubscribeRoute();
  await testNotificationPreferenceInvariants();
  testPreferenceRowNormalization();
  testCfiProfileRouteOrdering();
  console.log('critical bug regressions passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
