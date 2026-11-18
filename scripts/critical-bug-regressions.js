'use strict';

const assert = require('assert');
const http = require('http');
const jwt = require('jsonwebtoken');
const express = require('express');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'critical-bug-test-secret';
process.env.APP_URL = process.env.APP_URL || 'https://example.test';

function mockModule(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports,
  };
}

function clearModule(modulePath) {
  delete require.cache[require.resolve(modulePath)];
}

function request(server, method, path) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function testUnsubscribeTokens() {
  const { signUnsubscribeToken, verifyUnsubscribeToken, buildUnsubscribeUrl } = require('../lib/unsubscribe-token');
  const token = signUnsubscribeToken(123, 'booking_confirmation');
  assert.deepStrictEqual(verifyUnsubscribeToken(token), { userId: 123, type: 'booking_confirmation' });

  const legacy = jwt.sign({ uid: 123, aud: 'email-unsub' }, process.env.JWT_SECRET, { expiresIn: '365d' });
  assert.strictEqual(verifyUnsubscribeToken(legacy), null, 'legacy user-only tokens must be rejected');

  const url = new URL(buildUnsubscribeUrl(123, 'booking_confirmation'));
  const verified = verifyUnsubscribeToken(url.searchParams.get('token'));
  assert.strictEqual(verified.type, 'booking_confirmation');
  assert.strictEqual(url.searchParams.get('type'), 'booking_confirmation');
}

async function testNotificationPreferenceHelpers() {
  mockModule('../db/notification-prefs', {
    getPrefs: async () => ({
      email_all_off: true,
      booking_confirmation: false,
      password_reset: false,
    }),
  });
  mockModule('../email-templates', { sendEmail: async () => true });
  clearModule('../lib/notification-prefs');
  const prefs = require('../lib/notification-prefs');

  assert.strictEqual(await prefs.shouldSendEmail(42, 'password_reset'), true, 'password reset must ignore opt-outs');
  assert.strictEqual(await prefs.shouldSendEmail(42, 'booking_confirmation'), false, 'optional emails still honor opt-outs');

  const catalogTypes = prefs.getPreferenceCatalog('owner', true).flatMap((category) => category.types.map((type) => type.key));
  assert(!catalogTypes.includes('password_reset'), 'required email types should not be user-toggleable');
  assert(catalogTypes.includes('booking_confirmation'), 'optional email types should remain visible');

  const requiredFooter = prefs.appendUnsubscribeFooter('<p>Reset</p>', 'Reset', 42, 'password_reset');
  assert.deepStrictEqual(requiredFooter, { html: '<p>Reset</p>', text: 'Reset' }, 'required emails must not get unsubscribe footers');

  const textOnlyFooter = prefs.appendUnsubscribeFooter(null, 'Endorsement body', 42, 'endorsement_expiry');
  assert.strictEqual(textOnlyFooter.html, null);
  assert(textOnlyFooter.text.includes('Unsubscribe from Endorsement expiry alerts'), 'text-only optional emails should get text unsubscribe links');
}

async function testUnsubscribeRoute() {
  const updates = [];
  const ensured = [];
  mockModule('../db/notification-prefs', {
    ensureDefaultPrefs: async (userId) => { ensured.push(userId); },
    updatePrefs: async (userId, patch) => {
      updates.push({ userId, patch });
      return patch;
    },
  });
  clearModule('../routes/email-unsubscribe');
  const router = require('../routes/email-unsubscribe');
  const { signUnsubscribeToken } = require('../lib/unsubscribe-token');

  const app = express();
  app.use(express.json());
  app.use('/api/email', router);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  try {
    const token = signUnsubscribeToken(7, 'booking_confirmation');
    const safePath = `/api/email/unsubscribe?token=${encodeURIComponent(token)}&type=booking_confirmation`;

    let res = await request(server, 'GET', safePath);
    assert.strictEqual(res.status, 200);
    assert(res.body.includes('Confirm unsubscribe'));
    assert.strictEqual(updates.length, 0, 'GET must not mutate preferences');

    res = await request(server, 'POST', safePath);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(updates, [{ userId: 7, patch: { booking_confirmation: false } }]);
    assert.deepStrictEqual(ensured, [7]);

    res = await request(server, 'POST', `/api/email/unsubscribe?token=${encodeURIComponent(token)}&type=all`);
    assert.strictEqual(res.status, 400, 'query type tampering must be rejected');
    assert.strictEqual(updates.length, 1);

    const requiredToken = signUnsubscribeToken(7, 'password_reset');
    res = await request(server, 'POST', `/api/email/unsubscribe?token=${encodeURIComponent(requiredToken)}&type=password_reset`);
    assert.strictEqual(res.status, 400, 'required email types must not be unsubscribable');
    assert.strictEqual(updates.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function testDbPreferenceUpdatesIgnoreRequiredTypes() {
  clearModule('../db/notification-prefs');
  const updateQueries = [];
  const fakeDb = {
    query: async (sql, vals = []) => {
      if (/^\s*UPDATE user_email_preferences/i.test(sql)) updateQueries.push({ sql, vals });
      if (/^\s*SELECT \*/i.test(sql)) {
        return {
          rows: [{
            email_all_off: true,
            booking_confirmation: false,
            password_reset: false,
            account_approved: false,
          }],
        };
      }
      return { rows: [] };
    },
  };
  mockModule('../db/index', fakeDb);
  const dbPrefs = require('../db/notification-prefs');

  const rowPrefs = dbPrefs.rowToPrefs({
    email_all_off: true,
    booking_confirmation: false,
    password_reset: false,
    account_approved: false,
  });
  assert.strictEqual(rowPrefs.password_reset, true);
  assert.strictEqual(rowPrefs.account_approved, true);
  assert.strictEqual(rowPrefs.booking_confirmation, false);

  await dbPrefs.updatePrefs(5, {
    email_all_off: true,
    booking_confirmation: false,
    password_reset: false,
    account_approved: false,
  }, fakeDb);

  assert.strictEqual(updateQueries.length, 1);
  assert(updateQueries[0].sql.includes('email_all_off'));
  assert(updateQueries[0].sql.includes('booking_confirmation'));
  assert(!updateQueries[0].sql.includes('password_reset'));
  assert(!updateQueries[0].sql.includes('account_approved'));
}

(async () => {
  await testUnsubscribeTokens();
  await testNotificationPreferenceHelpers();
  await testUnsubscribeRoute();
  await testDbPreferenceUpdatesIgnoreRequiredTypes();
  console.log('critical bug regressions passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
