'use strict';

const assert = require('assert');
const http = require('http');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'critical-bug-regression-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://user:pass@127.0.0.1:5432/flightslate_test';

function modulePath(rel) {
  return require.resolve(`../${rel}`);
}

function clearModule(rel) {
  delete require.cache[modulePath(rel)];
}

function stubModule(rel, exports) {
  const id = modulePath(rel);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

function request(server, method, path) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, method, path }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function withServer(app) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return server;
}

async function testUnsubscribeRoute() {
  const updates = [];
  const ensured = [];
  stubModule('db/notification-prefs.js', {
    updatePrefs: async (userId, patch) => {
      updates.push({ userId, patch });
      return {};
    },
    ensureDefaultPrefs: async (userId) => {
      ensured.push(userId);
    },
  });
  clearModule('lib/unsubscribe-token.js');
  clearModule('routes/email-unsubscribe.js');

  const express = require('express');
  const { buildUnsubscribeUrl, signUnsubscribeToken, verifyUnsubscribeToken } = require('../lib/unsubscribe-token');
  const { EMAIL_TYPES } = require('../lib/email-types');
  const router = require('../routes/email-unsubscribe');

  const typedToken = signUnsubscribeToken(42, EMAIL_TYPES.booking_confirmation);
  assert.deepStrictEqual(verifyUnsubscribeToken(typedToken), {
    userId: 42,
    type: EMAIL_TYPES.booking_confirmation,
  });

  const legacyUserOnlyToken = jwt.sign({ uid: 42, aud: 'email-unsub' }, process.env.JWT_SECRET);
  assert.strictEqual(verifyUnsubscribeToken(legacyUserOnlyToken), null, 'legacy user-only unsubscribe tokens must be rejected');

  const app = express();
  app.use('/api/email', router);
  const server = await withServer(app);
  try {
    const unsubscribeUrl = new URL(buildUnsubscribeUrl(42, EMAIL_TYPES.booking_confirmation));

    const confirm = await request(server, 'GET', `${unsubscribeUrl.pathname}${unsubscribeUrl.search}`);
    assert.strictEqual(confirm.status, 200);
    assert.match(confirm.body, /Confirm unsubscribe/);
    assert.deepStrictEqual(updates, [], 'GET confirmation must not mutate preferences');
    assert.deepStrictEqual(ensured, [], 'GET confirmation must not create preference rows');

    const tampered = await request(
      server,
      'POST',
      `/api/email/unsubscribe?token=${encodeURIComponent(typedToken)}&type=all`
    );
    assert.strictEqual(tampered.status, 400);
    assert.deepStrictEqual(updates, [], 'query-string type tampering must not mutate preferences');

    const posted = await request(server, 'POST', `${unsubscribeUrl.pathname}${unsubscribeUrl.search}`);
    assert.strictEqual(posted.status, 200);
    assert.deepStrictEqual(updates.pop(), {
      userId: 42,
      patch: { [EMAIL_TYPES.booking_confirmation]: false },
    });
    assert.deepStrictEqual(ensured.pop(), 42);

    const allUrl = new URL(buildUnsubscribeUrl(42, 'all'));
    const postedAll = await request(server, 'POST', `${allUrl.pathname}${allUrl.search}`);
    assert.strictEqual(postedAll.status, 200);
    assert.deepStrictEqual(updates.pop(), {
      userId: 42,
      patch: { email_all_off: true },
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function testNotificationPrefs() {
  const { EMAIL_TYPES } = require('../lib/email-types');
  stubModule('db/notification-prefs.js', {
    getPrefs: async () => ({
      email_all_off: true,
      booking_confirmation: false,
      password_reset: false,
      profile_change: false,
      welcome: false,
    }),
  });
  clearModule('lib/notification-prefs.js');
  const {
    appendUnsubscribeFooter,
    getPreferenceCatalog,
    shouldSendEmail,
  } = require('../lib/notification-prefs');

  assert.strictEqual(await shouldSendEmail(7, EMAIL_TYPES.password_reset), true, 'password reset must bypass opt-outs');
  assert.strictEqual(await shouldSendEmail(7, EMAIL_TYPES.profile_change), true, 'profile-change security email must bypass opt-outs');
  assert.strictEqual(await shouldSendEmail(7, EMAIL_TYPES.booking_confirmation), false, 'optional email should honor opt-outs');

  const visibleTypes = getPreferenceCatalog('student', false).flatMap((category) => category.types.map((type) => type.key));
  assert(!visibleTypes.includes(EMAIL_TYPES.password_reset), 'required emails must stay out of the preference catalog');
  assert(!visibleTypes.includes(EMAIL_TYPES.profile_change), 'profile-change emails must stay out of the preference catalog');
  assert(!visibleTypes.includes(EMAIL_TYPES.welcome), 'welcome emails must stay out of the preference catalog');

  const requiredFooter = appendUnsubscribeFooter('<html></html>', 'body', 7, EMAIL_TYPES.password_reset);
  assert.strictEqual(requiredFooter.html, '<html></html>');
  assert.strictEqual(requiredFooter.text, 'body');

  const textOnlyFooter = appendUnsubscribeFooter(null, 'body', 7, EMAIL_TYPES.endorsement_expiry);
  assert.strictEqual(textOnlyFooter.html, null);
  assert.match(textOnlyFooter.text, /Unsubscribe from Endorsement expiry alerts/);
}

async function testDbPreferenceUpdatesIgnoreRequiredTypes() {
  clearModule('db/notification-prefs.js');
  stubModule('db/index.js', { query: async () => ({ rows: [] }) });
  const { updatePrefs, rowToPrefs } = require('../db/notification-prefs');
  const queries = [];
  const fakeDb = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (/SELECT \* FROM user_email_preferences/.test(sql)) {
        return { rows: [{ email_all_off: true, booking_confirmation: false, password_reset: false, profile_change: false }] };
      }
      return { rows: [] };
    },
  };

  await updatePrefs(7, {
    email_all_off: true,
    booking_confirmation: false,
    password_reset: false,
    profile_change: false,
  }, fakeDb);

  const update = queries.find((q) => /^\s*UPDATE user_email_preferences/.test(q.sql));
  assert(update, 'expected updatePrefs to issue an UPDATE');
  assert.match(update.sql, /email_all_off/);
  assert.match(update.sql, /booking_confirmation/);
  assert(!/password_reset/.test(update.sql), 'required password-reset preference must not be mutable');
  assert(!/profile_change/.test(update.sql), 'required profile-change preference must not be mutable');

  const prefs = rowToPrefs({ booking_confirmation: false, password_reset: false, profile_change: false, welcome: false });
  assert.strictEqual(prefs.booking_confirmation, false);
  assert.strictEqual(prefs.password_reset, true);
  assert.strictEqual(prefs.profile_change, true);
  assert.strictEqual(prefs.welcome, true);
}

(async () => {
  await testUnsubscribeRoute();
  await testNotificationPrefs();
  await testDbPreferenceUpdatesIgnoreRequiredTypes();
  console.log('critical bug regression checks passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
