#!/usr/bin/env node
'use strict';

const assert = require('assert');
const http = require('http');
const express = require('express');

async function request(server, method, path, body) {
  const address = server.address();
  const payload = body ? Buffer.from(body) : null;
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: address.port,
      method,
      path,
      headers: payload ? {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': payload.length,
      } : undefined,
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function withServer(app, fn) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await fn(server);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function testRequiredEmailBypassAndFooters() {
  const dbPath = require.resolve('../db/notification-prefs');
  const notificationPath = require.resolve('../lib/notification-prefs');
  const originalDb = require.cache[dbPath];

  delete require.cache[notificationPath];
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      getPrefs: async () => {
        throw new Error('required email types must not query preferences');
      },
    },
  };

  try {
    const {
      EMAIL_TYPES,
      appendUnsubscribeFooter,
      shouldSendEmail,
      getPreferenceCatalog,
    } = require('../lib/notification-prefs');

    assert.strictEqual(await shouldSendEmail(42, EMAIL_TYPES.password_reset), true);
    assert.deepStrictEqual(
      appendUnsubscribeFooter('<p>Reset</p>', 'Reset', 42, EMAIL_TYPES.password_reset),
      { html: '<p>Reset</p>', text: 'Reset' }
    );

    const textOnly = appendUnsubscribeFooter(null, 'Endorsement expires soon', 42, EMAIL_TYPES.endorsement_expiry);
    assert.strictEqual(textOnly.html, null);
    assert.match(textOnly.text, /Unsubscribe from Endorsement expiry alerts/);

    const catalogJson = JSON.stringify(getPreferenceCatalog('student', false));
    assert(!catalogJson.includes('password_reset'));
    assert(!catalogJson.includes('account_approved'));
  } finally {
    delete require.cache[notificationPath];
    if (originalDb) require.cache[dbPath] = originalDb;
    else delete require.cache[dbPath];
  }
}

async function testPreferenceUpdateIgnoresRequiredTypes() {
  const dbIndexPath = require.resolve('../db/index');
  const prefsPath = require.resolve('../db/notification-prefs');
  const originalDbIndex = require.cache[dbIndexPath];
  const originalPrefs = require.cache[prefsPath];
  const queries = [];
  const fakeDb = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (/SELECT \* FROM user_email_preferences/i.test(sql)) {
        return {
          rows: [{
            email_all_off: true,
            booking_confirmation: false,
            password_reset: true,
          }],
        };
      }
      return { rows: [] };
    },
  };

  delete require.cache[prefsPath];
  require.cache[dbIndexPath] = {
    id: dbIndexPath,
    filename: dbIndexPath,
    loaded: true,
    exports: fakeDb,
  };

  try {
    const { updatePrefs } = require('../db/notification-prefs');
    await updatePrefs(7, {
      email_all_off: true,
      booking_confirmation: false,
      password_reset: false,
      account_invite: false,
    }, fakeDb);
  } finally {
    delete require.cache[prefsPath];
    if (originalPrefs) require.cache[prefsPath] = originalPrefs;
    if (originalDbIndex) require.cache[dbIndexPath] = originalDbIndex;
    else delete require.cache[dbIndexPath];
  }

  const update = queries.find((q) => /^UPDATE user_email_preferences SET/i.test(q.sql));
  assert(update, 'expected an UPDATE query');
  assert.match(update.sql, /email_all_off/);
  assert.match(update.sql, /booking_confirmation/);
  assert(!/password_reset/.test(update.sql), 'password_reset must not be user-toggleable');
  assert(!/account_invite/.test(update.sql), 'account_invite must not be user-toggleable');
}

async function testUnsubscribeTokenAndRoutes() {
  const dbPath = require.resolve('../db/notification-prefs');
  const routePath = require.resolve('../routes/email-unsubscribe');
  const originalDb = require.cache[dbPath];
  delete require.cache[routePath];

  const calls = { ensure: 0, update: 0, patches: [] };
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      ensureDefaultPrefs: async () => { calls.ensure += 1; },
      updatePrefs: async (_userId, patch) => {
        calls.update += 1;
        calls.patches.push(patch);
        return patch;
      },
    },
  };

  try {
    const {
      signUnsubscribeToken,
      verifyUnsubscribeToken,
      buildUnsubscribeUrl,
    } = require('../lib/unsubscribe-token');

    const token = signUnsubscribeToken(9, 'booking_confirmation');
    assert.deepStrictEqual(verifyUnsubscribeToken(token, 'booking_confirmation'), {
      userId: 9,
      type: 'booking_confirmation',
    });
    assert.strictEqual(verifyUnsubscribeToken(token, 'password_reset'), null);
    assert.match(buildUnsubscribeUrl(9, 'password_reset'), /type=all/);

    const app = express();
    app.use('/api/email', require('../routes/email-unsubscribe'));

    await withServer(app, async (server) => {
      const encoded = encodeURIComponent(token);
      const getRes = await request(server, 'GET', `/api/email/unsubscribe?token=${encoded}&type=booking_confirmation`);
      assert.strictEqual(getRes.status, 200);
      assert.match(getRes.text, /Confirm unsubscribe/);
      assert.strictEqual(calls.update, 0, 'GET must not mutate preferences');

      const badRes = await request(server, 'POST', `/api/email/unsubscribe?token=${encoded}&type=password_reset`);
      assert.strictEqual(badRes.status, 400);
      assert.strictEqual(calls.update, 0, 'type-edited token must not mutate preferences');

      const postBody = `token=${encoded}&type=booking_confirmation`;
      const postRes = await request(server, 'POST', '/api/email/unsubscribe', postBody);
      assert.strictEqual(postRes.status, 200);
      assert.match(postRes.text, /Unsubscribed/);
      assert.strictEqual(calls.update, 1);
      assert.deepStrictEqual(calls.patches[0], { booking_confirmation: false });
    });
  } finally {
    delete require.cache[routePath];
    if (originalDb) require.cache[dbPath] = originalDb;
    else delete require.cache[dbPath];
  }
}

(async () => {
  await testRequiredEmailBypassAndFooters();
  await testPreferenceUpdateIgnoresRequiredTypes();
  await testUnsubscribeTokenAndRoutes();
  console.log('critical bug regressions passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
