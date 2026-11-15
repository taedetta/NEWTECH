'use strict';

const assert = require('assert');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'critical-bug-regression-secret';
process.env.APP_URL = 'https://example.test';

function fresh(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  return require(modulePath);
}

async function testUnsubscribeTokensBindType() {
  const unsub = fresh('../lib/unsubscribe-token');
  const url = new URL(unsub.buildUnsubscribeUrl(42, 'booking_confirmation'));
  const token = url.searchParams.get('token');

  assert.strictEqual(url.searchParams.get('type'), 'booking_confirmation');
  assert.deepStrictEqual(unsub.verifyUnsubscribeToken(token, 'booking_confirmation'), {
    userId: 42,
    type: 'booking_confirmation',
  });
  assert.strictEqual(unsub.verifyUnsubscribeToken(token, 'all'), null);

  const legacyUserOnlyToken = jwt.sign({ uid: 42, aud: 'email-unsub' }, process.env.JWT_SECRET, { expiresIn: '365d' });
  assert.strictEqual(unsub.verifyUnsubscribeToken(legacyUserOnlyToken, 'booking_confirmation'), null);

  const requiredUrl = new URL(unsub.buildUnsubscribeUrl(42, 'password_reset'));
  assert.strictEqual(requiredUrl.searchParams.get('type'), 'all');
}

async function testRequiredEmailsBypassPrefsAndFooters() {
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

  const prefs = fresh('../lib/notification-prefs');
  const catalogKeys = prefs.getPreferenceCatalog('student', false).flatMap((category) => category.types.map((type) => type.key));
  assert(!catalogKeys.includes('password_reset'));
  assert(!catalogKeys.includes('profile_change'));
  assert(!catalogKeys.includes('account_approved'));

  assert.strictEqual(await prefs.shouldSendEmail(7, 'password_reset'), true);
  assert.strictEqual(await prefs.shouldSendEmail(7, 'booking_confirmation'), false);

  const requiredFooter = prefs.appendUnsubscribeFooter('<p>Reset your password</p>', 'Reset your password', 7, 'password_reset');
  assert.strictEqual(requiredFooter.html, '<p>Reset your password</p>');
  assert.strictEqual(requiredFooter.text, 'Reset your password');

  const textOnlyOptional = prefs.appendUnsubscribeFooter(null, 'Booking confirmed', 7, 'booking_confirmation');
  assert.strictEqual(textOnlyOptional.html, null);
  assert(textOnlyOptional.text.includes('Unsubscribe from Booking confirmations'));
}

async function testDirectPreferenceUpdatesIgnoreRequiredTypes() {
  const poolPath = require.resolve('../db/index');
  require.cache[poolPath] = {
    id: poolPath,
    filename: poolPath,
    loaded: true,
    exports: { query: async () => ({ rows: [] }) },
  };

  const notificationPrefs = fresh('../db/notification-prefs');
  const queries = [];
  const fakeDb = {
    query: async (sql, values) => {
      queries.push({ sql, values });
      if (/SELECT \* FROM user_email_preferences/i.test(sql)) {
        return {
          rows: [{
            user_id: 7,
            email_all_off: true,
            booking_confirmation: false,
            password_reset: false,
            profile_change: false,
          }],
        };
      }
      return { rows: [] };
    },
  };

  const result = await notificationPrefs.updatePrefs(7, {
    email_all_off: true,
    booking_confirmation: false,
    password_reset: false,
    profile_change: false,
  }, fakeDb);

  const update = queries.find((entry) => /^UPDATE user_email_preferences/i.test(entry.sql));
  assert(update, 'expected update query');
  assert(update.sql.includes('email_all_off'));
  assert(update.sql.includes('booking_confirmation'));
  assert(!update.sql.includes('password_reset'));
  assert(!update.sql.includes('profile_change'));
  assert.strictEqual(result.password_reset, true);
  assert.strictEqual(result.profile_change, true);
}

function getRouteHandler(router, method) {
  const layer = router.stack.find((entry) => entry.route?.path === '/unsubscribe' && entry.route.methods[method]);
  assert(layer, `missing ${method.toUpperCase()} /unsubscribe route`);
  return layer.route.stack[0].handle;
}

async function invokeRoute(handler, { query = {}, body = {} }) {
  const res = {
    statusCode: 200,
    body: '',
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(payload) {
      this.body = String(payload);
      return this;
    },
  };
  await handler({ query, body }, res);
  return res;
}

async function testUnsubscribeGetOnlyConfirmsPostMutates() {
  const updates = [];
  const dbPrefsPath = require.resolve('../db/notification-prefs');
  require.cache[dbPrefsPath] = {
    id: dbPrefsPath,
    filename: dbPrefsPath,
    loaded: true,
    exports: {
      ensureDefaultPrefs: async () => {},
      updatePrefs: async (userId, patch) => {
        updates.push({ userId, patch });
      },
    },
  };

  const unsub = fresh('../lib/unsubscribe-token');
  const url = new URL(unsub.buildUnsubscribeUrl(55, 'booking_confirmation'));
  const query = {
    token: url.searchParams.get('token'),
    type: url.searchParams.get('type'),
  };

  const routePath = require.resolve('../routes/email-unsubscribe');
  delete require.cache[routePath];
  const router = require('../routes/email-unsubscribe');
  const getHandler = getRouteHandler(router, 'get');
  const postHandler = getRouteHandler(router, 'post');

  const getRes = await invokeRoute(getHandler, { query });
  assert.strictEqual(getRes.statusCode, 200);
  assert(getRes.body.includes('Confirm unsubscribe'));
  assert.deepStrictEqual(updates, []);

  const tamperedRes = await invokeRoute(postHandler, { query: { token: query.token, type: 'all' } });
  assert.strictEqual(tamperedRes.statusCode, 400);
  assert.deepStrictEqual(updates, []);

  const postRes = await invokeRoute(postHandler, { query });
  assert.strictEqual(postRes.statusCode, 200);
  assert.deepStrictEqual(updates, [{ userId: 55, patch: { booking_confirmation: false } }]);
}

(async () => {
  await testUnsubscribeTokensBindType();
  await testRequiredEmailsBypassPrefsAndFooters();
  await testDirectPreferenceUpdatesIgnoreRequiredTypes();
  await testUnsubscribeGetOnlyConfirmsPostMutates();
  console.log('critical bug regression checks passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
