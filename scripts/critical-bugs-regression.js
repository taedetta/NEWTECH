'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

async function test(name, fn) {
  try {
    await fn();
    console.log(`  OK ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}`);
    console.error(`     ${err.message}`);
    process.exitCode = 1;
  }
}

async function main() {
  console.log('Critical bug regression tests');

  await test('booking update conflicts run for active reschedules and reactivations', () => {
    const { bookingUpdateNeedsConflictCheck } = require('../lib/booking-update-policy');

    assert.strictEqual(bookingUpdateNeedsConflictCheck({
      existingStatus: 'confirmed',
      requestedStatus: undefined,
      scheduleChanged: true,
    }), true);

    assert.strictEqual(bookingUpdateNeedsConflictCheck({
      existingStatus: 'completed',
      requestedStatus: 'confirmed',
      scheduleChanged: false,
    }), true);

    assert.strictEqual(bookingUpdateNeedsConflictCheck({
      existingStatus: 'completed',
      requestedStatus: undefined,
      scheduleChanged: true,
    }), false);

    assert.strictEqual(bookingUpdateNeedsConflictCheck({
      existingStatus: 'confirmed',
      requestedStatus: undefined,
      scheduleChanged: false,
    }), false);
  });

  await test('unsubscribe tokens bind the requested preference type', () => {
    const { signUnsubscribeToken, verifyUnsubscribeToken } = require('../lib/unsubscribe-token');
    const token = signUnsubscribeToken(123, 'booking_confirmation');

    assert.deepStrictEqual(
      verifyUnsubscribeToken(token, 'booking_confirmation'),
      { userId: 123, type: 'booking_confirmation' }
    );
    assert.strictEqual(verifyUnsubscribeToken(token, 'all'), null);
  });

  await test('GET unsubscribe route does not mutate preferences', () => {
    const src = fs.readFileSync(path.join(root, 'routes/email-unsubscribe.js'), 'utf8');
    const getStart = src.indexOf("router.get('/unsubscribe'");
    const postStart = src.indexOf("router.post('/unsubscribe'");
    assert(getStart !== -1, 'GET unsubscribe route missing');
    assert(postStart !== -1, 'POST unsubscribe route missing');
    const getBlock = src.slice(getStart, postStart);

    assert(!getBlock.includes('updatePrefs('), 'GET unsubscribe must not call updatePrefs');
    assert(getBlock.includes('renderConfirmPage'), 'GET unsubscribe should render a confirmation page');
    assert(getBlock.includes('verifyUnsubscribeToken(token, rawType)'), 'GET unsubscribe should verify type-bound tokens');
  });

  await test('text-only notification footers do not crash', () => {
    const { appendUnsubscribeFooter, EMAIL_TYPES } = require('../lib/notification-prefs');
    const withFooter = appendUnsubscribeFooter(null, 'Endorsement alert body', 42, EMAIL_TYPES.endorsement_expiry);

    assert.strictEqual(withFooter.html, null);
    assert(withFooter.text.includes('Endorsement alert body'));
    assert(withFooter.text.includes('/api/email/unsubscribe'));
    assert(withFooter.text.includes('Manage preferences'));
  });

  await test('password reset emails bypass opt-out preferences', async () => {
    const dbPrefsPath = require.resolve('../db/notification-prefs');
    const notificationPrefsPath = require.resolve('../lib/notification-prefs');
    const dbPrefs = require(dbPrefsPath);
    const originalGetPrefs = dbPrefs.getPrefs;

    dbPrefs.getPrefs = async () => {
      throw new Error('preferences should not be read for password reset');
    };
    delete require.cache[notificationPrefsPath];
    const notificationPrefs = require('../lib/notification-prefs');

    try {
      assert.strictEqual(
        await notificationPrefs.shouldSendEmail(42, notificationPrefs.EMAIL_TYPES.password_reset),
        true
      );
      const catalog = notificationPrefs.getPreferenceCatalog('student', false);
      assert(!catalog.some((category) => category.types.some((type) => type.key === 'password_reset')));
      const noFooter = notificationPrefs.appendUnsubscribeFooter(
        '<p>Reset</p>',
        'Reset',
        42,
        notificationPrefs.EMAIL_TYPES.password_reset
      );
      assert.strictEqual(noFooter.html, '<p>Reset</p>');
      assert.strictEqual(noFooter.text, 'Reset');
    } finally {
      dbPrefs.getPrefs = originalGetPrefs;
      delete require.cache[notificationPrefsPath];
    }
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
