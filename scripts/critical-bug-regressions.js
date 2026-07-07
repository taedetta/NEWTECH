'use strict';

const assert = require('assert');

async function testRequiredPasswordResetEmailBypassesPreferences() {
  const prefsModulePath = require.resolve('../lib/notification-prefs');
  const dbPrefsModulePath = require.resolve('../db/notification-prefs');
  const emailTemplatesModulePath = require.resolve('../email-templates');
  const unsubscribeTokenModulePath = require.resolve('../lib/unsubscribe-token');
  delete require.cache[prefsModulePath];
  delete require.cache[dbPrefsModulePath];
  delete require.cache[emailTemplatesModulePath];
  delete require.cache[unsubscribeTokenModulePath];

  require.cache[dbPrefsModulePath] = {
    id: dbPrefsModulePath,
    filename: dbPrefsModulePath,
    loaded: true,
    exports: {
      getPrefs: async () => ({
        email_all_off: true,
        password_reset: false,
        booking_confirmation: true,
      }),
    },
  };
  require.cache[emailTemplatesModulePath] = {
    id: emailTemplatesModulePath,
    filename: emailTemplatesModulePath,
    loaded: true,
    exports: {
      sendEmail: async () => true,
    },
  };
  require.cache[unsubscribeTokenModulePath] = {
    id: unsubscribeTokenModulePath,
    filename: unsubscribeTokenModulePath,
    loaded: true,
    exports: {
      buildUnsubscribeUrl: (_userId, type) => `https://example.test/unsubscribe/${type}`,
      buildManagePrefsUrl: () => 'https://example.test/app#account-settings',
      typeLabel: (type) => type,
    },
  };

  const {
    EMAIL_TYPES,
    appendUnsubscribeFooter,
    getPreferenceCatalog,
    shouldSendEmail,
  } = require('../lib/notification-prefs');

  assert.strictEqual(
    await shouldSendEmail(42, EMAIL_TYPES.password_reset),
    true,
    'password reset email must send even when all optional mail is disabled'
  );
  assert.strictEqual(
    await shouldSendEmail(42, EMAIL_TYPES.booking_confirmation),
    false,
    'optional email should still respect email_all_off'
  );

  const original = { html: '<body>Reset</body>', text: 'Reset' };
  assert.deepStrictEqual(
    appendUnsubscribeFooter(original.html, original.text, 42, EMAIL_TYPES.password_reset),
    original,
    'required password reset emails should not include unsubscribe links'
  );

  const accountTypes = getPreferenceCatalog('student', false)
    .flatMap((category) => category.types.map((type) => type.key));
  assert(
    !accountTypes.includes(EMAIL_TYPES.password_reset),
    'password reset must not be exposed as an editable preference'
  );
}

async function testFlightDateSyncDoesNotRewriteBookingSchedule() {
  const syncFlightRecordModulePath = require.resolve('../lib/sync-flight-record');
  const bookingRulesModulePath = require.resolve('../lib/booking-rules');
  const flightChargesModulePath = require.resolve('../lib/flight-charges');
  const syncInstructorHoursModulePath = require.resolve('../lib/sync-instructor-hours');
  delete require.cache[syncFlightRecordModulePath];
  delete require.cache[bookingRulesModulePath];
  delete require.cache[flightChargesModulePath];
  delete require.cache[syncInstructorHoursModulePath];

  require.cache[bookingRulesModulePath] = {
    id: bookingRulesModulePath,
    filename: bookingRulesModulePath,
    loaded: true,
    exports: {
      inferLessonType: (lessonType, booking) => lessonType || booking?.lesson_type || 'Dual Instruction',
    },
  };
  require.cache[flightChargesModulePath] = {
    id: flightChargesModulePath,
    filename: flightChargesModulePath,
    loaded: true,
    exports: {
      resolveFlightCharges: () => ({
        aircraftChargeAmount: 150,
        instructionChargeAmount: 0,
      }),
    },
  };
  require.cache[syncInstructorHoursModulePath] = {
    id: syncInstructorHoursModulePath,
    filename: syncInstructorHoursModulePath,
    loaded: true,
    exports: {
      syncInstructorHoursFromFlight: async () => null,
    },
  };

  const { syncFlightRecord } = require('../lib/sync-flight-record');

  const booking = {
    id: 123,
    aircraft_id: 9,
    instructor_id: null,
    student_id: 7,
    start_time: '2026-07-01T18:00:00.000Z',
    end_time: '2026-07-01T20:00:00.000Z',
    status: 'cancelled',
    hobbs_start: '10.0',
    hobbs_end: '11.0',
    tach_start: null,
    tach_end: null,
    lesson_type: 'training',
    booking_type: 'student_solo',
    billing_voided: false,
  };
  const oldLog = {
    booking_id: 123,
    flight_date: '2026-07-01',
    hobbs_start: '10.0',
    hobbs_end: '11.0',
    hobbs_delta: '1.0',
    tach_start: null,
    tach_end: null,
    tach_delta: null,
    dual_instruction_hours: '0',
    student_id: 7,
    instructor_id: null,
    aircraft_id: 9,
    booking_type: 'student_solo',
  };

  const queries = [];
  let flightLogSelects = 0;
  const client = {
    async query(sql, values) {
      queries.push({ sql, values });
      const compactSql = sql.replace(/\s+/g, ' ').trim();
      if (compactSql === 'SELECT * FROM bookings WHERE id = $1') {
        return { rows: [booking] };
      }
      if (compactSql === 'SELECT * FROM flight_logs WHERE booking_id = $1') {
        flightLogSelects += 1;
        return {
          rows: [flightLogSelects === 1 ? oldLog : { ...oldLog, flight_date: '2026-07-02' }],
        };
      }
      if (compactSql === 'SELECT hourly_rate FROM aircraft WHERE id = $1') {
        return { rows: [{ hourly_rate: '150' }] };
      }
      if (compactSql.startsWith('UPDATE bookings SET ')) {
        return { rows: [] };
      }
      if (compactSql.startsWith('UPDATE flight_logs SET ')) {
        return { rows: [] };
      }
      throw new Error(`Unexpected query in regression test: ${compactSql}`);
    },
  };

  await syncFlightRecord(client, 123, { flight_date: '2026-07-02' });

  const bookingUpdate = queries.find((query) => query.sql.replace(/\s+/g, ' ').trim().startsWith('UPDATE bookings SET '));
  assert(bookingUpdate, 'expected booking update for existing Hobbs values');
  assert(
    !/\bstart_time\b|\bend_time\b/.test(bookingUpdate.sql),
    'flight_date sync must not rewrite booking start_time/end_time'
  );

  const logUpdate = queries.find((query) => query.sql.replace(/\s+/g, ' ').trim().startsWith('UPDATE flight_logs SET '));
  assert(logUpdate, 'expected flight log update');
  assert.strictEqual(logUpdate.values[0], '2026-07-02', 'flight log date should still be updated');
}

(async () => {
  await testRequiredPasswordResetEmailBypassesPreferences();
  await testFlightDateSyncDoesNotRewriteBookingSchedule();
  console.log('Critical bug regression checks passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
