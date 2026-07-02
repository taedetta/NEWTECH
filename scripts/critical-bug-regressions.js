'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  EMAIL_TYPES,
  appendUnsubscribeFooter,
  getPreferenceCatalog,
  isRequiredEmailType,
  shouldSendEmail,
} = require('../lib/notification-prefs');

async function testRequiredPasswordResetEmail() {
  assert.strictEqual(isRequiredEmailType(EMAIL_TYPES.password_reset), true);

  const catalog = getPreferenceCatalog('student', false);
  const visibleTypes = catalog.flatMap((category) => category.types.map((type) => type.key));
  assert(!visibleTypes.includes(EMAIL_TYPES.password_reset), 'password reset must not be user-toggleable');

  const withFooter = appendUnsubscribeFooter(
    '<html><body>Reset your password</body></html>',
    'Reset your password',
    123,
    EMAIL_TYPES.password_reset
  );
  assert(!withFooter.html.includes('/api/email/unsubscribe'), 'required emails must not include unsubscribe links');
  assert(!withFooter.text.includes('Unsubscribe'), 'required email text must not include unsubscribe links');

  // Required account-security emails bypass preference lookup entirely, including email_all_off.
  const shouldSend = await shouldSendEmail(123, EMAIL_TYPES.password_reset);
  assert.strictEqual(shouldSend, true);
}

function testCfiProfileLegacyRouteOrder() {
  const serverJs = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const endorsementsMount = "app.use('/api/users/me', endorsementsRoutes)";
  const profileMount = "app.use('/api/users/me', profileRoutes)";
  const endorsementsIdx = serverJs.indexOf(endorsementsMount);
  const profileIdx = serverJs.indexOf(profileMount);

  assert(endorsementsIdx >= 0, 'legacy endorsements mount is missing');
  assert(profileIdx >= 0, 'legacy profile mount is missing');
  assert(
    endorsementsIdx < profileIdx,
    'endorsements legacy routes must mount before profileRoutes catch-all 404'
  );
}

(async () => {
  await testRequiredPasswordResetEmail();
  testCfiProfileLegacyRouteOrder();
  console.log('critical bug regressions passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
