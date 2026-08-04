#!/usr/bin/env node
'use strict';

const assert = require('assert');

process.env.APP_URL = process.env.APP_URL || 'https://example.test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

function mockModule(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports,
  };
  return resolved;
}

async function run() {
  const {
    EMAIL_TYPES,
    OPTIONAL_EMAIL_TYPES,
    TYPE_CATEGORIES,
    isRequiredEmailType,
  } = require('../lib/email-types');

  assert.strictEqual(isRequiredEmailType(EMAIL_TYPES.password_reset), true);
  assert.strictEqual(OPTIONAL_EMAIL_TYPES.includes(EMAIL_TYPES.password_reset), false);
  assert.strictEqual(
    TYPE_CATEGORIES.some((category) => category.types.includes(EMAIL_TYPES.password_reset)),
    false,
    'password reset must not appear in the user-facing opt-out catalog'
  );

  const dbPrefsPath = mockModule('../db/notification-prefs', {
    getPrefs: async () => {
      throw new Error('password_reset delivery must not query opt-out preferences');
    },
  });

  let sentEmail = null;
  mockModule('../email-templates', {
    sendEmail: async (...args) => {
      sentEmail = args;
      return true;
    },
  });

  const notificationPrefs = require('../lib/notification-prefs');
  assert.strictEqual(
    await notificationPrefs.shouldSendEmail(123, EMAIL_TYPES.password_reset),
    true,
    'password reset delivery must bypass email_all_off and per-type preferences'
  );

  const sent = await notificationPrefs.sendEmailToUser(
    123,
    'student@example.test',
    EMAIL_TYPES.password_reset,
    'Reset password',
    '<html><body><p>Reset</p><!-- Footer --></body></html>',
    'Reset',
    undefined,
    {}
  );
  assert.strictEqual(sent, true);
  assert.ok(sentEmail, 'password reset should still be delivered');
  assert.strictEqual(sentEmail[2].includes('Unsubscribe'), false, 'required emails must not include unsubscribe footers');
  assert.strictEqual(sentEmail[3].includes('Unsubscribe'), false, 'required email text must not include unsubscribe footers');

  const tokenLib = require('../lib/unsubscribe-token');
  const bookingUrl = new URL(tokenLib.buildUnsubscribeUrl(123, EMAIL_TYPES.booking_confirmation));
  const bookingToken = bookingUrl.searchParams.get('token');
  assert.deepStrictEqual(tokenLib.verifyUnsubscribeToken(bookingToken), {
    userId: 123,
    type: EMAIL_TYPES.booking_confirmation,
  });
  assert.deepStrictEqual(tokenLib.verifyUnsubscribeToken(tokenLib.signUnsubscribeToken(123)), {
    userId: 123,
    type: null,
  });

  delete require.cache[dbPrefsPath];
  mockModule('../db/notification-prefs', {
    ensureDefaultPrefs: async () => {
      throw new Error('required and tampered unsubscribe links must be rejected before DB writes');
    },
    updatePrefs: async () => {
      throw new Error('required and tampered unsubscribe links must not update preferences');
    },
  });
  delete require.cache[require.resolve('../routes/email-unsubscribe')];
  const unsubscribeRouter = require('../routes/email-unsubscribe');
  const unsubscribeHandler = unsubscribeRouter.stack
    .find((layer) => layer.route && layer.route.path === '/unsubscribe')
    .route.stack[0].handle;

  async function requestUnsubscribe(query) {
    const res = {
      statusCode: 200,
      body: '',
      status(code) {
        this.statusCode = code;
        return this;
      },
      send(body) {
        this.body = body;
        return this;
      },
    };
    await unsubscribeHandler({ query }, res);
    return res;
  }

  const passwordResetToken = tokenLib.signUnsubscribeToken(123, EMAIL_TYPES.password_reset);
  const requiredRes = await requestUnsubscribe({
    token: passwordResetToken,
    type: EMAIL_TYPES.password_reset,
  });
  assert.strictEqual(requiredRes.statusCode, 400);
  assert.match(requiredRes.body, /Password reset emails are required/);

  const tamperedRes = await requestUnsubscribe({
    token: bookingToken,
    type: EMAIL_TYPES.maintenance_alert,
  });
  assert.strictEqual(tamperedRes.statusCode, 400);
  assert.match(tamperedRes.body, /only valid for its original email type/);

  delete require.cache[dbPrefsPath];
  const realDbPrefs = require('../db/notification-prefs');
  assert.strictEqual(
    realDbPrefs.rowToPrefs({ password_reset: false, email_all_off: true }).password_reset,
    true,
    'stored legacy opt-outs must not surface password reset as disabled'
  );

  console.log('critical bug regressions passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
