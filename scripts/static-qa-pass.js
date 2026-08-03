'use strict';

/**
 * Static QA — syntax/load checks without live DB or captcha.
 * Usage: node scripts/static-qa-pass.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const failures = [];

function fail(msg) {
  failures.push(msg);
  console.log('  FAIL', msg);
}

function ok(msg) {
  console.log('  OK', msg);
}

// 1. Syntax-check all route and lib files
console.log('\n=== Syntax check ===');
const dirs = ['routes', 'lib', 'db', 'middleware', 'services'];
const jsFiles = [];
for (const d of dirs) {
  const full = path.join(root, d);
  if (!fs.existsSync(full)) continue;
  for (const f of fs.readdirSync(full)) {
    if (f.endsWith('.js')) jsFiles.push(path.join(full, f));
  }
}
jsFiles.push(path.join(root, 'server.js'));
for (const f of jsFiles) {
  try {
    execSync(`node -c "${f}"`, { stdio: 'pipe' });
  } catch {
    fail(`Syntax error: ${path.relative(root, f)}`);
  }
}
if (failures.length === 0) ok(`${jsFiles.length} JS files parse`);

// 2. instructor-availability DAY_NAMES import
console.log('\n=== Instructor availability ===');
const iaSrc = fs.readFileSync(path.join(root, 'lib/instructor-availability.js'), 'utf8');
if (!iaSrc.includes('DAY_NAMES')) fail('DAY_NAMES missing from instructor-availability.js');
else if (!iaSrc.includes("DAY_NAMES } = require('./instructors')")) fail('DAY_NAMES not imported');
else ok('DAY_NAMES imported');

if (!iaSrc.includes('phone_number') || !iaSrc.includes('email')) {
  fail('contact fields missing from getAllInstructorsDayAvailability query');
} else ok('contact fields in query');

// 3. admin spawn fix
console.log('\n=== Admin routes ===');
const adminSrc = fs.readFileSync(path.join(root, 'routes/admin.js'), 'utf8');
if (adminSrc.includes('child.spawn')) fail('child.spawn still present in admin.js');
else ok('spawn used correctly');

// 4. Critical auth hardening
console.log('\n=== Auth hardening ===');
const authMwSrc = fs.readFileSync(path.join(root, 'middleware/auth.js'), 'utf8');
const authRouteSrc = fs.readFileSync(path.join(root, 'routes/auth.js'), 'utf8');
if (!authMwSrc.includes('FROM users') || !authMwSrc.includes('approval_status') || !authMwSrc.includes('deleted_at')) {
  fail('authenticateToken does not revalidate DB account state');
} else ok('authenticateToken revalidates DB account state');
if (authMwSrc.includes("['owner', 'admin', 'maintenance'].includes(req.user.role)")) {
  fail('maintenance role still bypasses all permission checks');
} else ok('maintenance role scoped in requirePermission');
if (authRouteSrc.includes('UPDATE users SET password_hash = $1, deleted_at = NULL')) {
  fail('password reset still reactivates soft-deleted users');
} else ok('password reset does not reactivate deleted users');
if (authRouteSrc.includes('Reactivated soft-deleted account')) {
  fail('login still reactivates soft-deleted users');
} else ok('login does not reactivate deleted users');

// 5. Page div coverage for nav items in app.html
console.log('\n=== Page div coverage ===');
const appHtml = fs.readFileSync(path.join(root, 'public/app.html'), 'utf8');
const pageIds = [...appHtml.matchAll(/id="page-([a-z0-9-]+)"/g)].map((m) => m[1]);
const navPages = [...appHtml.matchAll(/data-page="([a-z0-9-]+)"/g)].map((m) => m[1]);
const skipPages = new Set(['billing-mgmt', 'history-mgmt', 'menu']);
const missing = [...new Set(navPages)].filter((p) => !skipPages.has(p) && !pageIds.includes(p));
if (missing.length) fail(`Nav pages without page div: ${missing.join(', ')}`);
else ok(`All ${navPages.length} nav data-page values have page divs (except mgmt aliases)`);

// 6. navigate() handlers
console.log('\n=== Navigate handlers ===');
const navHandlers = [...appHtml.matchAll(/else if \(page === '([a-z0-9-]+)'\)/g)].map((m) => m[1]);
const pagesWithoutHandler = pageIds.filter((p) => !navHandlers.includes(p) && p !== 'dashboard');
// dashboard loaded by default; some pages may load on first visit only
const critical = ['instructor-schedules', 'availability', 'schedule', 'billing', 'portal'];
for (const p of critical) {
  if (!navHandlers.includes(p)) fail(`Missing navigate handler for ${p}`);
}
if (!failures.some((f) => f.includes('navigate handler'))) ok('Critical page handlers present');

// 7. MOBILE_PAGE_TITLES
if (!appHtml.includes("'instructor-schedules': 'Instructor Availability'")) {
  fail('MOBILE_PAGE_TITLES missing instructor-schedules');
} else ok('Mobile title for instructor-schedules');

// 8. Critical booking/training/billing route guards
console.log('\n=== Critical route guards ===');
const completionSrc = fs.readFileSync(path.join(root, 'routes/bookings-completion.js'), 'utf8');
const bookingsSrc = fs.readFileSync(path.join(root, 'routes/bookings-routes.js'), 'utf8');
const trainingSrc = fs.readFileSync(path.join(root, 'routes/training.js'), 'utf8');
const aircraftSrc = fs.readFileSync(path.join(root, 'routes/aircraft.js'), 'utf8');
const billingSrc = fs.readFileSync(path.join(root, 'routes/billing.js'), 'utf8');
const flightLogSrc = fs.readFileSync(path.join(root, 'routes/flight-logs.js'), 'utf8');
if (!completionSrc.includes('SELECT * FROM bookings WHERE id = $1 FOR UPDATE')) {
  fail('booking completion does not row-lock booking');
} else ok('booking completion row lock present');
if (!completionSrc.includes('canAccessBooking(req.user, result.rows[0])')) {
  fail('single booking detail lacks participant/staff authorization');
} else ok('single booking detail authorization present');
if (!bookingsSrc.includes('Use the complete or cancel action to change booking status')) {
  fail('generic booking status rewrite still allowed');
} else ok('generic booking status rewrite blocked');
if (!bookingsSrc.includes('SELECT * FROM bookings WHERE id = $1 FOR UPDATE')) {
  fail('booking cancellation does not row-lock booking');
} else ok('booking cancellation row lock present');
if (!trainingSrc.includes("router.post(['/admin/programs', '/programs'], authenticateToken")) {
  fail('training admin program aliases are missing authentication');
} else ok('training admin aliases authenticated');
if (!trainingSrc.includes('canViewStudentTraining(req.user, studentId)')) {
  fail('training student detail routes lack staff/self authorization');
} else ok('training staff/self authorization present');
if (aircraftSrc.includes("requireRole('owner', 'admin', 'maintenance')")) {
  fail('maintenance can still delete aircraft');
} else ok('aircraft delete owner/admin only');
if (!aircraftSrc.includes('parseOptionalNonNegative')) {
  fail('aircraft numeric validation helper missing');
} else ok('aircraft numeric validation present');
if (billingSrc.includes('total_hobbs_hours = total_hobbs_hours -')) {
  fail('billing void still subtracts real user/aircraft hours');
} else ok('billing void is non-destructive');
if (!flightLogSrc.includes('Cannot delete a flight log linked to a completed booking')) {
  fail('completed booking flight-log delete guard missing');
} else ok('completed booking flight-log delete guard present');

console.log('\n=== Summary ===');
if (failures.length === 0) {
  console.log('All static checks passed.');
  process.exit(0);
}
console.log(`${failures.length} failure(s).`);
process.exit(1);
