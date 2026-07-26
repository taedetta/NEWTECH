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

// 3b. critical auth/account-state hardening
console.log('\n=== Auth hardening ===');
const authMiddlewareSrc = fs.readFileSync(path.join(root, 'middleware/auth.js'), 'utf8');
const authRouteSrc = fs.readFileSync(path.join(root, 'routes/auth.js'), 'utf8');
if (!authMiddlewareSrc.includes('approval_status') || !authMiddlewareSrc.includes('deleted_at')) {
  fail('authenticateToken does not revalidate deleted/approval account state');
} else ok('authenticateToken revalidates account state');
if (!authRouteSrc.includes("user.deleted_at || user.approval_status === 'rejected'")) {
  fail('login does not block deleted/rejected accounts');
} else ok('login blocks deleted/rejected accounts');

// 3c. training management authorization
console.log('\n=== Training authorization ===');
const trainingSrc = fs.readFileSync(path.join(root, 'routes/training.js'), 'utf8');
if (!trainingSrc.includes('function requireTrainingStaff')) fail('training staff guard missing');
else ok('training staff guard present');
if (trainingSrc.includes("router.post('/admin/programs', requireRole")) {
  fail('training admin program route lacks authenticateToken');
} else ok('training admin program routes include auth');

// 3d. booking completion data-corruption guards
console.log('\n=== Booking completion hardening ===');
const completionSrc = fs.readFileSync(path.join(root, 'routes/bookings-completion.js'), 'utf8');
if (!completionSrc.includes('FOR UPDATE')) fail('booking completion does not lock booking row');
else ok('booking completion locks booking row');
if (!completionSrc.includes('maxMeterDelta')) fail('booking completion missing meter delta cap');
else ok('booking completion caps meter deltas');

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

// 7. Progress and training-admin UI wiring
console.log('\n=== Critical frontend handlers ===');
if (appHtml.includes('/api/admin/training/')) fail('Programs admin UI still calls stale /api/admin/training paths');
else ok('Programs admin UI uses mounted training admin paths');
if (!appHtml.includes('function openEditStudentHoursModal') || !appHtml.includes('function confirmResetStudentHours')) {
  fail('Progress student hours Edit/Reset handlers missing');
} else ok('Progress student hours handlers present');

console.log('\n=== Summary ===');
if (failures.length === 0) {
  console.log('All static checks passed.');
  process.exit(0);
}
console.log(`${failures.length} failure(s).`);
process.exit(1);
