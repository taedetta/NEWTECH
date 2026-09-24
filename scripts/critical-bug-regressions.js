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
const { syncFlightRecord, shiftBookingTimesToFlightDate } = require('../lib/sync-flight-record');
const { shouldRunUpdateConflictCheck } = require('../routes/bookings-routes');
const { instructorHourRatesForUpdate } = require('../routes/instructor-hours');
const { parseStrictNumber, parsePositiveNumber } = require('../lib/strict-number');
const {
  applyAircraftMeterReadings,
  reconcileAircraftMeterForFlightEdit,
  rollbackAircraftMeterForDeletedBooking,
} = require('../lib/aircraft-meter');

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
  const fullLock = "SELECT * FROM bookings WHERE id = $1 AND source = $2 FOR UPDATE";
  assert(routeSrc.includes(fullLock), 'completion must lock and read full booking row');
  assert(!routeSrc.includes("const bResult = await client.query('SELECT * FROM bookings WHERE id = $1'"), 'completion must not use stale pre-lock booking row');
  assert(!routeSrc.includes("SELECT status FROM bookings WHERE id = $1 FOR UPDATE"), 'completion must not use status-only booking lock');
  assert(routeSrc.indexOf(fullLock) < routeSrc.indexOf('completionEndTime(b)'), 'completion end time must use locked booking row');
  assert(routeSrc.indexOf(fullLock) < routeSrc.indexOf('const flight_date = new Date(b.start_time)'), 'flight date must use locked booking row');
  assert(
    routeSrc.includes('SELECT current_hobbs, current_tach, total_hobbs_hours, total_tach_hours FROM aircraft WHERE id = $1 AND source = $2 FOR UPDATE'),
    'completion must lock source-scoped aircraft meter row before validating readings'
  );
}

function testNewCriticalSourceGuards() {
  const aircraftSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'aircraft.js'), 'utf8');
  assert(
    aircraftSrc.includes('SELECT current_hobbs, current_tach, total_hobbs_hours, total_tach_hours FROM aircraft WHERE id = $1 AND source = $2 FOR UPDATE')
      && aircraftSrc.includes('hobbs cannot be less than current aircraft reading')
      && aircraftSrc.includes('tach cannot be less than current aircraft reading')
      && aircraftSrc.includes("router.patch('/:id/hobbs', authenticateToken, requirePermission('can_manage_aircraft')"),
    'manual aircraft meter edits must lock and reject rollbacks'
  );

  const historySrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'booking-history.js'), 'utf8');
  assert(
    historySrc.includes('rollbackAircraftMeterForDeletedBooking(client, b.aircraft_id, bookingId, log)')
      && historySrc.indexOf('rollbackAircraftMeterForDeletedBooking(client, b.aircraft_id, bookingId, log)') < historySrc.indexOf("DELETE FROM aircraft_hours_history WHERE booking_id = $1"),
    'completed booking deletion must reconcile aircraft meters before deleting audit rows'
  );

  const documentsSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'documents.js'), 'utf8');
  assert(
    documentsSrc.includes('async function canManageStudentDocuments')
      && documentsSrc.includes('student_training')
      && documentsSrc.includes('Only assigned instructors or admins can manage student documents')
      && !/perms\.can_manage_instructors/.test(documentsSrc),
    'student document routes must be limited to admins or assigned instructors'
  );

  const analyticsSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin', 'analytics.html'), 'utf8');
  assert(
    analyticsSrc.includes("localStorage.getItem('fs_token')")
      && analyticsSrc.includes("sessionStorage.getItem('fs_token')"),
    'admin analytics page must read the SPA auth token key'
  );

  const appFeaturesSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app-features.js'), 'utf8');
  assert(
    /async function sendLeadFollowUp[\s\S]+catch \(err\)[\s\S]+Failed to send follow-up/.test(appFeaturesSrc)
      && /async function convertLead[\s\S]+catch \(err\)[\s\S]+Failed to convert lead/.test(appFeaturesSrc),
    'lead follow-up and conversion failures must be surfaced'
  );
}

function testRoleScopedReadGuards() {
  const bookingsSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'bookings-routes.js'), 'utf8');
  const bookingHistoryRoute = bookingsSrc.slice(bookingsSrc.indexOf("router.get('/history'"), bookingsSrc.indexOf('// Conflict detection'));
  assert(
    bookingHistoryRoute.includes("!['owner', 'admin', 'instructor', 'student', 'renter'].includes(req.user.role)")
      && bookingHistoryRoute.includes("req.user.role === 'instructor'")
      && bookingHistoryRoute.includes('b.instructor_id = $'),
    'booking history API must reject maintenance and scope instructors to own history'
  );

  const historySrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'booking-history.js'), 'utf8');
  const historyGetRoute = historySrc.slice(historySrc.indexOf("router.get('/',"), historySrc.indexOf("// PATCH /api/booking-history"));
  assert(
    historyGetRoute.includes("!['owner', 'admin', 'instructor', 'student', 'renter'].includes(role)")
      && historyGetRoute.includes("['student', 'renter'].includes(role)")
      && historyGetRoute.includes('gs.student_id = $'),
    'combined booking history must reject maintenance and scope student/renter flight and ground rows'
  );

  const billingSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'billing.js'), 'utf8');
  assert(
    billingSrc.includes("!['owner', 'admin', 'instructor'].includes(req.user.role)"),
    'billing summary must be limited to owner/admin/instructor'
  );

  const instructorHoursSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'instructor-hours.js'), 'utf8');
  assert(
    instructorHoursSrc.includes("!['owner', 'admin', 'instructor'].includes(role)"),
    'instructor hours list must reject student/renter/maintenance roles'
  );

  const groundSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'ground.js'), 'utf8');
  assert(
    groundSrc.includes("!['owner', 'admin', 'instructor', 'student', 'renter'].includes(role)")
      && groundSrc.includes("['student', 'renter'].includes(role)"),
    'ground sessions list must reject maintenance and scope student/renter roles'
  );
}

function testFollowUpAuthorizationAndConsistencyGuards() {
  const atRiskRouteSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'at-risk.js'), 'utf8');
  assert(
    atRiskRouteSrc.includes('getInstructorStudentIds(req.user.id)')
      && atRiskRouteSrc.includes('canInstructorAccessStudent(req.user.id, studentId)')
      && atRiskRouteSrc.includes('Only assigned instructors can log interventions for this student'),
    'at-risk routes must scope instructor list/read/write access to assigned students'
  );

  const atRiskDbSrc = fs.readFileSync(path.join(__dirname, '..', 'db', 'at-risk.js'), 'utf8');
  assert(
    atRiskDbSrc.includes('async function canInstructorAccessStudent')
      && atRiskDbSrc.includes('FROM student_training')
      && atRiskDbSrc.includes("status IN ('confirmed', 'completed')"),
    'at-risk assignment checks must use active training or assigned bookings'
  );

  const groundSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'ground.js'), 'utf8');
  assert(
    groundSrc.includes("!['owner', 'admin', 'instructor'].includes(role)")
      && groundSrc.includes('canInstructorAccessStudent(userId, studentId)')
      && groundSrc.includes('Only assigned instructors can create ground sessions for this student'),
    'ground-session creation must reject non-staff and limit instructors to assigned students'
  );

  const usersSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'users.js'), 'utf8');
  const privilegesRoute = usersSrc.slice(usersSrc.indexOf("router.patch('/:id/privileges'"), usersSrc.indexOf("// PATCH /api/users/:id/role"));
  assert(
    privilegesRoute.includes("const canGrantAdmin = ['owner', 'admin'].includes(requesterRole)")
      && !privilegesRoute.includes('requesterPerms.can_manage_permissions'),
    'delegated permission managers must not be able to grant admin access'
  );

  const instructorHoursSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'instructor-hours.js'), 'utf8');
  const updateRoute = instructorHoursSrc.slice(instructorHoursSrc.indexOf("router.put('/:id'"), instructorHoursSrc.indexOf("router.post('/reaudit'"));
  assert(
    updateRoute.includes("await client.query('BEGIN')")
      && updateRoute.includes('SELECT * FROM instructor_hours WHERE id = $1 FOR UPDATE')
      && updateRoute.indexOf("await client.query('BEGIN')") < updateRoute.indexOf('SELECT * FROM instructor_hours WHERE id = $1 FOR UPDATE'),
    'instructor-hours edit must lock the source row inside a transaction before syncing linked records'
  );

  const cmsSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'cms.js'), 'utf8');
  const saveRoute = cmsSrc.slice(cmsSrc.indexOf("router.put('/site-content'"), cmsSrc.indexOf("router.get('/project-files'"));
  assert(
    saveRoute.includes('Site content keys must be 1-100 characters')
      && saveRoute.includes('let saved = 0')
      && saveRoute.includes('saved += 1')
      && !saveRoute.includes('continue;'),
    'CMS site-content saves must reject invalid keys and report actual saved rows'
  );
}

function testPublicLeadFormsUseCaptcha() {
  const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert(
    indexSrc.includes('<script src="/js/captcha.js"></script>')
      && indexSrc.includes("FSCaptcha.requireToken('journey-captcha')")
      && indexSrc.includes('captchaToken: captchaToken'),
    'homepage journey lead form must send captchaToken when captcha is enabled'
  );

  const pilotSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'become-a-pilot.html'), 'utf8');
  assert(
    pilotSrc.includes('<script src="/js/captcha.js"></script>')
      && pilotSrc.includes('name="phone" placeholder="Phone number" class="journey-input" required')
      && pilotSrc.includes("FSCaptcha.requireToken('journey-captcha')")
      && pilotSrc.includes('captchaToken: captchaToken'),
    'become-a-pilot journey form must require phone and send captchaToken'
  );
}

function testRoleNavigationDoesNotExposeForbiddenPages() {
  const appSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.html'), 'utf8');
  assert(
    appSrc.includes("const allowed = new Set(['fleet', 'maintenance', 'flight-log', 'tracking', 'phone-app', 'schedule'])")
      && !appSrc.includes("const allowed = new Set(['fleet', 'maintenance', 'flight-log', 'tracking', 'phone-app', 'messages', 'schedule'])"),
    'maintenance role must not be shown the unsupported Messages page'
  );
  assert(
    appSrc.includes("navAtRisk.classList.toggle('hidden', !['owner', 'admin', 'instructor'].includes(currentUser.role))")
      && appSrc.includes("navIH.classList.toggle('hidden', !['owner', 'admin', 'instructor'].includes(currentUser.role))")
      && appSrc.includes('const canReviewAtRisk = ['),
    'at-risk and instructor-hours navigation/cards must only appear for roles accepted by the backend'
  );
}

function testBookingUpdateStatusRaceGuards() {
  const bookingsSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'bookings-routes.js'), 'utf8');
  const routeStart = bookingsSrc.indexOf("router.put('/:id'");
  const routeEnd = bookingsSrc.indexOf("router.delete('/:id'", routeStart);
  assert(routeStart >= 0 && routeEnd > routeStart, 'booking update route not found');
  const routeSrc = bookingsSrc.slice(routeStart, routeEnd);
  assert(routeSrc.includes('SELECT * FROM bookings WHERE id = $1 AND source = $2 FOR UPDATE'), 'booking update must lock the source-scoped booking row before validation');
  assert(routeSrc.includes('expected_status'), 'booking update must reject stale edit forms');
  assert(routeSrc.includes('Booking status changes must use the complete or cancel workflow'), 'generic booking update must not rewrite status');
  assert(/WHERE id = \$10 AND status = \$11 AND source = \$12 RETURNING \*/.test(routeSrc), 'booking update must guard UPDATE with locked status and source');

  const appSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.html'), 'utf8');
  assert(appSrc.includes('payload.expected_status = bookingEditStatus'), 'booking edit payload must include expected_status');
}

function testCompletionNoChangeAuthorizationGuard() {
  const completionSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'bookings-completion.js'), 'utf8');
  const routeStart = completionSrc.indexOf("router.patch('/:id/complete'");
  const routeEnd = completionSrc.indexOf("router.get('/:id'", routeStart);
  assert(routeStart >= 0 && routeEnd > routeStart, 'completion route not found');
  const routeSrc = completionSrc.slice(routeStart, routeEnd);
  assert(
    routeSrc.includes('if (!isAdmin)') && routeSrc.includes('Only owners and admins can complete without meter readings'),
    'no_change completion must be limited to owner/admin corrections'
  );
}

async function testSyncFlightRecordStrictNumbers() {
  const makeClient = () => ({
    async query(sql) {
      if (sql.includes('SELECT * FROM bookings WHERE id = $1')) {
        return { rows: [{
          id: 1,
          status: 'completed',
          student_id: 4,
          instructor_id: null,
          aircraft_id: null,
          booking_type: 'student_solo',
          start_time: '2026-08-01T18:30:00.000Z',
          end_time: '2026-08-01T20:00:00.000Z',
          hobbs_start: 10,
          hobbs_end: 11,
          tach_start: null,
          tach_end: null,
        }] };
      }
      if (sql.includes('SELECT * FROM flight_logs WHERE booking_id = $1')) return { rows: [] };
      throw new Error(`Unexpected query before validation: ${sql}`);
    },
  });

  await assert.rejects(
    () => syncFlightRecord(makeClient(), 1, { hobbs_start: '10abc', hobbs_end: '12' }),
    (err) => err.status === 400 && /hobbs_start must be a valid number/.test(err.message)
  );
  await assert.rejects(
    () => syncFlightRecord(makeClient(), 1, { hobbs_start: '12', hobbs_end: '11' }),
    (err) => err.status === 400 && /hobbs_end must be greater/.test(err.message)
  );
  await assert.rejects(
    () => syncFlightRecord(makeClient(), 1, { tach_start: '10' }),
    (err) => err.status === 400 && /tach_start and tach_end are required together/.test(err.message)
  );
}

function testHistoryGroundDeleteRoute() {
  const appSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.html'), 'utf8');
  assert(
    appSrc.includes("confirmDeleteHistoryEntry(${r.id}, '${dateStr}', '${isGround ? 'ground' : 'flight'}')"),
    'history table delete must pass row type'
  );
  assert(appSrc.includes("'/api/booking-history/ground-sessions/' + id"), 'ground history delete must call ground-sessions endpoint');
  assert(appSrc.includes("'/api/booking-history/flights/' + id"), 'flight history delete must still call flights endpoint');
}

async function testHistoryDeleteMeterRollbackHelper() {
  const updates = [];
  const makeClient = (aircraft) => ({
    async query(sql, params) {
      if (sql.includes('FROM aircraft WHERE id = $1 AND source = $2 FOR UPDATE')) {
        return { rows: [aircraft] };
      }
      if (sql.includes('FROM aircraft_hours_history') && sql.includes('ORDER BY created_at DESC')) {
        const field = params[2];
        return {
          rows: [{
            old_value: field === 'hobbs' ? 100 : 50,
            new_value: field === 'hobbs' ? 101 : 51,
          }],
        };
      }
      if (sql.includes('MAX(new_value)')) return { rows: [{ max_value: null }] };
      if (sql.includes('MAX(hobbs_end)') || sql.includes('MAX(tach_end)')) return { rows: [{ max_value: null }] };
      if (sql.startsWith('UPDATE aircraft SET')) {
        updates.push({ sql, params });
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  });

  await rollbackAircraftMeterForDeletedBooking(makeClient({
    current_hobbs: 101,
    current_tach: 51,
    total_hobbs_hours: 101,
    total_tach_hours: 51,
  }), 7, 42, {
    hobbs_start: 100,
    hobbs_end: 101,
    tach_start: 50,
    tach_end: 51,
  });
  assert.deepStrictEqual(updates[0].params, [100, 50, 7, 'production']);

  updates.length = 0;
  await rollbackAircraftMeterForDeletedBooking(makeClient({
    current_hobbs: 110,
    current_tach: 60,
    total_hobbs_hours: 110,
    total_tach_hours: 60,
  }), 7, 42, {
    hobbs_start: 100,
    hobbs_end: 101,
    tach_start: 50,
    tach_end: 51,
  });
  assert.strictEqual(updates.length, 0, 'deleting older history must not roll back later meter readings');
}

async function testApplyMeterReadingsLocksAircraftRow() {
  const queries = [];
  const makeClient = (aircraft) => ({
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes('FROM aircraft WHERE id = $1 AND source = $2 FOR UPDATE')) {
        return { rows: [aircraft] };
      }
      if (sql.startsWith('UPDATE aircraft SET')) return { rows: [] };
      if (sql.startsWith('INSERT INTO aircraft_hours_history')) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  });

  await applyAircraftMeterReadings(makeClient({
    current_hobbs: 120,
    current_tach: 80,
    total_hobbs_hours: 120,
    total_tach_hours: 80,
  }), 7, {
    hobbsEnd: 121,
    tachEnd: 81,
    bookingId: 42,
    source: 'critical_regression',
  });

  assert(
    queries[0]?.sql.includes('FROM aircraft WHERE id = $1 AND source = $2 FOR UPDATE'),
    'applying aircraft meter readings must lock the source-scoped aircraft row before computing next meter values'
  );
}

function testSyncFlightRecordLocksRowsAndReconcilesMeters() {
  const syncSrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'sync-flight-record.js'), 'utf8');
  assert(
    syncSrc.includes('SELECT * FROM bookings WHERE id = $1 AND source = $2 FOR UPDATE'),
    'syncFlightRecord must lock the source-scoped booking row before reading old hour totals'
  );
  assert(
    syncSrc.includes('SELECT * FROM flight_logs WHERE booking_id = $1 FOR UPDATE'),
    'syncFlightRecord must lock flight log row before adjusting cumulative hours'
  );
  assert(
    syncSrc.includes('reconcileAircraftMeterForFlightEdit')
      && syncSrc.indexOf('await reconcileAircraftMeterForFlightEdit') < syncSrc.indexOf('await applyAircraftMeterReadings'),
    'syncFlightRecord must reconcile downward aircraft meter corrections before applying readings'
  );
}

function testBookingMutationAndHourSyncRegressionGuards() {
  const adminSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'admin.js'), 'utf8');
  assert(
    adminSrc.includes("const { getAppEnv, isStaging } = require('../lib/app-env')")
      && adminSrc.includes('DELETE FROM ${table} WHERE source = $1')
      && adminSrc.includes('Unsafe reset aborted')
      && adminSrc.includes('UPDATE users SET total_hobbs_hours = 0, total_tach_hours = 0 WHERE source = $1')
      && adminSrc.includes('UPDATE aircraft SET total_hobbs_hours = 0, total_tach_hours = 0, current_hobbs = 0, current_tach = 0 WHERE source = $1'),
    'reset-all-data must be source-scoped and fail safe for unisolated tables'
  );

  const bookingsSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'bookings-routes.js'), 'utf8');
  assert(
    bookingsSrc.includes("if (['owner', 'admin'].includes(user.role)) return true;")
      && !bookingsSrc.includes("['owner', 'admin', 'maintenance'].includes(user.role)"),
    'maintenance must not be allowed to update or cancel arbitrary bookings'
  );
  assert(
    bookingsSrc.includes('syncCompletedBookingSideEffects(client, updated, effectiveLessonType, b)'),
    'completed booking resync must receive the locked pre-update booking snapshot'
  );

  const syncCompletedSrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'sync-completed-booking.js'), 'utf8');
  assert(
    syncCompletedSrc.includes('previous_student_id: previousBooking?.student_id')
      && syncCompletedSrc.includes('previous_instructor_id: previousBooking?.instructor_id'),
    'completed booking side-effect sync must pass previous participants for hour transfers'
  );

  const syncSrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'sync-flight-record.js'), 'utf8');
  assert(
    syncSrc.includes('const hobbsDelta = !hobbsTouched && oldLog?.hobbs_delta != null')
      && syncSrc.includes('const tachDelta = !tachTouched && oldLog?.tach_delta != null'),
    'metadata-only completed booking sync must preserve existing logged deltas'
  );
  assert(
    !syncSrc.includes("booking.status === 'completed' && !booking.billing_voided"),
    'voided billing rows must still reconcile meters and cumulative hours when edited'
  );

  const completionSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'bookings-completion.js'), 'utf8');
  assert(
    completionSrc.includes('parseFloat((hEnd - hStart).toFixed(2))')
      && completionSrc.includes('parseFloat((tEnd - tStart).toFixed(2))'),
    'booking completion must store stable rounded deltas'
  );
  assert(
    completionSrc.includes('total_hobbs_hours = COALESCE(total_hobbs_hours, 0) + $1')
      && completionSrc.includes('total_tach_hours = COALESCE(total_tach_hours, 0) + $2'),
    'booking completion cumulative-hour increments must tolerate null totals'
  );

  const historySrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'booking-history.js'), 'utf8');
  assert(
    historySrc.includes('(booking_id, aircraft_id, student_id, instructor_id, booking_type,')
      && historySrc.includes('[bkId, acId, sid, iid, bookingType'),
    'manual flight history logs must persist participant and aircraft IDs'
  );
  assert(
    historySrc.includes('total_hobbs_hours = COALESCE(total_hobbs_hours, 0) + $1')
      && historySrc.includes('total_tach_hours = COALESCE(total_tach_hours, 0) + $2'),
    'manual flight history cumulative-hour increments must tolerate null totals'
  );

  const instructorHoursSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'instructor-hours.js'), 'utf8');
  assert(
    instructorHoursSrc.includes('SELECT id FROM instructor_hours WHERE booking_id = $1 LIMIT 1')
      && instructorHoursSrc.includes('Instructor hours already exist for this booking'),
    'manual instructor-hour creates must reject duplicate linked booking rows'
  );
}

async function testMeterDecreaseEditRollsBackCurrentAircraftMeter() {
  const updates = [];
  const inserts = [];
  const makeClient = () => ({
    async query(sql, params) {
      if (sql.includes('FROM aircraft WHERE id = $1 AND source = $2 FOR UPDATE')) {
        return { rows: [{
          current_hobbs: 101,
          current_tach: 51,
          total_hobbs_hours: 101,
          total_tach_hours: 51,
        }] };
      }
      if (sql.includes('MAX(new_value)')) return { rows: [{ max_value: null }] };
      if (sql.includes('MAX(hobbs_end)') || sql.includes('MAX(tach_end)')) return { rows: [{ max_value: null }] };
      if (sql.startsWith('INSERT INTO aircraft_hours_history')) {
        inserts.push({ sql, params });
        return { rows: [] };
      }
      if (sql.startsWith('UPDATE aircraft SET')) {
        updates.push({ sql, params });
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  });

  await reconcileAircraftMeterForFlightEdit(makeClient(), 7, 42, {
    oldHobbsEnd: 101,
    oldTachEnd: 51,
    newHobbsEnd: 100.5,
    newTachEnd: 50.5,
    source: 'critical_regression',
  });

  assert.deepStrictEqual(updates[0].params, [100.5, 50.5, 7, 'production']);
  assert.strictEqual(inserts.length, 2, 'meter decrease corrections should be audit logged');
}

function testHistoryDeleteReversesVoidedCompletedHours() {
  const historySrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'booking-history.js'), 'utf8');
  assert(
    !historySrc.includes("b.status === 'completed' && !b.billing_voided"),
    'history delete must reverse cumulative user hours even after billing is voided'
  );
  assert(
    historySrc.includes('total_hobbs_hours = COALESCE(total_hobbs_hours, 0) - $1')
      && historySrc.includes('total_tach_hours = COALESCE(total_tach_hours, 0) - $2'),
    'history delete user-hour reversal must tolerate null cumulative fields'
  );
}

function testSquawkFullEditRoute() {
  const maintenanceSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'maintenance.js'), 'utf8');
  assert(
    maintenanceSrc.includes("router.put('/squawks/:id'"),
    'squawk edit modal must have a backend PUT route'
  );
  assert(
    maintenanceSrc.includes('aircraft_id = $1')
      && maintenanceSrc.includes('severity = $2')
      && maintenanceSrc.includes('status = $3')
      && maintenanceSrc.includes('description = $4')
      && maintenanceSrc.includes('expected_downtime = $5'),
    'squawk full edit route must persist the fields sent by the frontend edit form'
  );
  const appSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.html'), 'utf8');
  assert(
    appSrc.includes("method: 'PUT'")
      && appSrc.includes('expected_downtime')
      && appSrc.includes('resolution_notes'),
    'squawk edit frontend must send the full edit payload'
  );
}

function testSubagentFollowUpGuards() {
  const instructorHoursSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'instructor-hours.js'), 'utf8');
  assert(
    /router\.post\('\/reaudit'[\s\S]+!\['owner', 'admin', 'instructor'\]\.includes\(role\)/.test(instructorHoursSrc)
      && /router\.get\('\/prefill'[\s\S]+!\['owner', 'admin', 'instructor'\]\.includes\(role\)/.test(instructorHoursSrc),
    'instructor-hours reaudit and prefill must be owner/admin/instructor only'
  );

  const trackSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'track-flights.js'), 'utf8');
  assert(
    trackSrc.includes('function flightScopeForUser')
      && trackSrc.includes("['owner', 'admin', 'maintenance'].includes(user.role)")
      && trackSrc.includes('b.instructor_id = $')
      && trackSrc.includes('b.student_id = $')
      && trackSrc.includes('AND b.source = $1'),
    'track-flights live/recent queries must be role- and source-scoped'
  );

  const downtimeSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'downtime.js'), 'utf8');
  assert(
    !downtimeSrc.includes("UPDATE aircraft SET status = 'available'")
      && downtimeSrc.includes('(aircraft_id, start_date, end_date, start_time, end_time, all_day, reason, created_by, source)')
      && downtimeSrc.includes('WHERE d.source = $1'),
    'downtime creation must not clear maintenance status and downtime reads/writes must be source-scoped'
  );

  const discrepanciesSrc = fs.readFileSync(path.join(__dirname, '..', 'db', 'discrepancies.js'), 'utf8');
  assert(
    discrepanciesSrc.includes("const { syncFlightRecord } = require('../lib/sync-flight-record')")
      && discrepanciesSrc.includes('SELECT * FROM flight_discrepancies WHERE id = $1 FOR UPDATE')
      && discrepanciesSrc.includes('await syncFlightRecord(client, discrepancy.booking_id'),
    'discrepancy resolution must sync the selected reading into authoritative flight records in a transaction'
  );

  const historySrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'booking-history.js'), 'utf8');
  assert(
    historySrc.includes("const { syncInstructorHoursFromFlight } = require('../lib/sync-instructor-hours')")
      && historySrc.includes("const { resolveFlightCharges } = require('../lib/flight-charges')")
      && historySrc.includes('await syncInstructorHoursFromFlight(client, {')
      && historySrc.includes('aircraft_charge_amount, instruction_charge_amount, source)'),
    'manual dual-flight history must create charges, instructor hours, and source-tagged flight logs'
  );

  const bookingsSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'bookings-routes.js'), 'utf8');
  assert(
    bookingsSrc.includes("const { getAppEnv } = require('../lib/app-env')")
      && bookingsSrc.includes('booking_type, source)')
      && bookingsSrc.includes('AND b.source = $1')
      && bookingsSrc.includes('AND source = $4'),
    'booking creation, list, and conflict checks must use APP_ENV source isolation'
  );

  const billingSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'billing.js'), 'utf8');
  assert(
    billingSrc.includes('AND b.source = $SOURCE_PLACEHOLDER')
      && billingSrc.includes("BILLABLE_FLIGHT_SQL.replace('$SOURCE_PLACEHOLDER', '$1')")
      && billingSrc.includes("BILLABLE_FLIGHT_SQL.replace('$SOURCE_PLACEHOLDER', '$2')"),
    'billing summaries/details must filter billable flights by current source'
  );
}

async function main() {
  testRequiredEmailPreferences();
  testUnsubscribeTokenScope();
  testBookingDateShift();
  testBookingConflictDecision();
  testInstructorRatePreservation();
  testStrictNumberValidation();
  testRequestNumericInputSourceGuards();
  testFollowUpSecuritySourceGuards();
  testCompletionUsesLockedBookingRow();
  testNewCriticalSourceGuards();
  testRoleScopedReadGuards();
  testFollowUpAuthorizationAndConsistencyGuards();
  testPublicLeadFormsUseCaptcha();
  testRoleNavigationDoesNotExposeForbiddenPages();
  testBookingUpdateStatusRaceGuards();
  testCompletionNoChangeAuthorizationGuard();
  await testSyncFlightRecordStrictNumbers();
  testHistoryGroundDeleteRoute();
  await testHistoryDeleteMeterRollbackHelper();
  await testApplyMeterReadingsLocksAircraftRow();
  testSyncFlightRecordLocksRowsAndReconcilesMeters();
  testBookingMutationAndHourSyncRegressionGuards();
  await testMeterDecreaseEditRollsBackCurrentAircraftMeter();
  testHistoryDeleteReversesVoidedCompletedHours();
  testSquawkFullEditRoute();
  testSubagentFollowUpGuards();
  console.log('critical bug regressions passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
