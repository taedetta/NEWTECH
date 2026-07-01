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

// 7. Critical beta regression guards
console.log('\n=== Critical beta guards ===');
const authMiddlewareSrc = fs.readFileSync(path.join(root, 'middleware/auth.js'), 'utf8');
if (!authMiddlewareSrc.includes('FROM users') || !authMiddlewareSrc.includes('approval_status')) {
  fail('authenticateToken does not revalidate JWT users against DB status');
} else ok('JWT users revalidated from DB');
if (!authMiddlewareSrc.includes("req.user.role === 'maintenance'") || !authMiddlewareSrc.includes("permKey === 'can_manage_aircraft'")) {
  fail('maintenance role can bypass non-aircraft permission checks');
} else ok('maintenance role limited to aircraft permission bypass');

const authRoutesSrc = fs.readFileSync(path.join(root, 'routes/auth.js'), 'utf8');
if (authRoutesSrc.includes('deleted_at = NULL, updated_at = NOW() WHERE id = $2')) {
  fail('reset-password still reactivates deleted accounts');
} else ok('password reset does not reactivate deleted accounts');
if (authRoutesSrc.includes('Reactivate soft-deleted account on successful login')) {
  fail('login still reactivates soft-deleted accounts');
} else ok('login does not reactivate deleted/rejected accounts');

const bookingCompletionSrc = fs.readFileSync(path.join(root, 'routes/bookings-completion.js'), 'utf8');
if (!bookingCompletionSrc.includes('FOR UPDATE')) fail('booking completion/end-early missing row locks');
else ok('booking completion/end-early row locks present');
if (!bookingCompletionSrc.includes("WHERE id = $6 AND status = 'confirmed'")) {
  fail('booking completion update is not status-guarded');
} else ok('booking completion update status-guarded');

const bookingsSrc = fs.readFileSync(path.join(root, 'routes/bookings-routes.js'), 'utf8');
if (!bookingsSrc.includes('Only owners and admins can override instructor availability')) {
  fail('force booking override lacks server-side owner/admin guard');
} else ok('force booking override server-guarded');
if (!bookingsSrc.includes('FOR UPDATE') || !bookingsSrc.includes("status != 'completed'")) {
  fail('booking cancellation missing lock/status guard');
} else ok('booking cancellation lock/status guard present');

const aircraftSrc = fs.readFileSync(path.join(root, 'routes/aircraft.js'), 'utf8');
if (!aircraftSrc.includes('parseMeterValue') || aircraftSrc.includes('parseFloat(hobbs)')) {
  fail('manual aircraft meter update lacks strict numeric validation');
} else ok('manual aircraft meter update strictly validates numbers');
if (!aircraftSrc.includes('Status must be "available" or "maintenance"')) {
  fail('aircraft status update lacks validation');
} else ok('aircraft status update validates allowed values');

const maintenanceSrc = fs.readFileSync(path.join(root, 'routes/maintenance.js'), 'utf8');
if (!maintenanceSrc.includes("router.put('/squawks/:id'")) {
  fail('squawk full edit PUT route missing');
} else ok('squawk full edit PUT route present');

const cmsSrc = fs.readFileSync(path.join(root, 'routes/cms.js'), 'utf8');
if (!cmsSrc.includes("router.post('/site-content/upload-image'")) {
  fail('website editor image upload route missing');
} else ok('website editor image upload route present');

if (appHtml.includes('/api/admin/training/programs') || appHtml.includes('/api/admin/training/stages') || appHtml.includes('/api/admin/training/maneuvers')) {
  fail('Programs admin frontend still uses stale admin training paths');
} else ok('Programs admin frontend uses mounted admin training paths');
if (appHtml.includes('function downloadSourceCode()') || appHtml.match(/id=(?:&quot;|")download-source-btn/g)) {
  fail('source download button/function still duplicated');
} else ok('source download buttons/functions are distinct');

console.log('\n=== Summary ===');
if (failures.length === 0) {
  console.log('All static checks passed.');
  process.exit(0);
}
console.log(`${failures.length} failure(s).`);
process.exit(1);
