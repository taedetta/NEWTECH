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

// 7. Critical beta guardrails
console.log('\n=== Critical beta guardrails ===');
const authMiddlewareSrc = fs.readFileSync(path.join(root, 'middleware/auth.js'), 'utf8');
if (!authMiddlewareSrc.includes('deleted_at IS NULL') || !authMiddlewareSrc.includes('approval_status')) {
  fail('authenticateToken does not revalidate active approved users from DB');
} else ok('Auth middleware revalidates active approved users');
if (authMiddlewareSrc.includes("['owner', 'admin', 'maintenance'].includes(req.user.role)")) {
  fail('Maintenance role still bypasses all permission checks');
} else ok('Maintenance permissions are scoped');

const bookingCompletionSrc = fs.readFileSync(path.join(root, 'routes/bookings-completion.js'), 'utf8');
if (!bookingCompletionSrc.includes('FOR UPDATE') || !bookingCompletionSrc.includes("status = 'confirmed'")) {
  fail('Booking completion/end-early routes missing row-lock/status guards');
} else ok('Booking completion routes include row-lock/status guards');
if (!bookingCompletionSrc.includes('COMPLETION_DURATION_GRACE_HOURS')) {
  fail('Booking completion missing scheduled-duration meter cap');
} else ok('Booking completion caps meter deltas against scheduled duration');

const trainingSrc = fs.readFileSync(path.join(root, 'routes/training.js'), 'utf8');
if (!trainingSrc.includes("router.post(['/admin/programs', '/programs'], authenticateToken")) {
  fail('Training admin program route missing authenticated /api/admin/training alias');
} else ok('Training admin routes include authenticated aliases');
if (!trainingSrc.includes('canViewTrainingStudent') || !trainingSrc.includes('isTrainingStaff')) {
  fail('Training routes missing staff/student access helpers');
} else ok('Training routes include access helpers');

const cmsSrc = fs.readFileSync(path.join(root, 'routes/cms.js'), 'utf8');
if (!cmsSrc.includes("router.post('/site-content/upload-image'")) {
  fail('CMS image upload endpoint missing');
} else ok('CMS image upload endpoint present');

if (!appHtml.includes('const dateStr = SchoolTime.calendarDate(start)') ||
    !appHtml.includes("sessionType === 'ground'") ||
    !appHtml.includes('SchoolTime.calendarDate(new Date())')) {
  fail('Frontend critical date/history fixes missing');
} else ok('Frontend booking/history date guardrails present');

console.log('\n=== Summary ===');
if (failures.length === 0) {
  console.log('All static checks passed.');
  process.exit(0);
}
console.log(`${failures.length} failure(s).`);
process.exit(1);
