'use strict';

process.env.APP_URL = process.env.APP_URL || 'https://example.test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'critical-regression-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const dbIndexPath = require.resolve('../db/index');
require.cache[dbIndexPath] = {
  id: dbIndexPath,
  filename: dbIndexPath,
  loaded: true,
  exports: {
    query() {
      throw new Error('Unexpected database query in critical regression tests');
    },
    connect() {
      throw new Error('Unexpected database connection in critical regression tests');
    },
  },
};

const { EMAIL_TYPES, isRequiredEmailType } = require('../lib/email-types');
const { getPreferenceCatalog, appendUnsubscribeFooter } = require('../lib/notification-prefs');
const { signUnsubscribeToken, verifyUnsubscribeToken, buildUnsubscribeUrl } = require('../lib/unsubscribe-token');
const { rowToPrefs, WRITABLE_PREF_COLUMNS } = require('../db/notification-prefs');
const { shouldRunUpdateConflictCheck } = require('../routes/bookings-routes');

function testRequiredEmailPreferences() {
  assert.strictEqual(isRequiredEmailType(EMAIL_TYPES.password_reset), true);
  assert.strictEqual(WRITABLE_PREF_COLUMNS.includes(EMAIL_TYPES.password_reset), false);
  assert.strictEqual(rowToPrefs({ password_reset: false }).password_reset, true);

  const catalogTypes = getPreferenceCatalog('student', false).flatMap((category) => category.types.map((type) => type.key));
  assert.strictEqual(catalogTypes.includes(EMAIL_TYPES.password_reset), false);

  const requiredEmail = appendUnsubscribeFooter('<p>Reset</p>', 'Reset', 42, EMAIL_TYPES.password_reset);
  assert.strictEqual(requiredEmail.html, '<p>Reset</p>');
  assert.strictEqual(requiredEmail.text, 'Reset');
}

function testUnsubscribeTokenScope() {
  const token = signUnsubscribeToken(42, EMAIL_TYPES.preflight_reminder);
  assert.deepStrictEqual(verifyUnsubscribeToken(token), {
    userId: 42,
    type: EMAIL_TYPES.preflight_reminder,
  });

  assert.throws(() => signUnsubscribeToken(42, EMAIL_TYPES.password_reset), /Invalid unsubscribe type/);

  const url = new URL(buildUnsubscribeUrl(42, EMAIL_TYPES.booking_cancelled));
  const verified = verifyUnsubscribeToken(url.searchParams.get('token'));
  assert.strictEqual(url.searchParams.get('type'), EMAIL_TYPES.booking_cancelled);
  assert.strictEqual(verified.type, EMAIL_TYPES.booking_cancelled);

  const routeSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'email-unsubscribe.js'), 'utf8');
  const getRoute = routeSrc.slice(routeSrc.indexOf("router.get('/unsubscribe'"), routeSrc.indexOf("router.post('/unsubscribe'"));
  const postRoute = routeSrc.slice(routeSrc.indexOf("router.post('/unsubscribe'"));
  assert(!getRoute.includes('updatePrefs('), 'GET unsubscribe must not mutate preferences');
  assert(postRoute.includes('updatePrefs('), 'POST unsubscribe should perform preference updates');
  assert(routeSrc.includes('rawType !== verified.type'), 'unsubscribe type must match the signed token');
}

function testTextOnlyOptionalFooter() {
  const email = appendUnsubscribeFooter(null, 'Endorsement expires soon', 42, EMAIL_TYPES.endorsement_expiry);
  assert.strictEqual(email.html, null);
  assert(email.text.includes('Unsubscribe from Endorsement expiry alerts'));
}

function testBookingConflictDecision() {
  assert.strictEqual(shouldRunUpdateConflictCheck({
    scheduleChanged: true,
    statusChanged: false,
    nextStatus: 'confirmed',
  }), true);
  assert.strictEqual(shouldRunUpdateConflictCheck({
    scheduleChanged: false,
    statusChanged: true,
    nextStatus: 'confirmed',
  }), true);
  assert.strictEqual(shouldRunUpdateConflictCheck({
    scheduleChanged: true,
    statusChanged: false,
    nextStatus: 'completed',
  }), false);
}

testRequiredEmailPreferences();
testUnsubscribeTokenScope();
testTextOnlyOptionalFooter();
testBookingConflictDecision();

console.log('critical bug regression checks passed');
