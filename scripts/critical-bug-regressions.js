'use strict';

const assert = require('assert');
const http = require('http');
const express = require('express');

process.env.JWT_SECRET = 'critical-bug-regression-secret';
process.env.APP_URL = 'https://example.test';

function clearModule(path) {
  delete require.cache[require.resolve(path)];
}

function installNotificationPrefsMock(exports) {
  const id = require.resolve('../db/notification-prefs');
  require.cache[id] = {
    id,
    filename: id,
    loaded: true,
    exports,
  };
}

function installDbPoolMock(exports) {
  const id = require.resolve('../db/index');
  require.cache[id] = {
    id,
    filename: id,
    loaded: true,
    exports,
  };
}

function request(app, method, path) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const { port } = server.address();
      const req = http.request({ port, method, path }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          server.close(() => resolve({ status: res.statusCode, body }));
        });
      });
      req.on('error', (err) => server.close(() => reject(err)));
      req.end();
    });
  });
}

async function testUnsubscribeRequiresPostAndBoundType() {
  const calls = [];
  installNotificationPrefsMock({
    ensureDefaultPrefs: async (userId) => calls.push({ op: 'ensure', userId }),
    updatePrefs: async (userId, patch) => calls.push({ op: 'update', userId, patch }),
  });
  clearModule('../lib/unsubscribe-token');
  clearModule('../routes/email-unsubscribe');

  const router = require('../routes/email-unsubscribe');
  const { buildUnsubscribeUrl, verifyUnsubscribeToken } = require('../lib/unsubscribe-token');
  const app = express();
  app.use('/api/email', router);

  const url = new URL(buildUnsubscribeUrl(42, 'booking_confirmation'));
  const token = url.searchParams.get('token');
  assert.deepStrictEqual(verifyUnsubscribeToken(token), { userId: 42, type: 'booking_confirmation' });

  const unsubscribePath = `${url.pathname}${url.search}`;
  let res = await request(app, 'GET', unsubscribePath);
  assert.strictEqual(res.status, 200);
  assert.match(res.body, /Confirm unsubscribe/);
  assert.deepStrictEqual(calls, [], 'GET must not mutate email preferences');

  res = await request(app, 'POST', unsubscribePath);
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(calls, [
    { op: 'ensure', userId: 42 },
    { op: 'update', userId: 42, patch: { booking_confirmation: false } },
  ]);

  calls.length = 0;
  const tampered = new URL(url.toString());
  tampered.searchParams.set('type', 'all');
  res = await request(app, 'POST', `${tampered.pathname}${tampered.search}`);
  assert.strictEqual(res.status, 400);
  assert.deepStrictEqual(calls, [], 'edited query type must not override signed token type');
}

async function testRequiredEmailsBypassPreferencesAndHaveNoFooter() {
  installNotificationPrefsMock({
    getPrefs: async () => ({
      email_all_off: true,
      booking_confirmation: false,
      password_reset: false,
    }),
  });
  clearModule('../lib/unsubscribe-token');
  clearModule('../lib/notification-prefs');

  const {
    EMAIL_TYPES,
    appendUnsubscribeFooter,
    getPreferenceCatalog,
    shouldSendEmail,
  } = require('../lib/notification-prefs');

  assert.strictEqual(await shouldSendEmail(7, EMAIL_TYPES.password_reset), true);
  assert.strictEqual(await shouldSendEmail(7, EMAIL_TYPES.booking_confirmation), false);

  const catalogTypes = getPreferenceCatalog('student', false).flatMap((category) => category.types.map((type) => type.key));
  assert.ok(!catalogTypes.includes('password_reset'));
  assert.ok(!catalogTypes.includes('profile_change'));
  assert.ok(catalogTypes.includes('booking_confirmation'));

  const required = appendUnsubscribeFooter('<body>Password reset</body>', 'Password reset', 7, EMAIL_TYPES.password_reset);
  assert.deepStrictEqual(required, { html: '<body>Password reset</body>', text: 'Password reset' });

  const textOnly = appendUnsubscribeFooter(null, 'Endorsement expires soon', 7, EMAIL_TYPES.endorsement_expiry);
  assert.strictEqual(textOnly.html, null);
  assert.match(textOnly.text, /Unsubscribe from Endorsement expiry alerts:/);
}

async function testDbUpdateIgnoresRequiredPreferenceColumns() {
  clearModule('../db/notification-prefs');
  const queries = [];
  const fakeDb = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (/^\s*SELECT\b/i.test(sql)) {
        return { rows: [{ email_all_off: false, booking_confirmation: false, password_reset: true }] };
      }
      return { rows: [] };
    },
  };
  installDbPoolMock(fakeDb);
  const { updatePrefs } = require('../db/notification-prefs');

  await updatePrefs(9, { password_reset: false, booking_confirmation: false }, fakeDb);
  const update = queries.find((q) => /^\s*UPDATE user_email_preferences\b/i.test(q.sql));
  assert.ok(update, 'expected update query');
  assert.match(update.sql, /booking_confirmation =/);
  assert.doesNotMatch(update.sql, /password_reset =/);
}

(async () => {
  await testUnsubscribeRequiresPostAndBoundType();
  await testRequiredEmailsBypassPreferencesAndHaveNoFooter();
  await testDbUpdateIgnoresRequiredPreferenceColumns();
  console.log('critical bug regression checks passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
