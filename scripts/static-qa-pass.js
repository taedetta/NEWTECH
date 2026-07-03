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

// 7. Critical regression checks from beta testing
console.log('\n=== Critical regression checks ===');
const authSrc = fs.readFileSync(path.join(root, 'middleware', 'auth.js'), 'utf8');
if (!authSrc.includes('deleted_at IS NULL') || !authSrc.includes("COALESCE(approval_status, 'approved') = 'approved'")) {
  fail('authenticateToken must revalidate active approved users from DB');
} else ok('Auth middleware revalidates active approved users');

if (authSrc.includes("['owner', 'admin', 'maintenance'].includes(req.user.role)")) {
  fail('maintenance must not bypass every permission key');
} else ok('Maintenance permission bypass is scoped');

const approvalsSrc = fs.readFileSync(path.join(root, 'routes', 'approvals.js'), 'utf8');
if (!approvalsSrc.includes("requireRole('owner', 'admin')") || approvalsSrc.includes("requireRole('owner', 'admin', 'instructor')")) {
  fail('Approvals must be owner/admin only');
} else ok('Approvals are owner/admin only');

const trainingSrc = fs.readFileSync(path.join(root, 'routes', 'training.js'), 'utf8');
if (!trainingSrc.includes('function isTrainingStaff') || !trainingSrc.includes("router.post(['/programs', '/admin/programs'], authenticateToken, requireRole('owner', 'admin')")) {
  fail('Training admin/program routes must be authenticated and match /api/admin/training/*');
} else ok('Training admin routes are authenticated and correctly mounted');

const bookingCompletionSrc = fs.readFileSync(path.join(root, 'routes', 'bookings-completion.js'), 'utf8');
if (!bookingCompletionSrc.includes('FOR UPDATE') || !bookingCompletionSrc.includes('maxMeterDelta')) {
  fail('Booking completion must lock rows and cap meter deltas');
} else ok('Booking completion has row locks and meter delta cap');

const billingDeleteMatch = appHtml.match(/async function confirmDeleteBillingFlight[\s\S]*?^}/m);
if (!billingDeleteMatch || billingDeleteMatch[0].includes('/api/booking-history/flights/')) {
  fail('Billing delete action must void billing entry, not hard-delete booking history');
} else ok('Billing delete action uses billing void endpoint');

const imageUploadMatch = appHtml.match(/async function handleEditorImageUpload[\s\S]*?^}/m);
if (!imageUploadMatch || imageUploadMatch[0].includes('/api/site-content/upload-image')) {
  fail('Website editor image upload must not call missing upload-image API');
} else ok('Website editor image upload is locally staged for publish');

if (!appHtml.includes('async function openEditStudentHoursModal') || !appHtml.includes('async function confirmResetStudentHours')) {
  fail('Progress student hours Edit/Reset handlers missing');
} else ok('Progress student hours handlers present');

console.log('\n=== Summary ===');
if (failures.length === 0) {
  console.log('All static checks passed.');
  process.exit(0);
}
console.log(`${failures.length} failure(s).`);
process.exit(1);
