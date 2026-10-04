'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function installDbPoolStub() {
  const dbIndexPath = require.resolve('../db/index');
  require.cache[dbIndexPath] = {
    id: dbIndexPath,
    filename: dbIndexPath,
    loaded: true,
    exports: {
      query: async () => {
        throw new Error('Unexpected default DB query in critical bug regression test');
      },
      on: () => {},
    },
  };
}

async function testRequiredEmailPreferencesCannotBeDisabled() {
  installDbPoolStub();
  const dbPrefs = require('../db/notification-prefs');

  const prefs = dbPrefs.rowToPrefs({
    email_all_off: true,
    password_reset: false,
    account_invite: false,
    profile_change: false,
    booking_confirmation: false,
  });

  assert.strictEqual(prefs.password_reset, true, 'password reset must read as enabled even if stored false');
  assert.strictEqual(prefs.account_invite, true, 'account invites must read as enabled even if stored false');
  assert.strictEqual(prefs.profile_change, true, 'profile-change security mail must read as enabled even if stored false');
  assert.strictEqual(prefs.booking_confirmation, false, 'optional email preferences should still be honored');

  const queries = [];
  const fakeDb = {
    query: async (sql, vals = []) => {
      queries.push({ sql, vals });
      if (/^SELECT/i.test(sql.trim())) {
        return { rows: [{ user_id: 7, email_all_off: true, password_reset: false, booking_confirmation: false }] };
      }
      return { rows: [] };
    },
  };

  await dbPrefs.updatePrefs(7, {
    email_all_off: true,
    password_reset: false,
    account_invite: false,
    booking_confirmation: false,
  }, fakeDb);

  const update = queries.find((q) => /^UPDATE/i.test(q.sql.trim()));
  assert(update, 'updatePrefs should issue an UPDATE for optional changes');
  assert(!update.sql.includes('password_reset'), 'password_reset must not be writable through preferences');
  assert(!update.sql.includes('account_invite'), 'account_invite must not be writable through preferences');
  assert(update.sql.includes('booking_confirmation'), 'optional preference should remain writable');
}

async function testNotificationFooterAndCatalog() {
  const { getPreferenceCatalog, appendUnsubscribeFooter, shouldSendEmail } = require('../lib/notification-prefs');
  const { EMAIL_TYPES, REQUIRED_EMAIL_TYPES, isRequiredEmailType } = require('../lib/email-types');

  assert(REQUIRED_EMAIL_TYPES.every(isRequiredEmailType), 'required email type list should be exported consistently');

  const catalogTypes = getPreferenceCatalog('student', false).flatMap((cat) => cat.types.map((t) => t.key));
  assert(!catalogTypes.includes(EMAIL_TYPES.password_reset), 'password reset must be hidden from preference catalog');
  assert(!catalogTypes.includes(EMAIL_TYPES.account_invite), 'account invites must be hidden from preference catalog');

  const requiredFooter = appendUnsubscribeFooter('<html></html>', 'Reset your password', 1, EMAIL_TYPES.password_reset);
  assert.strictEqual(requiredFooter.html, '<html></html>', 'required emails must not get unsubscribe HTML');
  assert.strictEqual(requiredFooter.text, 'Reset your password', 'required emails must not get unsubscribe text');

  const optionalTextOnly = appendUnsubscribeFooter(null, 'Your endorsement expires soon', 1, EMAIL_TYPES.endorsement_expiry);
  assert.strictEqual(optionalTextOnly.html, null, 'text-only optional emails should stay text-only');
  assert(optionalTextOnly.text.includes('Unsubscribe from Endorsement expiry alerts'), 'text-only optional emails should receive text footer');

  assert.strictEqual(await shouldSendEmail(1, EMAIL_TYPES.password_reset), true, 'required emails should always send');
}

function testUnsubscribeTokenBinding() {
  const { signUnsubscribeToken, verifyUnsubscribeToken, buildUnsubscribeUrl } = require('../lib/unsubscribe-token');

  const bookingToken = signUnsubscribeToken(42, 'booking_confirmation');
  assert.deepStrictEqual(
    verifyUnsubscribeToken(bookingToken, 'booking_confirmation'),
    { userId: 42, type: 'booking_confirmation' },
    'token should verify for its signed type'
  );
  assert.strictEqual(verifyUnsubscribeToken(bookingToken, 'all'), null, 'token must reject query-string type escalation');

  const url = new URL(buildUnsubscribeUrl(42, 'preflight_reminder'));
  const token = url.searchParams.get('token');
  const type = url.searchParams.get('type');
  assert.strictEqual(type, 'preflight_reminder', 'unsubscribe URL should carry the requested optional type');
  assert.deepStrictEqual(verifyUnsubscribeToken(token, type), { userId: 42, type }, 'URL token should be bound to URL type');
}

async function testUnsubscribeRouteGetDoesNotMutate() {
  const dbPrefsPath = require.resolve('../db/notification-prefs');
  let ensureCalls = 0;
  let updateCalls = 0;
  require.cache[dbPrefsPath] = {
    id: dbPrefsPath,
    filename: dbPrefsPath,
    loaded: true,
    exports: {
      ensureDefaultPrefs: async () => { ensureCalls += 1; },
      updatePrefs: async () => { updateCalls += 1; },
    },
  };
  delete require.cache[require.resolve('../routes/email-unsubscribe')];

  const { signUnsubscribeToken } = require('../lib/unsubscribe-token');
  const router = require('../routes/email-unsubscribe');
  const getHandler = router.stack.find((layer) => layer.route?.path === '/unsubscribe' && layer.route.methods.get).route.stack[0].handle;
  const postHandler = router.stack.find((layer) => layer.route?.path === '/unsubscribe' && layer.route.methods.post).route.stack[0].handle;

  const makeRes = () => ({
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
  });

  const token = signUnsubscribeToken(99, 'booking_confirmation');
  const req = { query: { token, type: 'booking_confirmation' }, body: {} };

  const getRes = makeRes();
  await getHandler(req, getRes);
  assert.strictEqual(getRes.statusCode, 200, 'valid GET should render confirmation');
  assert(getRes.body.includes('Confirm unsubscribe'), 'GET should ask for confirmation');
  assert.strictEqual(ensureCalls, 0, 'GET unsubscribe must not create or mutate preference rows');
  assert.strictEqual(updateCalls, 0, 'GET unsubscribe must not update preferences');

  const badPostRes = makeRes();
  await postHandler({ query: { token, type: 'all' }, body: {} }, badPostRes);
  assert.strictEqual(badPostRes.statusCode, 400, 'POST must reject a token replayed for a different type');
  assert.strictEqual(updateCalls, 0, 'replayed token must not update preferences');

  const postRes = makeRes();
  await postHandler(req, postRes);
  assert.strictEqual(postRes.statusCode, 200, 'valid POST should unsubscribe');
  assert.strictEqual(ensureCalls, 1, 'POST should ensure preferences exist once');
  assert.strictEqual(updateCalls, 1, 'POST should update preferences once');
}

function testCfiProfileRouteOrder() {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const endorsementsMount = server.indexOf("app.use('/api/users/me', endorsementsRoutes)");
  const legacyProfileMount = server.indexOf("app.use('/api/users/me', profileRoutes)");
  assert(endorsementsMount !== -1, 'server should mount endorsements under /api/users/me');
  assert(legacyProfileMount !== -1, 'server should keep the legacy profile alias');
  assert(
    endorsementsMount < legacyProfileMount,
    'endorsements routes must be mounted before the legacy profile alias so /cfi-profile is reachable'
  );
}

(async () => {
  await testRequiredEmailPreferencesCannotBeDisabled();
  await testNotificationFooterAndCatalog();
  testUnsubscribeTokenBinding();
  await testUnsubscribeRouteGetDoesNotMutate();
  testCfiProfileRouteOrder();
  console.log('critical bug regression checks passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
