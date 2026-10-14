'use strict';

process.env.JWT_SECRET = 'test-unsubscribe-secret';
process.env.APP_URL = 'https://example.test';

const assert = require('assert');
const http = require('http');
const express = require('express');

const dbPath = require.resolve('../db/notification-prefs');
const dbCalls = [];

require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    ensureDefaultPrefs: async (userId) => {
      dbCalls.push({ op: 'ensureDefaultPrefs', userId });
    },
    updatePrefs: async (userId, patch) => {
      dbCalls.push({ op: 'updatePrefs', userId, patch });
      return { email_all_off: !!patch.email_all_off, ...patch };
    },
  },
};

const { buildUnsubscribeUrl } = require('../lib/unsubscribe-token');
const { appendUnsubscribeFooter, getPreferenceCatalog, shouldSendEmail } = require('../lib/notification-prefs');
const unsubscribeRouter = require('../routes/email-unsubscribe');

function parseBuiltUrl(type) {
  return new URL(buildUnsubscribeUrl(42, type));
}

async function request(server, method, path) {
  const port = server.address().port;
  return new Promise((resolve, reject) => {
    const req = http.request({ port, method, path }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const app = express();
  app.use(express.json());
  app.use('/api/email', unsubscribeRouter);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });

  try {
    const bookingUrl = parseBuiltUrl('booking_confirmation');
    const bookingToken = bookingUrl.searchParams.get('token');

    dbCalls.length = 0;
    let res = await request(
      server,
      'GET',
      `/api/email/unsubscribe?token=${encodeURIComponent(bookingToken)}&type=all`
    );
    assert.strictEqual(res.status, 400, 'tampered GET type must be rejected');
    assert.deepStrictEqual(dbCalls, [], 'GET tampering must not touch preferences');

    res = await request(
      server,
      'GET',
      `/api/email/unsubscribe?token=${encodeURIComponent(bookingToken)}&type=booking_confirmation`
    );
    assert.strictEqual(res.status, 200, 'valid GET should render confirmation');
    assert.match(res.body, /Confirm unsubscribe/);
    assert.deepStrictEqual(dbCalls, [], 'GET confirmation must not mutate preferences');

    res = await request(
      server,
      'POST',
      `/api/email/unsubscribe?token=${encodeURIComponent(bookingToken)}&type=all`
    );
    assert.strictEqual(res.status, 400, 'tampered POST type must be rejected');
    assert.deepStrictEqual(dbCalls, [], 'tampered POST must not touch preferences');

    res = await request(
      server,
      'POST',
      `/api/email/unsubscribe?token=${encodeURIComponent(bookingToken)}&type=booking_confirmation`
    );
    assert.strictEqual(res.status, 200, 'valid POST should unsubscribe signed type');
    assert.deepStrictEqual(dbCalls, [
      { op: 'ensureDefaultPrefs', userId: 42 },
      { op: 'updatePrefs', userId: 42, patch: { booking_confirmation: false } },
    ]);

    const allUrl = parseBuiltUrl('all');
    dbCalls.length = 0;
    res = await request(
      server,
      'POST',
      `/api/email/unsubscribe?token=${encodeURIComponent(allUrl.searchParams.get('token'))}&type=all`
    );
    assert.strictEqual(res.status, 200, 'all-off token should unsubscribe optional emails');
    assert.deepStrictEqual(dbCalls, [
      { op: 'ensureDefaultPrefs', userId: 42 },
      { op: 'updatePrefs', userId: 42, patch: { email_all_off: true } },
    ]);

    const passwordUrl = parseBuiltUrl('password_reset');
    res = await request(
      server,
      'GET',
      `/api/email/unsubscribe?token=${encodeURIComponent(passwordUrl.searchParams.get('token'))}&type=password_reset`
    );
    assert.strictEqual(res.status, 400, 'required email types must not be unsubscribable');

    const categories = getPreferenceCatalog('owner', false);
    assert.ok(!JSON.stringify(categories).includes('password_reset'), 'required email types are hidden from preference catalog');

    const requiredFooter = appendUnsubscribeFooter('<body>Reset</body>', 'Reset', 42, 'password_reset');
    assert.deepStrictEqual(requiredFooter, { html: '<body>Reset</body>', text: 'Reset' }, 'required emails must not get unsubscribe footers');
    assert.strictEqual(await shouldSendEmail(42, 'password_reset'), true, 'required emails must bypass opt-out preferences');

    const textOnlyFooter = appendUnsubscribeFooter(null, 'Expiry notice', 42, 'endorsement_expiry');
    assert.strictEqual(textOnlyFooter.html, null, 'text-only optional emails should remain text-only');
    assert.match(textOnlyFooter.text, /Unsubscribe from Endorsement expiry alerts/);

    console.log('unsubscribe security tests passed');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
