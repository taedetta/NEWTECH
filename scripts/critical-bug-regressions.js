'use strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'critical-bug-test-secret';
process.env.APP_URL = process.env.APP_URL || 'https://example.test';

const assert = require('assert');
const http = require('http');
const jwt = require('jsonwebtoken');
const express = require('express');

const {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} = require('../lib/unsubscribe-token');
const {
  appendUnsubscribeFooter,
  getPreferenceCatalog,
  shouldSendEmail,
} = require('../lib/notification-prefs');
const { rowToPrefs } = require('../db/notification-prefs');
const emailUnsubscribeRoutes = require('../routes/email-unsubscribe');

async function request(app, path) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    return await new Promise((resolve, reject) => {
      http.get({ hostname: '127.0.0.1', port, path }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve({ statusCode: res.statusCode, body }));
      }).on('error', reject);
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function run() {
  const bookingToken = signUnsubscribeToken(42, 'booking_confirmation');
  assert.deepStrictEqual(
    verifyUnsubscribeToken(bookingToken, 'booking_confirmation'),
    { userId: 42, type: 'booking_confirmation' }
  );
  assert.strictEqual(
    verifyUnsubscribeToken(bookingToken, 'all'),
    null,
    'query-string type edits must not widen an unsubscribe token'
  );

  const legacyToken = jwt.sign(
    { uid: 42, aud: 'email-unsub' },
    process.env.JWT_SECRET,
    { expiresIn: '365d' }
  );
  assert.strictEqual(
    verifyUnsubscribeToken(legacyToken, 'booking_confirmation'),
    null,
    'legacy user-only unsubscribe tokens must be rejected'
  );

  const catalogTypes = getPreferenceCatalog('owner', false).flatMap((category) => (
    category.types.map((type) => type.key)
  ));
  for (const required of [
    'password_reset',
    'account_approved',
    'account_rejected',
    'signup_pending',
    'account_invite',
    'profile_change',
    'welcome',
  ]) {
    assert(!catalogTypes.includes(required), `${required} must not appear as an opt-out preference`);
  }

  assert.strictEqual(
    await shouldSendEmail(42, 'password_reset'),
    true,
    'required security emails must bypass preference checks'
  );

  const requiredFooter = appendUnsubscribeFooter('<p>Reset</p>', 'Reset', 42, 'password_reset');
  assert.strictEqual(requiredFooter.html, '<p>Reset</p>');
  assert.strictEqual(requiredFooter.text, 'Reset');

  const textOnlyFooter = appendUnsubscribeFooter(null, 'Briefing', 42, 'instructor_briefing');
  assert.strictEqual(textOnlyFooter.html, null);
  assert(textOnlyFooter.text.includes('Unsubscribe from Daily instructor briefing'));

  const prefs = rowToPrefs({ email_all_off: true, password_reset: false, booking_confirmation: false });
  assert.strictEqual(prefs.password_reset, true, 'stored false values for required types must be ignored');
  assert.strictEqual(prefs.booking_confirmation, false);

  const app = express();
  app.use('/api/email', emailUnsubscribeRoutes);
  const confirmation = await request(
    app,
    `/api/email/unsubscribe?token=${encodeURIComponent(bookingToken)}&type=booking_confirmation`
  );
  assert.strictEqual(confirmation.statusCode, 200);
  assert(confirmation.body.includes('Confirm unsubscribe'));
  assert(confirmation.body.includes('method="POST"'));
  assert(!confirmation.body.includes('Unsubscribed</h1>'));

  console.log('critical-bug regressions passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
