'use strict';

const assert = require('assert');
const http = require('http');
const express = require('express');

function clearModule(relPath) {
  const resolved = require.resolve(relPath);
  delete require.cache[resolved];
}

function installDbMock(mockExports) {
  const dbPath = require.resolve('../db/notification-prefs');
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: mockExports,
  };
}

function installPoolMock() {
  const poolPath = require.resolve('../db/index');
  require.cache[poolPath] = {
    id: poolPath,
    filename: poolPath,
    loaded: true,
    exports: { query: async () => ({ rows: [] }) },
  };
}

function request(app, { method = 'GET', path, body, headers = {} }) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const data = body ? Buffer.from(body) : null;
      const req = http.request({
        host: '127.0.0.1',
        port: server.address().port,
        method,
        path,
        headers: {
          ...(data ? { 'Content-Length': data.length } : {}),
          ...headers,
        },
      }, (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { text += chunk; });
        res.on('end', () => {
          server.close(() => resolve({ status: res.statusCode, text }));
        });
      });
      req.on('error', (err) => server.close(() => reject(err)));
      if (data) req.write(data);
      req.end();
    });
  });
}

async function testRequiredEmailPreferences() {
  clearModule('../lib/notification-prefs');
  installDbMock({
    getPrefs: async () => ({
      email_all_off: true,
      booking_confirmation: false,
      password_reset: false,
      profile_change: false,
    }),
  });

  const {
    EMAIL_TYPES,
    appendUnsubscribeFooter,
    getPreferenceCatalog,
    shouldSendEmail,
  } = require('../lib/notification-prefs');
  const { REQUIRED_EMAIL_TYPES } = require('../lib/email-types');

  assert.strictEqual(await shouldSendEmail(7, EMAIL_TYPES.password_reset), true, 'password reset must bypass all opt-outs');
  assert.strictEqual(await shouldSendEmail(7, EMAIL_TYPES.profile_change), true, 'profile change notices must bypass all opt-outs');
  assert.strictEqual(await shouldSendEmail(7, EMAIL_TYPES.booking_confirmation), false, 'optional booking email should honor opt-outs');

  const required = appendUnsubscribeFooter('<html><body>Reset</body></html>', 'Reset', 7, EMAIL_TYPES.password_reset);
  assert(!required.html.includes('/api/email/unsubscribe'), 'required emails must not get unsubscribe links');
  assert(!required.text.includes('Unsubscribe'), 'required email text must not get unsubscribe footer');

  const optionalTextOnly = appendUnsubscribeFooter(null, 'Endorsement notice', 7, EMAIL_TYPES.endorsement_expiry);
  assert.strictEqual(optionalTextOnly.html, null, 'text-only optional email should remain text-only');
  assert(optionalTextOnly.text.includes('/api/email/unsubscribe'), 'optional emails should keep unsubscribe footer');

  const catalogTypes = getPreferenceCatalog('student', false).flatMap((category) => category.types.map((t) => t.key));
  for (const type of REQUIRED_EMAIL_TYPES) {
    assert(!catalogTypes.includes(type), `${type} must be hidden from preference catalog`);
  }
}

async function testDirectPreferenceUpdatesIgnoreRequiredTypes() {
  installPoolMock();
  clearModule('../db/notification-prefs');
  const { updatePrefs } = require('../db/notification-prefs');
  const queries = [];
  const fakeDb = {
    query: async (sql) => {
      queries.push(sql);
      if (/SELECT \* FROM user_email_preferences/i.test(sql)) return { rows: [{}] };
      return { rows: [] };
    },
  };

  await updatePrefs(7, { password_reset: false, profile_change: false }, fakeDb);
  assert(!queries.some((sql) => /^UPDATE user_email_preferences/i.test(sql)), 'required-only patches must not update preferences');

  queries.length = 0;
  await updatePrefs(7, { booking_confirmation: false, password_reset: false }, fakeDb);
  const updateSql = queries.find((sql) => /^UPDATE user_email_preferences/i.test(sql));
  assert(updateSql, 'optional preference patch should update preferences');
  assert(updateSql.includes('booking_confirmation'), 'optional key should be updated');
  assert(!updateSql.includes('password_reset'), 'required key must not be updated');
}

async function testUnsubscribeEndpointRequiresPostAndBoundType() {
  process.env.APP_URL = 'https://example.test';
  clearModule('../lib/unsubscribe-token');
  clearModule('../routes/email-unsubscribe');

  const updates = [];
  installDbMock({
    ensureDefaultPrefs: async (userId) => { updates.push({ kind: 'ensure', userId }); },
    updatePrefs: async (userId, patch) => {
      updates.push({ kind: 'update', userId, patch });
      return patch;
    },
  });

  const { buildUnsubscribeUrl } = require('../lib/unsubscribe-token');
  const router = require('../routes/email-unsubscribe');
  const app = express();
  app.use('/api/email', router);

  const bookingUrl = new URL(buildUnsubscribeUrl(42, 'booking_confirmation'));
  const bookingPath = bookingUrl.pathname + bookingUrl.search;

  let res = await request(app, { path: bookingPath });
  assert.strictEqual(res.status, 200, 'GET should render confirmation page');
  assert(res.text.includes('Confirm unsubscribe'), 'GET should ask for confirmation');
  assert.deepStrictEqual(updates, [], 'GET must not mutate preferences');

  const tamperedPath = bookingPath.replace('type=booking_confirmation', 'type=all');
  res = await request(app, { path: tamperedPath });
  assert.strictEqual(res.status, 400, 'tampering query type must be rejected');
  assert.deepStrictEqual(updates, [], 'tampered GET must not mutate preferences');

  const postBody = bookingUrl.searchParams.toString();
  res = await request(app, {
    method: 'POST',
    path: '/api/email/unsubscribe',
    body: postBody,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  assert.strictEqual(res.status, 200, 'POST should process valid unsubscribe');
  assert.deepStrictEqual(updates, [
    { kind: 'ensure', userId: 42 },
    { kind: 'update', userId: 42, patch: { booking_confirmation: false } },
  ]);

  updates.length = 0;
  const allUrl = new URL(buildUnsubscribeUrl(42, 'all'));
  res = await request(app, {
    method: 'POST',
    path: '/api/email/unsubscribe',
    body: allUrl.searchParams.toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  assert.strictEqual(res.status, 200, 'POST should process valid all-off unsubscribe');
  assert.deepStrictEqual(updates, [
    { kind: 'ensure', userId: 42 },
    { kind: 'update', userId: 42, patch: { email_all_off: true } },
  ]);

  updates.length = 0;
  const forgedRequired = new URL(buildUnsubscribeUrl(42, 'password_reset'));
  assert.strictEqual(forgedRequired.searchParams.get('type'), 'all', 'required types must not produce type-specific unsubscribe links');
}

(async () => {
  await testDirectPreferenceUpdatesIgnoreRequiredTypes();
  await testRequiredEmailPreferences();
  await testUnsubscribeEndpointRequiresPostAndBoundType();
  console.log('critical bug regressions passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
