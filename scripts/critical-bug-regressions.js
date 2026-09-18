'use strict';

const assert = require('assert');
const http = require('http');
const express = require('express');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'critical-bug-regression-secret';

function clearModule(modulePath) {
  delete require.cache[require.resolve(modulePath)];
}

async function request(server, method, path, body) {
  const address = server.address();
  const payload = body ? new URLSearchParams(body).toString() : null;
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: address.port,
      method,
      path,
      headers: payload ? {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(payload),
      } : {},
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

function installPrefsMock() {
  const dbPath = require.resolve('../db/notification-prefs');
  const calls = { updates: [], ensures: [] };
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      getPrefs: async () => ({
        email_all_off: true,
        booking_confirmation: false,
        password_reset: false,
        profile_change: false,
      }),
      ensureDefaultPrefs: async (userId) => { calls.ensures.push(userId); },
      updatePrefs: async (userId, patch) => {
        calls.updates.push({ userId, patch });
        return patch;
      },
    },
  };
  return calls;
}

function installPoolMock() {
  const poolPath = require.resolve('../db/index');
  require.cache[poolPath] = {
    id: poolPath,
    filename: poolPath,
    loaded: true,
    exports: {
      query: async () => ({ rows: [] }),
    },
  };
}

async function testRequiredEmailInvariants() {
  installPrefsMock();
  clearModule('../lib/notification-prefs');
  const {
    EMAIL_TYPES,
    appendUnsubscribeFooter,
    getPreferenceCatalog,
    shouldSendEmail,
  } = require('../lib/notification-prefs');

  assert.strictEqual(await shouldSendEmail(123, EMAIL_TYPES.password_reset), true);
  assert.strictEqual(await shouldSendEmail(123, EMAIL_TYPES.profile_change), true);
  assert.strictEqual(await shouldSendEmail(123, EMAIL_TYPES.booking_confirmation), false);

  const catalogKeys = getPreferenceCatalog('student', false)
    .flatMap((category) => category.types.map((type) => type.key));
  assert(!catalogKeys.includes(EMAIL_TYPES.password_reset));
  assert(!catalogKeys.includes(EMAIL_TYPES.profile_change));
  assert(catalogKeys.includes(EMAIL_TYPES.booking_confirmation));

  const required = appendUnsubscribeFooter('<body>Reset</body>', 'Reset', 123, EMAIL_TYPES.password_reset);
  assert(!required.html.includes('Unsubscribe'));
  assert(!required.text.includes('Unsubscribe'));

  const optionalTextOnly = appendUnsubscribeFooter(null, 'Endorsement expiring', 123, EMAIL_TYPES.endorsement_expiry);
  assert.strictEqual(optionalTextOnly.html, null);
  assert(optionalTextOnly.text.includes('Unsubscribe from Endorsement expiry alerts'));

  installPoolMock();
  clearModule('../db/notification-prefs');
  const { rowToPrefs } = require('../db/notification-prefs');
  const persisted = rowToPrefs({ email_all_off: true, password_reset: false, profile_change: false });
  assert.strictEqual(persisted.password_reset, true);
  assert.strictEqual(persisted.profile_change, true);
  assert.strictEqual(persisted.email_all_off, true);
}

function testTokenBinding() {
  clearModule('../lib/unsubscribe-token');
  const { buildUnsubscribeUrl, verifyUnsubscribeToken } = require('../lib/unsubscribe-token');
  const url = new URL(buildUnsubscribeUrl(123, 'booking_confirmation'));
  const token = url.searchParams.get('token');

  assert.strictEqual(url.searchParams.get('type'), 'booking_confirmation');
  assert.deepStrictEqual(verifyUnsubscribeToken(token), {
    userId: 123,
    type: 'booking_confirmation',
  });
}

async function testUnsubscribeGetDoesNotMutate() {
  const calls = installPrefsMock();
  clearModule('../routes/email-unsubscribe');
  clearModule('../lib/unsubscribe-token');

  const { buildUnsubscribeUrl } = require('../lib/unsubscribe-token');
  const router = require('../routes/email-unsubscribe');
  const app = express();
  app.use('/api/email', router);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  try {
    const url = new URL(buildUnsubscribeUrl(123, 'booking_confirmation'));
    const path = `${url.pathname}${url.search}`;
    const getRes = await request(server, 'GET', path);
    assert.strictEqual(getRes.status, 200);
    assert(getRes.body.includes('Confirm unsubscribe'));
    assert.deepStrictEqual(calls.updates, []);

    const tampered = `/api/email/unsubscribe?token=${encodeURIComponent(url.searchParams.get('token'))}&type=all`;
    const tamperedRes = await request(server, 'GET', tampered);
    assert.strictEqual(tamperedRes.status, 400);
    assert.deepStrictEqual(calls.updates, []);

    const postRes = await request(server, 'POST', '/api/email/unsubscribe', {
      token: url.searchParams.get('token'),
      type: 'booking_confirmation',
    });
    assert.strictEqual(postRes.status, 200);
    assert.deepStrictEqual(calls.updates, [
      { userId: 123, patch: { booking_confirmation: false } },
    ]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

(async () => {
  await testRequiredEmailInvariants();
  testTokenBinding();
  await testUnsubscribeGetDoesNotMutate();
  console.log('critical bug regressions passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
