'use strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'critical-bug-regression-secret';

const assert = require('assert');
const http = require('http');
const jwt = require('jsonwebtoken');
const express = require('express');

const prefCalls = {
  ensure: [],
  update: [],
  get: [],
};

const prefsStub = {
  async ensureDefaultPrefs(userId) {
    prefCalls.ensure.push(userId);
  },
  async updatePrefs(userId, patch) {
    prefCalls.update.push({ userId, patch });
    return { email_all_off: !!patch.email_all_off, ...patch };
  },
  async getPrefs(userId) {
    prefCalls.get.push(userId);
    return {
      email_all_off: true,
      booking_confirmation: false,
      password_reset: false,
      profile_change: false,
    };
  },
};

const prefsPath = require.resolve('../db/notification-prefs');
require.cache[prefsPath] = {
  id: prefsPath,
  filename: prefsPath,
  loaded: true,
  exports: prefsStub,
};

const {
  EMAIL_TYPES,
  REQUIRED_EMAIL_TYPES,
  appendUnsubscribeFooter,
  getPreferenceCatalog,
  shouldSendEmail,
} = require('../lib/notification-prefs');
const {
  buildUnsubscribeUrl,
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} = require('../lib/unsubscribe-token');
const emailUnsubscribeRoutes = require('../routes/email-unsubscribe');

function request(app, method, path, body = null) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const payload = body == null ? null : new URLSearchParams(body).toString();
      const req = http.request({
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: payload ? {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(payload),
        } : {},
      }, (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          server.close(() => resolve({ status: res.statusCode, body: data }));
        });
      });
      req.on('error', (err) => {
        server.close(() => reject(err));
      });
      if (payload) req.write(payload);
      req.end();
    });
  });
}

async function run() {
  const typeUrl = new URL(buildUnsubscribeUrl(42, EMAIL_TYPES.booking_confirmation));
  const token = typeUrl.searchParams.get('token');
  assert.strictEqual(typeUrl.searchParams.get('type'), EMAIL_TYPES.booking_confirmation);
  assert.deepStrictEqual(verifyUnsubscribeToken(token), {
    userId: 42,
    type: EMAIL_TYPES.booking_confirmation,
  });
  assert.throws(
    () => buildUnsubscribeUrl(42, EMAIL_TYPES.password_reset),
    /Invalid unsubscribe email type/
  );

  const legacyUnboundToken = jwt.sign(
    { uid: 42, aud: 'email-unsub' },
    process.env.JWT_SECRET,
    { expiresIn: '365d' }
  );
  assert.strictEqual(verifyUnsubscribeToken(legacyUnboundToken), null);

  const app = express();
  app.use('/api/email', emailUnsubscribeRoutes);

  let res = await request(app, 'GET', `/api/email/unsubscribe?token=${encodeURIComponent(token)}&type=${EMAIL_TYPES.booking_confirmation}`);
  assert.strictEqual(res.status, 200);
  assert.match(res.body, /Confirm unsubscribe/);
  assert.deepStrictEqual(prefCalls.ensure, []);
  assert.deepStrictEqual(prefCalls.update, []);

  res = await request(app, 'GET', `/api/email/unsubscribe?token=${encodeURIComponent(token)}&type=all`);
  assert.strictEqual(res.status, 400);
  assert.deepStrictEqual(prefCalls.update, []);

  res = await request(app, 'POST', '/api/email/unsubscribe', { token });
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(prefCalls.update.pop(), {
    userId: 42,
    patch: { booking_confirmation: false },
  });

  const allToken = signUnsubscribeToken(42, 'all');
  res = await request(app, 'POST', '/api/email/unsubscribe', { token: allToken });
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(prefCalls.update.pop(), {
    userId: 42,
    patch: { email_all_off: true },
  });

  const categories = getPreferenceCatalog('student', false);
  const visibleTypes = new Set(categories.flatMap((c) => c.types.map((t) => t.key)));
  for (const type of REQUIRED_EMAIL_TYPES) {
    assert.strictEqual(visibleTypes.has(type), false, `${type} should not be user-toggleable`);
  }

  const requiredFooter = appendUnsubscribeFooter(
    '<body>Password reset</body>',
    'Password reset',
    42,
    EMAIL_TYPES.password_reset
  );
  assert.strictEqual(requiredFooter.html, '<body>Password reset</body>');
  assert.strictEqual(requiredFooter.text, 'Password reset');

  const textOnlyFooter = appendUnsubscribeFooter(null, 'Endorsement expiring', 42, EMAIL_TYPES.endorsement_expiry);
  assert.strictEqual(textOnlyFooter.html, null);
  assert.match(textOnlyFooter.text, /Unsubscribe from Endorsement expiry alerts/);

  assert.strictEqual(await shouldSendEmail(42, EMAIL_TYPES.password_reset), true);
  assert.strictEqual(await shouldSendEmail(42, EMAIL_TYPES.booking_confirmation), false);

  const queries = [];
  const fakeDb = {
    async query(sql, vals) {
      queries.push({ sql, vals });
      if (/SELECT \*/i.test(sql)) {
        return {
          rows: [{
            email_all_off: false,
            booking_confirmation: false,
            password_reset: false,
            profile_change: false,
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
    exports: fakeDb,
  };
  delete require.cache[prefsPath];
  const realPrefs = require('../db/notification-prefs');
  const updated = await realPrefs.updatePrefs(42, {
    booking_confirmation: false,
    password_reset: false,
    profile_change: false,
  }, fakeDb);
  const updateQuery = queries.find((q) => /^UPDATE user_email_preferences/i.test(q.sql));
  assert(updateQuery, 'expected an UPDATE query for optional preference changes');
  assert.match(updateQuery.sql, /booking_confirmation =/);
  assert.doesNotMatch(updateQuery.sql, /password_reset =/);
  assert.doesNotMatch(updateQuery.sql, /profile_change =/);
  assert.strictEqual(updated.password_reset, true);
  assert.strictEqual(updated.profile_change, true);

  console.log('critical-bug regressions passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
