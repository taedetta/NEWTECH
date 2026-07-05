'use strict';

const assert = require('assert');
const http = require('http');
const express = require('express');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-critical-bugs-secret';
process.env.APP_URL = process.env.APP_URL || 'http://127.0.0.1';

// Keep this regression suite offline: db/index exits when DATABASE_URL is absent.
const dbIndexPath = require.resolve('../db/index');
require.cache[dbIndexPath] = {
  id: dbIndexPath,
  filename: dbIndexPath,
  loaded: true,
  exports: {
    query: async () => ({ rows: [] }),
    on: () => {},
  },
};

const {
  buildUnsubscribeUrl,
  verifyUnsubscribeToken,
} = require('../lib/unsubscribe-token');
const {
  EMAIL_TYPES,
  appendUnsubscribeFooter,
  getPreferenceCatalog,
  shouldSendEmail,
} = require('../lib/notification-prefs');
const notificationPrefsDbPath = require.resolve('../db/notification-prefs');
const notificationPrefsDb = require('../db/notification-prefs');

function pathFromBuiltUrl(url) {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

function request(server, method, path) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({ method, port, host: '127.0.0.1', path }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function testPreferenceInvariants() {
  const catalogKeys = getPreferenceCatalog('student', false).flatMap((cat) => cat.types.map((type) => type.key));
  assert(!catalogKeys.includes(EMAIL_TYPES.password_reset), 'password reset must not be user-configurable');

  const withFooter = appendUnsubscribeFooter('<p>Reset your password</p>', 'Reset your password', 7, EMAIL_TYPES.password_reset);
  assert.strictEqual(withFooter.html, '<p>Reset your password</p>');
  assert.strictEqual(withFooter.text, 'Reset your password');

  assert.strictEqual(await shouldSendEmail(7, EMAIL_TYPES.password_reset), true, 'password reset must bypass opt-out checks');
  assert.strictEqual(
    notificationPrefsDb.rowToPrefs({ email_all_off: true, password_reset: false }).password_reset,
    true,
    'stored password_reset=false must normalize to enabled'
  );

  const sql = [];
  const fakeDb = {
    async query(text) {
      sql.push(text);
      return { rows: [{ user_id: 7, email_all_off: false, password_reset: false }] };
    },
  };
  const prefs = await notificationPrefsDb.updatePrefs(7, { password_reset: false }, fakeDb);
  assert.strictEqual(prefs.password_reset, true);
  assert(!sql.some((text) => /UPDATE user_email_preferences SET .*password_reset/i.test(text)), 'password_reset must not be updated');
}

async function testUnsubscribeRoute() {
  const updates = [];
  const originalDbModule = require.cache[notificationPrefsDbPath];
  require.cache[notificationPrefsDbPath] = {
    id: notificationPrefsDbPath,
    filename: notificationPrefsDbPath,
    loaded: true,
    exports: {
      ensureDefaultPrefs: async () => {},
      updatePrefs: async (userId, patch) => {
        updates.push({ userId, patch });
        return patch;
      },
    },
  };
  delete require.cache[require.resolve('../routes/email-unsubscribe')];

  try {
    const app = express();
    app.use('/api/email', require('../routes/email-unsubscribe'));
    const server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const allPath = pathFromBuiltUrl(buildUnsubscribeUrl(42, 'all'));
      const getRes = await request(server, 'GET', allPath);
      assert.strictEqual(getRes.status, 200);
      assert(getRes.body.includes('Confirm unsubscribe'));
      assert.deepStrictEqual(updates, [], 'GET unsubscribe must not mutate preferences');

      const postRes = await request(server, 'POST', allPath);
      assert.strictEqual(postRes.status, 200);
      assert.deepStrictEqual(updates, [{ userId: 42, patch: { email_all_off: true } }]);

      updates.length = 0;
      const typePath = pathFromBuiltUrl(buildUnsubscribeUrl(42, EMAIL_TYPES.booking_confirmation));
      const tampered = typePath.replace('type=booking_confirmation', 'type=all');
      const tamperedRes = await request(server, 'POST', tampered);
      assert.strictEqual(tamperedRes.status, 400);
      assert.deepStrictEqual(updates, [], 'tampered unsubscribe type must not mutate preferences');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    if (originalDbModule) require.cache[notificationPrefsDbPath] = originalDbModule;
    else delete require.cache[notificationPrefsDbPath];
    delete require.cache[require.resolve('../routes/email-unsubscribe')];
  }
}

async function testTokenBinding() {
  const url = buildUnsubscribeUrl(42, EMAIL_TYPES.booking_cancelled);
  const parsed = new URL(url);
  const verified = verifyUnsubscribeToken(parsed.searchParams.get('token'));
  assert.deepStrictEqual(verified, { userId: 42, type: EMAIL_TYPES.booking_cancelled });

  const resetUrl = buildUnsubscribeUrl(42, EMAIL_TYPES.password_reset);
  assert.strictEqual(new URL(resetUrl).searchParams.get('type'), 'all', 'required types must not get type-specific unsubscribe tokens');
}

(async () => {
  await testPreferenceInvariants();
  await testTokenBinding();
  await testUnsubscribeRoute();
  console.log('critical bug regressions passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
