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
const { shiftBookingTimesToFlightDate } = require('../lib/sync-flight-record');
const { shouldRunUpdateConflictCheck } = require('../routes/bookings-routes');
const { instructorHourRatesForUpdate } = require('../routes/instructor-hours');
const { parseStrictNumber, parsePositiveNumber } = require('../lib/strict-number');

function testRequiredEmailPreferences() {
  assert.strictEqual(isRequiredEmailType(EMAIL_TYPES.password_reset), true);
  assert.strictEqual(WRITABLE_PREF_COLUMNS.includes(EMAIL_TYPES.password_reset), false);
  assert.strictEqual(rowToPrefs({ password_reset: false }).password_reset, true);

  const catalogTypes = getPreferenceCatalog('student', false).flatMap((category) => category.types.map((type) => type.key));
  assert.strictEqual(catalogTypes.includes(EMAIL_TYPES.password_reset), false);

  const email = appendUnsubscribeFooter('<p>Reset</p>', 'Reset', 42, EMAIL_TYPES.password_reset);
  assert.strictEqual(email.html, '<p>Reset</p>');
  assert.strictEqual(email.text, 'Reset');
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
}

function testBookingDateShift() {
  const booking = {
    start_time: '2026-08-01T18:30:00.000Z',
    end_time: '2026-08-01T20:00:00.000Z',
  };

  assert.strictEqual(shiftBookingTimesToFlightDate(booking, '2026-08-01'), null);

  const shifted = shiftBookingTimesToFlightDate(booking, '2026-08-03');
  assert.strictEqual(shifted.startTime.toISOString(), '2026-08-03T18:30:00.000Z');
  assert.strictEqual(shifted.endTime.toISOString(), '2026-08-03T20:00:00.000Z');
}

function testBookingConflictDecision() {
  assert.strictEqual(shouldRunUpdateConflictCheck({
    scheduleChanged: false,
    statusChanged: true,
    nextStatus: 'confirmed',
  }), true);
  assert.strictEqual(shouldRunUpdateConflictCheck({
    scheduleChanged: true,
    statusChanged: false,
    nextStatus: 'confirmed',
  }), true);
  assert.strictEqual(shouldRunUpdateConflictCheck({
    scheduleChanged: true,
    statusChanged: false,
    nextStatus: 'completed',
  }), false);
}

function testInstructorRatePreservation() {
  const existing = { aircraft_rate: '150.00', instructor_rate: '80.00' };
  assert.deepStrictEqual(instructorHourRatesForUpdate('instructor', existing, {
    aircraft_rate: 1,
    instructor_rate: 1,
  }), {
    aircraftRate: '150.00',
    instructorRate: '80.00',
  });

  assert.deepStrictEqual(instructorHourRatesForUpdate('admin', existing, {
    aircraft_rate: '175.50',
    instructor_rate: '90.25',
  }), {
    aircraftRate: 175.5,
    instructorRate: 90.25,
  });

  assert.deepStrictEqual(instructorHourRatesForUpdate('owner', existing, {}), {
    aircraftRate: '150.00',
    instructorRate: '80.00',
  });
  assert.match(
    instructorHourRatesForUpdate('admin', existing, { instructor_rate: '90abc' }).error,
    /valid number/
  );
}

function testStrictNumberValidation() {
  assert.strictEqual(parseStrictNumber('75.25', 'rate').value, 75.25);
  assert.strictEqual(parseStrictNumber('.5', 'hours').value, 0.5);
  assert.match(parseStrictNumber('75abc', 'rate').error, /valid number/);
  assert.match(parseStrictNumber('NaN', 'rate').error, /valid number/);
  assert.match(parseStrictNumber('-1', 'rate').error, /valid number|negative/);
  assert.match(parseStrictNumber('100000', 'rate').error, /exceeds maximum/);
  assert.strictEqual(parseStrictNumber('', 'optional', { required: false, allowEmpty: true }).value, null);
  assert.match(parsePositiveNumber('0', 'ground_hours').error, /greater than 0/);
}

function testRequestNumericInputSourceGuards() {
  const usersSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'users.js'), 'utf8');
  assert(!/parseFloat\(instructor_rate\)/.test(usersSrc), 'People instructor_rate updates must reject partial numbers');

  const groundSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'ground.js'), 'utf8');
  assert(!/parseFloat\(ground_hours\)/.test(groundSrc), 'Ground sessions must reject partial ground_hours');

  const instructorHoursSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'instructor-hours.js'), 'utf8');
  assert(
    !/parseFloat\((instruction_hours|aircraft_hours|aircraft_rate|instructor_rate|hobbs_start|hobbs_end)\)/.test(instructorHoursSrc),
    'Instructor-hours request numeric fields must reject partial numbers'
  );

  const completionSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'bookings-completion.js'), 'utf8');
  assert(
    !/parseFloat\((hobbs_start|hobbs_end|tach_start|tach_end|dual_instruction_hours)\)/.test(completionSrc),
    'Booking completion hour fields must reject partial numbers'
  );

  const historySrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'booking-history.js'), 'utf8');
  assert(
    !/parseFloat\((hobbs_start|hobbs_end|tach_start|tach_end|dual_instruction_hours|ground_hours|aircraft_charge_amount|instruction_charge_amount)\)/.test(historySrc),
    'Manual history request numeric fields must reject partial numbers'
  );
}

function testFollowUpSecuritySourceGuards() {
  const adminSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'admin.js'), 'utf8');
  assert(adminSrc.includes('isStaging()'), 'reset-all-data must be disabled on staging');

  const permissionsSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'permissions.js'), 'utf8');
  assert(permissionsSrc.includes('targetId === req.user.id'), 'delegated permission managers must not self-modify');
  assert(permissionsSrc.includes('Only owners and admins can grant website editor access'), 'website editor grants must require owner/admin');

  const usersSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'users.js'), 'utf8');
  assert(usersSrc.includes('canViewFullRoster'), 'plain instructors must not receive full roster PII');

  const bookingsSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'bookings-routes.js'), 'utf8');
  const activeBookingsRoute = bookingsSrc.slice(bookingsSrc.indexOf("router.get('/',"), bookingsSrc.indexOf("router.get('/history'"));
  assert(!/email as (student_email|instructor_email)/.test(activeBookingsRoute), 'active booking calendar must not expose participant emails');

  const trainingSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'training.js'), 'utf8');
  assert(!/function isTrainingStaff\(user\) \{[\s\S]*user\.is_instructor/.test(trainingSrc), 'is_instructor flag must not grant training staff access');
  assert(/router\.post\('\/enroll'[\s\S]+canWriteStudentTraining\(req\.user, studentId\)/.test(trainingSrc), 'training enrollment must be scoped');

  const endorsementsSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'endorsements.js'), 'utf8');
  assert(endorsementsSrc.includes('canCreateEndorsementForStudent'), 'endorsement creation must be scoped');
}

function testCompletionUsesLockedBookingRow() {
  const completionSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'bookings-completion.js'), 'utf8');
  const routeStart = completionSrc.indexOf("router.patch('/:id/complete'");
  const routeEnd = completionSrc.indexOf("router.get('/:id'", routeStart);
  assert(routeStart >= 0 && routeEnd > routeStart, 'completion route not found');

  const routeSrc = completionSrc.slice(routeStart, routeEnd);
  const fullLock = "SELECT * FROM bookings WHERE id = $1 FOR UPDATE";
  assert(routeSrc.includes(fullLock), 'completion must lock and read full booking row');
  assert(!routeSrc.includes("const bResult = await client.query('SELECT * FROM bookings WHERE id = $1'"), 'completion must not use stale pre-lock booking row');
  assert(!routeSrc.includes("SELECT status FROM bookings WHERE id = $1 FOR UPDATE"), 'completion must not use status-only booking lock');
  assert(routeSrc.indexOf(fullLock) < routeSrc.indexOf('completionEndTime(b)'), 'completion end time must use locked booking row');
  assert(routeSrc.indexOf(fullLock) < routeSrc.indexOf('const flight_date = new Date(b.start_time)'), 'flight date must use locked booking row');
  assert(
    routeSrc.includes('SELECT current_hobbs, current_tach, total_hobbs_hours, total_tach_hours FROM aircraft WHERE id = $1 FOR UPDATE'),
    'completion must lock aircraft meter row before validating readings'
  );
}

testRequiredEmailPreferences();
testUnsubscribeTokenScope();
testBookingDateShift();
testBookingConflictDecision();
testInstructorRatePreservation();
testStrictNumberValidation();
testRequestNumericInputSourceGuards();
testFollowUpSecuritySourceGuards();
testCompletionUsesLockedBookingRow();

console.log('critical bug regressions passed');
