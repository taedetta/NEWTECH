'use strict';

const assert = require('assert');
const dbIndexPath = require.resolve('../db/index');

require.cache[dbIndexPath] = {
  id: dbIndexPath,
  filename: dbIndexPath,
  loaded: true,
  exports: {
    query: async () => {
      throw new Error('unexpected database query in critical-bug regressions');
    },
  },
};

const { EMAIL_TYPES, isMandatoryEmailType } = require('../lib/email-types');
const {
  appendUnsubscribeFooter,
  getPreferenceCatalog,
  shouldSendEmail,
} = require('../lib/notification-prefs');
const { rowToPrefs } = require('../db/notification-prefs');
const { computeFlightCharges, resolveFlightCharges } = require('../lib/flight-charges');

async function run() {
  assert.strictEqual(isMandatoryEmailType(EMAIL_TYPES.password_reset), true);
  assert.strictEqual(isMandatoryEmailType(EMAIL_TYPES.account_approved), true);
  assert.strictEqual(isMandatoryEmailType(EMAIL_TYPES.booking_confirmation), false);

  const catalog = getPreferenceCatalog('student', false);
  const catalogKeys = catalog.flatMap((category) => category.types.map((type) => type.key));
  assert(!catalogKeys.includes(EMAIL_TYPES.password_reset), 'password reset must not be user-toggleable');
  assert(!catalogKeys.includes(EMAIL_TYPES.account_invite), 'account invites must not be user-toggleable');
  assert(catalogKeys.includes(EMAIL_TYPES.booking_confirmation), 'optional booking emails should remain visible');

  const mandatoryFooter = appendUnsubscribeFooter('<html><body>Reset</body></html>', 'Reset', 123, EMAIL_TYPES.password_reset);
  assert(!mandatoryFooter.html.includes('Unsubscribe from this type'), 'mandatory emails must not include unsubscribe links');
  assert(!mandatoryFooter.text.includes('Unsubscribe from'), 'mandatory text emails must not include unsubscribe links');

  const optionalFooter = appendUnsubscribeFooter('<html><body>Booking</body></html>', 'Booking', 123, EMAIL_TYPES.booking_confirmation);
  assert(optionalFooter.html.includes('Unsubscribe from this type'), 'optional emails should still include unsubscribe links');

  const prefs = rowToPrefs({
    email_all_off: true,
    password_reset: false,
    account_approved: false,
    booking_confirmation: false,
  });
  assert.strictEqual(prefs.password_reset, true, 'stored false must not disable password reset');
  assert.strictEqual(prefs.account_approved, true, 'stored false must not disable account approvals');
  assert.strictEqual(prefs.booking_confirmation, false, 'optional stored false should be preserved');

  assert.strictEqual(await shouldSendEmail(123, EMAIL_TYPES.password_reset), true, 'password reset must bypass preferences');

  assert.deepStrictEqual(
    computeFlightCharges({
      lessonType: 'Discovery Flight',
      bookingType: 'dual',
      hobbsDelta: 1.2,
      dualHrs: 0,
      hourlyRate: 200,
      instructorRate: 80,
    }),
    { aircraftChargeAmount: 185, instructionChargeAmount: 0 },
    'discovery flights must stay flat-rate'
  );

  assert.strictEqual(
    computeFlightCharges({
      lessonType: 'Cross Country',
      bookingType: 'dual',
      hobbsDelta: 1.2,
      dualHrs: 0,
      hourlyRate: 200,
      instructorRate: 80,
    }).instructionChargeAmount,
    96,
    'dual flights with omitted dual hours should bill instruction from Hobbs'
  );

  assert.strictEqual(
    computeFlightCharges({
      lessonType: 'Solo',
      bookingType: 'student_solo',
      hobbsDelta: 1.2,
      dualHrs: 0,
      hourlyRate: 200,
      instructorRate: 80,
    }).instructionChargeAmount,
    0,
    'solo flights must not fall back to Hobbs for instruction billing'
  );

  assert.deepStrictEqual(
    resolveFlightCharges({
      lessonType: 'Dual Instruction',
      bookingType: 'dual',
      hobbsDelta: 1,
      dualHrs: 1,
      hourlyRate: 150,
      instructorRate: 75,
      aircraftChargeAmount: 1,
      instructionChargeAmount: 2,
    }),
    { aircraftChargeAmount: 1, instructionChargeAmount: 2 },
    'admin-supplied non-discovery charge overrides should remain supported'
  );
}

run()
  .then(() => {
    console.log('critical bug regressions passed');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
