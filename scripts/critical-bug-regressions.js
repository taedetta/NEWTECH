'use strict';

const assert = require('assert');
const Module = require('module');

const fakeDb = {
  queries: [],
  async query(sql, params = []) {
    this.queries.push({ sql, params });
    if (/SELECT \* FROM user_email_preferences WHERE user_id = \$1/.test(sql)) {
      return {
        rows: [{
          user_id: params[0],
          email_all_off: false,
          booking_confirmation: false,
          password_reset: false,
        }],
      };
    }
    return { rows: [] };
  },
};

let prefsLookupCount = 0;
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (parent?.filename.endsWith('/lib/unsubscribe-token.js') && request === 'jsonwebtoken') {
    return {
      sign: (payload) => Buffer.from(JSON.stringify(payload)).toString('base64url'),
      verify: (token) => JSON.parse(Buffer.from(token, 'base64url').toString('utf8')),
    };
  }
  if (parent?.filename.endsWith('/lib/notification-prefs.js') && request === '../db/notification-prefs') {
    return {
      getPrefs: async () => {
        prefsLookupCount += 1;
        return { email_all_off: true, booking_confirmation: true, password_reset: false };
      },
    };
  }
  if (parent?.filename.endsWith('/lib/notification-prefs.js') && request === '../email-templates') {
    return {
      sendEmail: async () => true,
    };
  }
  if (parent?.filename.endsWith('/lib/notification-prefs.js') && request === './unsubscribe-token') {
    return {
      buildUnsubscribeUrl: (userId, type) => `https://example.test/unsubscribe/${userId}/${type}`,
      buildManagePrefsUrl: () => 'https://example.test/app#account-settings',
      typeLabel: (type) => ({
        endorsement_expiry: 'Endorsement expiry alerts',
        booking_confirmation: 'Booking confirmations',
      }[type] || type),
    };
  }
  if (parent?.filename.endsWith('/db/notification-prefs.js') && request === './index') {
    return fakeDb;
  }
  return originalLoad.apply(this, arguments);
};

async function main() {
  const { EMAIL_TYPES, isRequiredEmailType } = require('../lib/email-types');
  const notificationPrefs = require('../lib/notification-prefs');
  const {
    signUnsubscribeToken,
    verifyUnsubscribeToken,
    buildUnsubscribeUrl,
  } = require('../lib/unsubscribe-token');

  assert.strictEqual(isRequiredEmailType(EMAIL_TYPES.password_reset), true);
  const catalogKeys = notificationPrefs.getPreferenceCatalog('student', false)
    .flatMap((category) => category.types.map((type) => type.key));
  assert(!catalogKeys.includes(EMAIL_TYPES.password_reset), 'password reset must not be user-configurable');

  prefsLookupCount = 0;
  assert.strictEqual(
    await notificationPrefs.shouldSendEmail(123, EMAIL_TYPES.password_reset),
    true,
    'password reset must bypass opt-out preferences'
  );
  assert.strictEqual(prefsLookupCount, 0, 'password reset should not consult mutable preferences');

  prefsLookupCount = 0;
  assert.strictEqual(
    await notificationPrefs.shouldSendEmail(123, EMAIL_TYPES.booking_confirmation),
    false,
    'regular email types should still honor all-email opt-out'
  );
  assert.strictEqual(prefsLookupCount, 1, 'regular email types should consult preferences');

  const resetHtml = '<html><body>Reset password</body></html>';
  const resetText = 'Reset password';
  assert.deepStrictEqual(
    notificationPrefs.appendUnsubscribeFooter(resetHtml, resetText, 123, EMAIL_TYPES.password_reset),
    { html: resetHtml, text: resetText },
    'password reset emails must not include unsubscribe footers'
  );

  const textOnly = notificationPrefs.appendUnsubscribeFooter(null, 'Expiry notice', 123, EMAIL_TYPES.endorsement_expiry);
  assert.strictEqual(textOnly.html, null, 'text-only emails should stay text-only');
  assert.match(textOnly.text, /Unsubscribe from Endorsement expiry alerts/, 'text-only emails should get text footer');

  const scopedToken = signUnsubscribeToken(123, EMAIL_TYPES.preflight_reminder);
  assert.deepStrictEqual(
    verifyUnsubscribeToken(scopedToken),
    { userId: 123, type: EMAIL_TYPES.preflight_reminder },
    'unsubscribe token must bind the requested email type'
  );
  assert.throws(
    () => signUnsubscribeToken(123, EMAIL_TYPES.password_reset),
    /Invalid unsubscribe type/,
    'required email types must not get unsubscribe tokens'
  );
  const url = new URL(buildUnsubscribeUrl(123, EMAIL_TYPES.booking_cancelled));
  assert.strictEqual(url.searchParams.get('type'), EMAIL_TYPES.booking_cancelled);
  assert.strictEqual(
    verifyUnsubscribeToken(url.searchParams.get('token')).type,
    EMAIL_TYPES.booking_cancelled,
    'unsubscribe URL token and query type should match'
  );
  const legacyToken = Buffer.from(JSON.stringify({ uid: 123, aud: 'email-unsub' })).toString('base64url');
  assert.strictEqual(verifyUnsubscribeToken(legacyToken), null, 'legacy user-only tokens must be rejected');

  const dbPrefs = require('../db/notification-prefs');
  fakeDb.queries = [];
  await dbPrefs.updatePrefs(123, { password_reset: false, booking_confirmation: false }, fakeDb);
  const update = fakeDb.queries.find((q) => /UPDATE user_email_preferences SET/.test(q.sql));
  assert(update, 'mutable preference update should still run for mutable keys');
  assert(!/password_reset\s*=/.test(update.sql), 'password_reset must not be persisted as mutable');
  assert(/booking_confirmation\s*=/.test(update.sql), 'mutable keys should still be persisted');
  assert.strictEqual(dbPrefs.rowToPrefs({ password_reset: false }).password_reset, true, 'required prefs normalize to true');

  console.log('critical bug regressions passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
