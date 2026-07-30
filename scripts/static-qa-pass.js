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

// 7. Critical beta hardening regressions
console.log('\n=== Critical beta hardening ===');
const authMwSrc = fs.readFileSync(path.join(root, 'middleware/auth.js'), 'utf8');
const authRouteSrc = fs.readFileSync(path.join(root, 'routes/auth.js'), 'utf8');
const trainingSrc = fs.readFileSync(path.join(root, 'routes/training.js'), 'utf8');
const trainingDbSrc = fs.readFileSync(path.join(root, 'db/training.js'), 'utf8');
const completionSrc = fs.readFileSync(path.join(root, 'routes/bookings-completion.js'), 'utf8');
const bookingsSrc = fs.readFileSync(path.join(root, 'routes/bookings-routes.js'), 'utf8');
const billingSrc = fs.readFileSync(path.join(root, 'routes/billing.js'), 'utf8');
const flightLogsSrc = fs.readFileSync(path.join(root, 'routes/flight-logs.js'), 'utf8');
const historySrc = fs.readFileSync(path.join(root, 'routes/booking-history.js'), 'utf8');
const usersSrc = fs.readFileSync(path.join(root, 'routes/users.js'), 'utf8');

if (!/approval_status\s*!==\s*'approved'/.test(authMwSrc) || !authMwSrc.includes('deleted_at')) {
  fail('authenticateToken must reject deleted/non-approved accounts');
} else ok('DB-backed auth state revalidation present');

const loginSection = authRouteSrc.slice(authRouteSrc.indexOf("router.post('/login'"), authRouteSrc.indexOf("router.post('/logout'"));
const resetSection = authRouteSrc.slice(authRouteSrc.indexOf("router.post('/reset-password'"), authRouteSrc.indexOf("router.get('/me'"));
if (loginSection.includes('deleted_at = NULL') || resetSection.includes('deleted_at = NULL') || !loginSection.includes("approval_status !== 'approved'")) {
  fail('login/reset must not reactivate deleted or rejected accounts');
} else ok('login/reset approved-only guard present');

if (authMwSrc.includes("['owner', 'admin', 'maintenance'].includes(req.user.role)")) {
  fail('maintenance must not bypass all requirePermission checks');
} else ok('maintenance permission bypass blocked');

if (!trainingSrc.includes('function isTrainingStaff') || !trainingSrc.includes('canViewTrainingStudent')) {
  fail('training routes missing staff/self authorization helpers');
} else ok('training staff/self authorization helpers present');

if (/router\.(post|put|delete)\('\/admin\/[^']+', requireRole/.test(trainingSrc)) {
  fail('training admin routes missing authenticateToken before requireRole');
} else ok('training admin routes require authentication');

if (!trainingDbSrc.includes('FOR UPDATE') || !trainingDbSrc.includes('Only the current stage can be signed off')) {
  fail('milestone sign-off must lock enrollment and require current stage');
} else ok('milestone current-stage guard present');

if (!completionSrc.includes('SELECT * FROM bookings WHERE id = $1 FOR UPDATE') || !completionSrc.includes("WHERE id = $6 AND status = 'confirmed'")) {
  fail('booking completion must lock row and update only confirmed bookings');
} else ok('booking completion row-lock/status guard present');

if (!bookingsSrc.includes("Completed bookings cannot be changed back") || !bookingsSrc.includes("WHERE id = $2 AND status = 'confirmed' RETURNING id")) {
  fail('booking update/cancel status guards missing');
} else ok('booking update/cancel status guards present');

if (billingSrc.includes('current_hobbs = current_hobbs -') || !billingSrc.includes('Voiding removes the charge from billing views only')) {
  fail('billing void must not subtract aircraft meters or pilot hours');
} else ok('billing void is non-destructive');

if (!flightLogsSrc.includes('Linked flight logs must be edited') || !historySrc.includes('Completed flight records cannot be deleted')) {
  fail('completed/linked flight delete guards missing');
} else ok('completed/linked flight delete guards present');

if (!usersSrc.includes('parseStrictHours') || !appHtml.includes('function openEditStudentHoursModal') || !appHtml.includes('function confirmResetStudentHours')) {
  fail('student hours edit/reset validation or handlers missing');
} else ok('student hours edit/reset handlers present');

if (!appHtml.includes('function addFreeformItem') || !appHtml.includes('function renderFreeformEditorItems')) {
  fail('website editor freeform handlers missing');
} else ok('website editor freeform handlers present');

console.log('\n=== Summary ===');
if (failures.length === 0) {
  console.log('All static checks passed.');
  process.exit(0);
}
console.log(`${failures.length} failure(s).`);
process.exit(1);
