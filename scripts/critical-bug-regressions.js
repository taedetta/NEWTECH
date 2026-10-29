#!/usr/bin/env node
'use strict';

const assert = require('assert');
const http = require('http');
const path = require('path');

process.env.JWT_SECRET = 'critical-bug-regression-secret';

function installNotificationPrefsMock() {
  const updates = [];
  const ensures = [];
  const dbPath = require.resolve('../db/notification-prefs');
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      getPrefs: async () => ({
        email_all_off: true,
        booking_confirmation: false,
        endorsement_expiry: false,
      }),
      ensureDefaultPrefs: async (userId) => {
        ensures.push(userId);
      },
      updatePrefs: async (userId, patch) => {
        updates.push({ userId, patch });
        return { userId, ...patch };
      },
    },
  };
  return { updates, ensures };
}

function request(server, method, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: server.address().port,
        method,
        path: urlPath,
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

async function withServer(router, fn) {
  const express = require('express');
  const app = express();
  app.use('/api/email', router);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    await fn(server);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function testRequiredPrefsCannotBePersistedFalse() {
  const queries = [];
  const mockDb = {
    query: async (sql, args) => {
      queries.push({ sql, args });
      if (/SELECT \* FROM user_email_preferences/.test(sql)) {
        return {
          rows: [{
            email_all_off: false,
            booking_confirmation: false,
            password_reset: false,
            account_approved: false,
          }],
        };
      }
      return { rows: [] };
    },
  };

  const dbIndexPath = require.resolve('../db/index');
  require.cache[dbIndexPath] = {
    id: dbIndexPath,
    filename: dbIndexPath,
    loaded: true,
    exports: mockDb,
  };
  const prefs = require('../db/notification-prefs');
  assert.strictEqual(prefs.rowToPrefs({
    email_all_off: false,
    booking_confirmation: false,
    password_reset: false,
    account_approved: false,
  }).password_reset, true);

  await prefs.updatePrefs(123, { password_reset: false, account_approved: false, booking_confirmation: false }, mockDb);
  const update = queries.find((q) => /^UPDATE user_email_preferences/.test(q.sql));
  assert.ok(update, 'expected an UPDATE for optional preference changes');
  assert.match(update.sql, /booking_confirmation/);
  assert.doesNotMatch(update.sql, /password_reset/);
  assert.doesNotMatch(update.sql, /account_approved/);
}

async function testUnsubscribeRouteRequiresPostAndBoundType() {
  const mock = installNotificationPrefsMock();
  const { buildUnsubscribeUrl, signUnsubscribeToken } = require('../lib/unsubscribe-token');
  const router = require('../routes/email-unsubscribe');

  await withServer(router, async (server) => {
    const url = new URL(buildUnsubscribeUrl(123, 'booking_confirmation'));
    const validPath = `${url.pathname}${url.search}`;
    const getRes = await request(server, 'GET', validPath);
    assert.strictEqual(getRes.status, 200);
    assert.match(getRes.body, /Confirm unsubscribe/);
    assert.deepStrictEqual(mock.updates, [], 'GET must not mutate preferences');
    assert.deepStrictEqual(mock.ensures, [], 'GET must not create preference rows');

    const postRes = await request(server, 'POST', validPath);
    assert.strictEqual(postRes.status, 200);
    assert.deepStrictEqual(mock.updates, [
      { userId: 123, patch: { booking_confirmation: false } },
    ]);

    mock.updates.length = 0;
    const tamperedPath = validPath.replace('type=booking_confirmation', 'type=preflight_reminder');
    const tamperedRes = await request(server, 'POST', tamperedPath);
    assert.strictEqual(tamperedRes.status, 400);
    assert.deepStrictEqual(mock.updates, [], 'token type mismatch must be rejected');

    const legacyToken = require('jsonwebtoken').sign({ uid: 123, aud: 'email-unsub' }, process.env.JWT_SECRET);
    const legacyRes = await request(server, 'POST', `/api/email/unsubscribe?token=${encodeURIComponent(legacyToken)}&type=booking_confirmation`);
    assert.strictEqual(legacyRes.status, 400);
    assert.deepStrictEqual(mock.updates, [], 'legacy user-only tokens must be rejected');

    assert.throws(() => signUnsubscribeToken(123, 'password_reset'), /Invalid unsubscribe email type/);
  });
}

async function testRequiredEmailsBypassPrefsAndHaveNoFooter() {
  installNotificationPrefsMock();
  const {
    appendUnsubscribeFooter,
    getPreferenceCatalog,
    shouldSendEmail,
  } = require('../lib/notification-prefs');

  assert.strictEqual(await shouldSendEmail(123, 'password_reset'), true);
  assert.strictEqual(await shouldSendEmail(123, 'booking_confirmation'), false);

  const required = appendUnsubscribeFooter('<p>Reset</p>', 'Reset', 123, 'password_reset');
  assert.deepStrictEqual(required, { html: '<p>Reset</p>', text: 'Reset' });

  const optionalTextOnly = appendUnsubscribeFooter(null, 'Endorsement expiring', 123, 'endorsement_expiry');
  assert.strictEqual(optionalTextOnly.html, null);
  assert.match(optionalTextOnly.text, /Unsubscribe from Endorsement expiry alerts/);

  const catalogJson = JSON.stringify(getPreferenceCatalog('admin', false));
  for (const requiredKey of ['password_reset', 'account_approved', 'account_rejected', 'signup_pending', 'account_invite', 'profile_change', 'welcome']) {
    assert.ok(!catalogJson.includes(requiredKey), `${requiredKey} should not be user-toggleable`);
  }
}

function testProfileRouteMountOrder() {
  const fs = require('fs');
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const endorsementsIdx = serverSource.indexOf("app.use('/api/users/me', endorsementsRoutes)");
  const profileIdx = serverSource.indexOf("app.use('/api/users/me', profileRoutes)");
  assert.ok(endorsementsIdx !== -1 && profileIdx !== -1, 'expected /api/users/me route mounts');
  assert.ok(endorsementsIdx < profileIdx, 'cfi-profile routes must mount before profile 404 catch-all');
}

(async () => {
  await testRequiredPrefsCannotBePersistedFalse();
  await testUnsubscribeRouteRequiresPostAndBoundType();
  await testRequiredEmailsBypassPrefsAndHaveNoFooter();
  testProfileRouteMountOrder();
  console.log('critical bug regression checks passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
