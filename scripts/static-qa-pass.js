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

// 4. Critical auth/permission guardrails
console.log('\n=== Auth and permissions ===');
const authMwSrc = fs.readFileSync(path.join(root, 'middleware/auth.js'), 'utf8');
const authRouteSrc = fs.readFileSync(path.join(root, 'routes/auth.js'), 'utf8');
const approvalsSrc = fs.readFileSync(path.join(root, 'routes/approvals.js'), 'utf8');
if (!/approval_status\s*!==\s*'approved'/.test(authMwSrc) || !/deleted_at/.test(authMwSrc)) {
  fail('authenticateToken does not revalidate active approved DB user state');
} else ok('authenticateToken revalidates active approved users');
if (/Reactivated soft-deleted account|deleted_at\s*=\s*NULL/.test(authRouteSrc.slice(authRouteSrc.indexOf("router.post('/login'"), authRouteSrc.indexOf("router.post('/logout'")))) {
  fail('login can reactivate soft-deleted users');
} else ok('login does not reactivate soft-deleted users');
if (!/approval_status\s*!==\s*'approved'/.test(authRouteSrc)) {
  fail('login does not block non-approved users');
} else ok('login blocks non-approved users');
if (!/permKey\s*===\s*'can_manage_aircraft'/.test(authMwSrc)) {
  fail('maintenance role is not limited to aircraft permission');
} else ok('maintenance permission is aircraft-only');
if (/requireRole\('owner', 'admin', 'instructor'\)/.test(approvalsSrc)) {
  fail('approval routes still allow instructors');
} else ok('approval routes owner/admin only');

// 5. Critical route guardrails
console.log('\n=== Critical route guardrails ===');
const trainingSrc = fs.readFileSync(path.join(root, 'routes/training.js'), 'utf8');
const bookingsSrc = fs.readFileSync(path.join(root, 'routes/bookings-routes.js'), 'utf8');
const completionSrc = fs.readFileSync(path.join(root, 'routes/bookings-completion.js'), 'utf8');
const flightLogsSrc = fs.readFileSync(path.join(root, 'routes/flight-logs.js'), 'utf8');
if (/router\.(post|put|delete)\('\/admin\/.*requireRole/.test(trainingSrc)) {
  fail('training admin mutation route missing authenticateToken/alias refactor');
} else ok('training admin mutations use authenticated aliases');
if (!trainingSrc.includes("router.post(['/admin/programs', '/programs']")) {
  fail('training admin program alias for /api/admin/training/programs missing');
} else ok('training admin aliases match frontend URLs');
if (!/forceBooking\s*=\s*isAdmin/.test(bookingsSrc) || !/Only owners and admins can force bookings/.test(bookingsSrc)) {
  fail('booking force_booking is not owner/admin gated');
} else ok('booking force_booking owner/admin gated');
if (!/SELECT \* FROM bookings WHERE id = \$1 FOR UPDATE/.test(completionSrc)) {
  fail('booking completion does not lock booking row');
} else ok('booking completion locks booking row');
if (!/Flights cannot be completed before their scheduled start time/.test(completionSrc)) {
  fail('booking completion does not reject future flights');
} else ok('booking completion rejects future flights');
if (!/Linked flight logs must be voided or edited through booking history/.test(flightLogsSrc)) {
  fail('linked flight logs can still be directly deleted');
} else ok('linked flight log delete blocked');

// 6. Page div coverage for nav items in app.html
console.log('\n=== Page div coverage ===');
const appHtml = fs.readFileSync(path.join(root, 'public/app.html'), 'utf8');
const pageIds = [...appHtml.matchAll(/id="page-([a-z0-9-]+)"/g)].map((m) => m[1]);
const navPages = [...appHtml.matchAll(/data-page="([a-z0-9-]+)"/g)].map((m) => m[1]);
const skipPages = new Set(['billing-mgmt', 'history-mgmt', 'menu']);
const missing = [...new Set(navPages)].filter((p) => !skipPages.has(p) && !pageIds.includes(p));
if (missing.length) fail(`Nav pages without page div: ${missing.join(', ')}`);
else ok(`All ${navPages.length} nav data-page values have page divs (except mgmt aliases)`);

// 7. navigate() handlers
console.log('\n=== Navigate handlers ===');
const navHandlers = [...appHtml.matchAll(/else if \(page === '([a-z0-9-]+)'\)/g)].map((m) => m[1]);
const pagesWithoutHandler = pageIds.filter((p) => !navHandlers.includes(p) && p !== 'dashboard');
// dashboard loaded by default; some pages may load on first visit only
const critical = ['instructor-schedules', 'availability', 'schedule', 'billing', 'portal'];
for (const p of critical) {
  if (!navHandlers.includes(p)) fail(`Missing navigate handler for ${p}`);
}
if (!failures.some((f) => f.includes('navigate handler'))) ok('Critical page handlers present');

// 8. Frontend critical workflow guardrails
if (!appHtml.includes("'instructor-schedules': 'Instructor Availability'")) {
  fail('MOBILE_PAGE_TITLES missing instructor-schedules');
} else ok('Mobile title for instructor-schedules');
if (/class=&quot;|id=&quot;|onclick=&quot;|style=&quot;/.test(appHtml)) {
  fail('Escaped HTML attributes remain in app.html');
} else ok('No escaped HTML attributes in app.html markup');
if (!/completableBookings\.find/.test(appHtml)) {
  fail('findCachedBooking does not search completableBookings');
} else ok('findCachedBooking searches completableBookings');
if (!/Flights cannot be completed before their scheduled start time/.test(appHtml)) {
  fail('frontend can still open completion for future bookings');
} else ok('frontend blocks future booking completion');

console.log('\n=== Summary ===');
if (failures.length === 0) {
  console.log('All static checks passed.');
  process.exit(0);
}
console.log(`${failures.length} failure(s).`);
process.exit(1);
