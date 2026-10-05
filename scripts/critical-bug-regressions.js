'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

const {
  REQUIRED_EMAIL_TYPES,
  TYPE_CATEGORIES,
  isRequiredEmailType,
} = require('../lib/email-types');
const {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} = require('../lib/unsubscribe-token');
const { bookingUpdateNeedsConflictCheck } = require('../lib/booking-status');

async function main() {
  const requiredTypes = [
    'password_reset',
    'account_approved',
    'account_rejected',
    'signup_pending',
    'account_invite',
    'profile_change',
    'welcome',
  ];

  const notificationPrefsSource = fs.readFileSync(path.join(root, 'lib/notification-prefs.js'), 'utf8');

  for (const type of requiredTypes) {
    assert(REQUIRED_EMAIL_TYPES.has(type), `${type} must be required`);
    assert(isRequiredEmailType(type), `${type} must be recognized as required`);
  }

  const visibleTypes = new Set(TYPE_CATEGORIES.flatMap((category) => category.types));
  for (const type of requiredTypes) {
    assert(!visibleTypes.has(type), `${type} must not be exposed in preference categories`);
  }

  assert(
    notificationPrefsSource.includes('if (isRequiredEmailType(emailType)) return { html, text };'),
    'required emails must not get unsubscribe footers'
  );
  assert(
    notificationPrefsSource.includes('if (isRequiredEmailType(type)) return true;'),
    'required emails must bypass preference checks'
  );
  assert(
    notificationPrefsSource.includes('if (!html)'),
    'text-only optional emails must not crash footer insertion'
  );

  const bookingToken = signUnsubscribeToken(12345, 'booking_confirmation');
  assert.deepStrictEqual(verifyUnsubscribeToken(bookingToken, 'all'), null, 'unsubscribe token must be bound to its type');
  assert.strictEqual(verifyUnsubscribeToken(bookingToken, 'booking_confirmation').type, 'booking_confirmation');

  assert.strictEqual(
    bookingUpdateNeedsConflictCheck({ currentStatus: 'confirmed', nextStatus: 'confirmed', scheduleChanged: true }),
    true,
    'active reschedules need conflict checks'
  );
  assert.strictEqual(
    bookingUpdateNeedsConflictCheck({ currentStatus: 'completed', nextStatus: 'confirmed', scheduleChanged: false }),
    true,
    'reactivating completed bookings needs conflict checks'
  );
  assert.strictEqual(
    bookingUpdateNeedsConflictCheck({ currentStatus: 'cancelled', nextStatus: 'cancelled', scheduleChanged: true }),
    false,
    'non-blocking bookings can be edited without schedule conflicts'
  );

  const unsubscribeSource = fs.readFileSync(path.join(root, 'routes/email-unsubscribe.js'), 'utf8');
  const getStart = unsubscribeSource.indexOf("router.get('/unsubscribe'");
  const postStart = unsubscribeSource.indexOf("router.post('/unsubscribe'");
  assert(getStart !== -1 && postStart !== -1 && getStart < postStart, 'unsubscribe route must define GET confirmation before POST mutation');
  const getBlock = unsubscribeSource.slice(getStart, postStart);
  assert(!getBlock.includes('updatePrefs('), 'GET unsubscribe must not mutate preferences');
  assert(unsubscribeSource.slice(postStart).includes('updatePrefs('), 'POST unsubscribe must mutate preferences');

  const bookingsSource = fs.readFileSync(path.join(root, 'routes/bookings-routes.js'), 'utf8');
  assert(bookingsSource.includes('bookingUpdateNeedsConflictCheck'), 'booking update route must use status-aware conflict helper');
  assert(!bookingsSource.includes('skipConflictCheck = isStaffHistoricalEdit'), 'staff edits must not blanket-skip conflict checks');

  const profileSource = fs.readFileSync(path.join(root, 'routes/profile.js'), 'utf8');
  const cfiRouteIndex = profileSource.indexOf("router.get('/cfi-profile'");
  const catchAllIndex = profileSource.indexOf('router.use((req, res)');
  assert(cfiRouteIndex !== -1 && catchAllIndex !== -1 && cfiRouteIndex < catchAllIndex, 'CFI profile route must be before profile catch-all');

  console.log('critical bug regression checks passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
