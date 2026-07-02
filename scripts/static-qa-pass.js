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

// 4. Page div coverage for nav items in app.html
console.log('\n=== Page div coverage ===');
const appHtml = fs.readFileSync(path.join(root, 'public/app.html'), 'utf8');
const pageIds = [...appHtml.matchAll(/id="page-([a-z0-9-]+)"/g)].map((m) => m[1]);
const navPages = [...appHtml.matchAll(/data-page="([a-z0-9-]+)"/g)].map((m) => m[1]);
const skipPages = new Set(['billing-mgmt', 'history-mgmt', 'menu']);
const missing = [...new Set(navPages)].filter((p) => !skipPages.has(p) && !pageIds.includes(p));
if (missing.length) fail(`Nav pages without page div: ${missing.join(', ')}`);
else ok(`All ${navPages.length} nav data-page values have page divs (except mgmt aliases)`);

// 5. navigate() handlers
console.log('\n=== Navigate handlers ===');
const navHandlers = [...appHtml.matchAll(/else if \(page === '([a-z0-9-]+)'\)/g)].map((m) => m[1]);
const pagesWithoutHandler = pageIds.filter((p) => !navHandlers.includes(p) && p !== 'dashboard');
// dashboard loaded by default; some pages may load on first visit only
const critical = ['instructor-schedules', 'availability', 'schedule', 'billing', 'portal'];
for (const p of critical) {
  if (!navHandlers.includes(p)) fail(`Missing navigate handler for ${p}`);
}
if (!failures.some((f) => f.includes('navigate handler'))) ok('Critical page handlers present');

// 6. MOBILE_PAGE_TITLES
if (!appHtml.includes("'instructor-schedules': 'Instructor Availability'")) {
  fail('MOBILE_PAGE_TITLES missing instructor-schedules');
} else ok('Mobile title for instructor-schedules');

// 7. Critical beta hardening guardrails
console.log('\n=== Critical hardening guardrails ===');
const authMwSrc = fs.readFileSync(path.join(root, 'middleware/auth.js'), 'utf8');
if (!authMwSrc.includes('approval_status !== \'approved\'') || !authMwSrc.includes('deleted_at')) {
  fail('authenticateToken does not reject inactive/unapproved accounts');
} else ok('auth middleware revalidates active approved users');

const authRouteSrc = fs.readFileSync(path.join(root, 'routes/auth.js'), 'utf8');
if (authRouteSrc.includes('Reactivate soft-deleted account') || authRouteSrc.includes('password_hash = $1, deleted_at = NULL')) {
  fail('login/reset routes still reactivate deleted accounts');
} else ok('auth routes do not reactivate deleted accounts');

const trainingSrc = fs.readFileSync(path.join(root, 'routes/training.js'), 'utf8');
const serverSrc = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
if (!trainingSrc.includes("router.use('/admin', authenticateToken, requireRole('owner', 'admin'))")) {
  fail('training admin routes missing authenticateToken guard');
} else ok('training admin routes require authenticated owner/admin');
if (!serverSrc.includes("req.url = `/admin${req.url}`")) {
  fail('admin training mount does not route /api/admin/training/* into admin handlers');
} else ok('admin training mount reaches admin handlers');

const bookingCompletionSrc = fs.readFileSync(path.join(root, 'routes/bookings-completion.js'), 'utf8');
if (!bookingCompletionSrc.includes('FOR UPDATE') || !bookingCompletionSrc.includes('MAX_COMPLETION_METER_DELTA')) {
  fail('booking completion lacks row locking or meter delta cap');
} else ok('booking completion locks rows and caps meter jumps');
if (!bookingCompletionSrc.includes('canAccessBooking(req.user')) {
  fail('single booking fetch missing participant/staff authorization');
} else ok('single booking fetch is authorized');

const bookingRoutesSrc = fs.readFileSync(path.join(root, 'routes/bookings-routes.js'), 'utf8');
if (!bookingRoutesSrc.includes('completed bookings cannot be reverted')) {
  fail('booking editor can still revert completed status');
} else ok('booking editor blocks completed status rewrites');

if (!appHtml.includes('function openEditStudentHoursModal') || !appHtml.includes('function confirmResetStudentHours')) {
  fail('Progress Edit/Reset hours handlers missing');
} else ok('Progress hours handlers present');

console.log('\n=== Summary ===');
if (failures.length === 0) {
  console.log('All static checks passed.');
  process.exit(0);
}
console.log(`${failures.length} failure(s).`);
process.exit(1);
