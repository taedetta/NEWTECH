'use strict';

const assert = require('assert');
const express = require('express');
const http = require('http');

async function request(server, method, path, body) {
  const port = server.address().port;
  const payload = body ? new URLSearchParams(body).toString() : null;
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      method,
      path,
      headers: payload ? {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(payload),
      } : undefined,
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function withServer(app, fn) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    await fn(server);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
}

async function testUnsubscribeRouteDoesNotMutateOnGetAndBindsType() {
  const dbPath = require.resolve('../db/notification-prefs');
  const routePath = require.resolve('../routes/email-unsubscribe');
  const originalDbCache = require.cache[dbPath];
  const originalRouteCache = require.cache[routePath];
  const calls = [];

  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      ensureDefaultPrefs: async (userId) => calls.push({ op: 'ensure', userId }),
      updatePrefs: async (userId, patch) => {
        calls.push({ op: 'update', userId, patch });
        return patch;
      },
    },
  };
  delete require.cache[routePath];

  try {
    const { signUnsubscribeToken } = require('../lib/unsubscribe-token');
    const route = require('../routes/email-unsubscribe');
    const app = express();
    app.use('/api/email', route);
    const token = signUnsubscribeToken(123, 'booking_confirmation');

    await withServer(app, async (server) => {
      const confirm = await request(
        server,
        'GET',
        `/api/email/unsubscribe?token=${encodeURIComponent(token)}&type=booking_confirmation`
      );
      assert.strictEqual(confirm.status, 200);
      assert.match(confirm.body, /Confirm unsubscribe/);
      assert.deepStrictEqual(calls, [], 'GET unsubscribe must not mutate preferences');

      const tampered = await request(
        server,
        'POST',
        '/api/email/unsubscribe',
        { token, type: 'all' }
      );
      assert.strictEqual(tampered.status, 400, 'token type must bind unsubscribe scope');
      assert.deepStrictEqual(calls, [], 'tampered unsubscribe must not mutate preferences');

      const posted = await request(
        server,
        'POST',
        '/api/email/unsubscribe',
        { token, type: 'booking_confirmation' }
      );
      assert.strictEqual(posted.status, 200);
      assert.deepStrictEqual(calls, [
        { op: 'ensure', userId: 123 },
        { op: 'update', userId: 123, patch: { booking_confirmation: false } },
      ]);
    });
  } finally {
    if (originalDbCache) require.cache[dbPath] = originalDbCache;
    else delete require.cache[dbPath];
    if (originalRouteCache) require.cache[routePath] = originalRouteCache;
    else delete require.cache[routePath];
  }
}

async function testRequiredEmailTypesCannotBeSuppressed() {
  const {
    appendUnsubscribeFooter,
    getPreferenceCatalog,
    shouldSendEmail,
  } = require('../lib/notification-prefs');
  const { rowToPrefs, updatePrefs } = require('../db/notification-prefs');
  const { signUnsubscribeToken, verifyUnsubscribeToken, buildUnsubscribeUrl } = require('../lib/unsubscribe-token');

  const requiredToken = signUnsubscribeToken(77, 'password_reset');
  assert.strictEqual(verifyUnsubscribeToken(requiredToken, 'password_reset'), null, 'required email tokens are not type-unsubscribable');
  assert.match(buildUnsubscribeUrl(77, 'password_reset'), /type=all$/, 'required email types must not generate type opt-out URLs');

  const withFooter = appendUnsubscribeFooter('<body>Hello</body>', 'Hello', 77, 'password_reset');
  assert.strictEqual(withFooter.html, '<body>Hello</body>');
  assert.strictEqual(withFooter.text, 'Hello');

  const categories = getPreferenceCatalog('owner', true);
  const visibleTypes = categories.flatMap((cat) => cat.types.map((type) => type.key));
  assert(!visibleTypes.includes('password_reset'));
  assert(!visibleTypes.includes('profile_change'));
  assert(visibleTypes.includes('booking_confirmation'));

  const prefs = rowToPrefs({ email_all_off: true, password_reset: false, profile_change: false });
  assert.strictEqual(prefs.password_reset, true);
  assert.strictEqual(prefs.profile_change, true);

  const dbCalls = [];
  const fakeDb = {
    async query(sql, params) {
      dbCalls.push({ sql, params });
      if (/SELECT \* FROM user_email_preferences/.test(sql)) {
        return { rows: [{ user_id: 77, email_all_off: true, password_reset: false, booking_confirmation: true }] };
      }
      return { rows: [] };
    },
  };
  const updated = await updatePrefs(77, { password_reset: false, booking_confirmation: false }, fakeDb);
  const updateCall = dbCalls.find((call) => /^UPDATE user_email_preferences SET/.test(call.sql));
  assert(updateCall, 'optional preference update should still run');
  assert(!/password_reset/.test(updateCall.sql), 'required preference columns must not be updated');
  assert(/booking_confirmation/.test(updateCall.sql));
  assert.strictEqual(updated.password_reset, true);

  assert.strictEqual(await shouldSendEmail(77, 'password_reset'), true);
}

(async () => {
  await testUnsubscribeRouteDoesNotMutateOnGetAndBindsType();
  await testRequiredEmailTypesCannotBeSuppressed();
  console.log('critical bug regressions passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
