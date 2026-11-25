'use strict';

const assert = require('assert');
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'critical-bug-test-secret';
process.env.DISABLE_IN_PROCESS_CRONS = 'true';

const dbIndexPath = require.resolve('../db/index');
require.cache[dbIndexPath] = {
  id: dbIndexPath,
  filename: dbIndexPath,
  loaded: true,
  exports: {
    query: async () => {
      throw new Error('Unexpected database access in critical bug regression test');
    },
  },
};

const {
  EMAIL_TYPES,
  REQUIRED_EMAIL_TYPES,
  isRequiredEmailType,
} = require('../lib/email-types');
const {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
  buildUnsubscribeUrl,
} = require('../lib/unsubscribe-token');
const {
  appendUnsubscribeFooter,
  getPreferenceCatalog,
} = require('../lib/notification-prefs');
const {
  MUTABLE_PREF_COLUMNS,
  rowToPrefs,
} = require('../db/notification-prefs');

async function request(app, method, path) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    return await new Promise((resolve, reject) => {
      const req = http.request({
        method,
        hostname: '127.0.0.1',
        port,
        path,
      }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      });
      req.on('error', reject);
      req.end();
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function testUnsubscribeRouteDoesNotMutateOnGet() {
  const dbPath = require.resolve('../db/notification-prefs');
  const routePath = require.resolve('../routes/email-unsubscribe');
  const originalDb = require.cache[dbPath].exports;
  delete require.cache[routePath];

  let ensureCalls = 0;
  let updateCalls = 0;
  require.cache[dbPath].exports = {
    ...originalDb,
    ensureDefaultPrefs: async () => { ensureCalls += 1; },
    updatePrefs: async () => { updateCalls += 1; return {}; },
  };

  try {
    const app = express();
    app.use(express.json());
    app.use('/api/email', require('../routes/email-unsubscribe'));

    const token = signUnsubscribeToken(123, EMAIL_TYPES.booking_confirmation);
    const encoded = encodeURIComponent(token);

    const getRes = await request(app, 'GET', `/api/email/unsubscribe?token=${encoded}&type=${EMAIL_TYPES.booking_confirmation}`);
    assert.strictEqual(getRes.status, 200);
    assert.match(getRes.body, /Confirm unsubscribe/);
    assert.strictEqual(ensureCalls, 0, 'GET confirmation must not create preference rows');
    assert.strictEqual(updateCalls, 0, 'GET confirmation must not mutate preferences');

    const tamperedRes = await request(app, 'GET', `/api/email/unsubscribe?token=${encoded}&type=all`);
    assert.strictEqual(tamperedRes.status, 400);
    assert.strictEqual(updateCalls, 0, 'tampered type must not mutate preferences');

    const postRes = await request(app, 'POST', `/api/email/unsubscribe?token=${encoded}&type=${EMAIL_TYPES.booking_confirmation}`);
    assert.strictEqual(postRes.status, 200);
    assert.match(postRes.body, /Unsubscribed/);
    assert.strictEqual(ensureCalls, 1, 'POST should ensure preference row');
    assert.strictEqual(updateCalls, 1, 'POST should perform exactly one preference mutation');
  } finally {
    require.cache[dbPath].exports = originalDb;
    delete require.cache[routePath];
  }
}

async function testLegacyCfiProfileRouteEscapesProfileCatchAll() {
  const authPath = require.resolve('../middleware/auth');
  const profilePath = require.resolve('../routes/profile');
  const endorsementsPath = require.resolve('../routes/endorsements');
  const originalAuth = require.cache[authPath]?.exports;
  const originalDb = require.cache[dbIndexPath].exports;

  delete require.cache[authPath];
  delete require.cache[profilePath];
  delete require.cache[endorsementsPath];

  require.cache[authPath] = {
    id: authPath,
    filename: authPath,
    loaded: true,
    exports: {
      authenticateToken: (req, _res, next) => {
        req.user = { id: 123, role: 'instructor' };
        next();
      },
      requireRole: () => (_req, _res, next) => next(),
    },
  };
  require.cache[dbIndexPath].exports = {
    query: async (sql) => {
      if (String(sql).includes('SELECT cfi_cert_number')) {
        return { rows: [{ cfi_cert_number: 'CFI123', cfi_expiry: '2027-01-01' }] };
      }
      return { rows: [] };
    },
  };

  try {
    const app = express();
    app.use(express.json());
    app.use('/api/users/me', require('../routes/profile'));
    app.use('/api/users/me', require('../routes/endorsements'));

    const res = await request(app, 'GET', '/api/users/me/cfi-profile');
    assert.strictEqual(res.status, 200);
    assert.match(res.body, /CFI123/);
  } finally {
    if (originalAuth) require.cache[authPath].exports = originalAuth;
    else delete require.cache[authPath];
    require.cache[dbIndexPath].exports = originalDb;
    delete require.cache[profilePath];
    delete require.cache[endorsementsPath];
  }
}

async function main() {
  const requiredTypes = [
    EMAIL_TYPES.password_reset,
    EMAIL_TYPES.account_approved,
    EMAIL_TYPES.account_rejected,
    EMAIL_TYPES.signup_pending,
    EMAIL_TYPES.account_invite,
    EMAIL_TYPES.profile_change,
    EMAIL_TYPES.welcome,
  ];

  for (const type of requiredTypes) {
    assert(REQUIRED_EMAIL_TYPES.has(type), `${type} must be required`);
    assert(isRequiredEmailType(type), `${type} must be treated as required`);
    assert(!MUTABLE_PREF_COLUMNS.includes(type), `${type} must not be directly mutable`);
  }

  const legacyToken = jwt.sign({ uid: 123, aud: 'email-unsub' }, process.env.JWT_SECRET, { expiresIn: '365d' });
  assert.strictEqual(verifyUnsubscribeToken(legacyToken), null, 'legacy user-only unsubscribe tokens must be rejected');

  const token = signUnsubscribeToken(123, EMAIL_TYPES.booking_cancelled);
  assert.deepStrictEqual(verifyUnsubscribeToken(token), { userId: 123, type: EMAIL_TYPES.booking_cancelled });

  const url = new URL(buildUnsubscribeUrl(123, EMAIL_TYPES.preflight_reminder));
  assert.strictEqual(url.searchParams.get('type'), EMAIL_TYPES.preflight_reminder);
  assert.deepStrictEqual(
    verifyUnsubscribeToken(url.searchParams.get('token')),
    { userId: 123, type: EMAIL_TYPES.preflight_reminder }
  );

  const catalogTypes = getPreferenceCatalog('owner', true).flatMap((category) => category.types.map((type) => type.key));
  for (const type of requiredTypes) {
    assert(!catalogTypes.includes(type), `${type} must not be shown as an optional preference`);
  }

  const requiredEmail = appendUnsubscribeFooter('<body>Reset</body>', 'Reset', 123, EMAIL_TYPES.password_reset);
  assert.strictEqual(requiredEmail.html, '<body>Reset</body>');
  assert.strictEqual(requiredEmail.text, 'Reset');

  const textOnly = appendUnsubscribeFooter(null, 'Endorsement expiring', 123, EMAIL_TYPES.endorsement_expiry);
  assert.strictEqual(textOnly.html, null);
  assert.match(textOnly.text, /Unsubscribe from Endorsement expiry alerts/);

  assert.strictEqual(rowToPrefs({ email_all_off: true, password_reset: false }).password_reset, true);

  await testUnsubscribeRouteDoesNotMutateOnGet();
  await testLegacyCfiProfileRouteEscapesProfileCatchAll();

  console.log('critical bug regression checks passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
