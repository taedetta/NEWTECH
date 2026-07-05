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

// 7. Critical security/data-integrity guardrails
console.log('\n=== Critical guardrails ===');
const authSrc = fs.readFileSync(path.join(root, 'middleware/auth.js'), 'utf8');
if (!/async function authenticateToken/.test(authSrc) || !authSrc.includes('FROM users') || !authSrc.includes('approval_status')) {
  fail('authenticateToken must re-verify account state from DB');
} else ok('DB-backed token revalidation');
if (authSrc.includes("['owner', 'admin', 'maintenance'].includes(req.user.role)")) {
  fail('maintenance role must not bypass every permission check');
} else ok('maintenance permission is scoped');

const trainingSrc = fs.readFileSync(path.join(root, 'routes/training.js'), 'utf8');
for (const marker of [
  "router.post('/student-progress', authenticateToken, requireTrainingStaff",
  "router.put('/enrollment/:id/stage', authenticateToken, requireTrainingStaff",
  "router.post('/debriefs', authenticateToken, requireTrainingStaff",
  "router.post('/milestones', authenticateToken, requireTrainingStaff",
  "router.get('/students', authenticateToken",
  "canViewStudentTraining(req.user, studentId)",
]) {
  if (!trainingSrc.includes(marker)) fail(`Training guardrail missing: ${marker}`);
}
if (!failures.some((f) => f.includes('Training guardrail'))) ok('training endpoints gated');

const bookingCompletionSrc = fs.readFileSync(path.join(root, 'routes/bookings-completion.js'), 'utf8');
if (!bookingCompletionSrc.includes('FOR UPDATE') || !bookingCompletionSrc.includes("status = 'confirmed'")) {
  fail('booking completion/end-early must re-check confirmed status under write lock/conditional update');
} else ok('booking completion race guard');

const aircraftSrc = fs.readFileSync(path.join(root, 'routes/aircraft.js'), 'utf8');
if (!aircraftSrc.includes("router.delete('/:id', authenticateToken, requireRole('owner', 'admin')")) {
  fail('aircraft delete must be owner/admin only');
} else ok('aircraft delete owner/admin only');
if (!aircraftSrc.includes("router.patch('/:id/hobbs', authenticateToken, requirePermission('can_manage_aircraft')")) {
  fail('aircraft hour updates must require can_manage_aircraft');
} else ok('aircraft hour permission enforced');
if (!aircraftSrc.includes('parseStrictNonNegativeNumber')) {
  fail('aircraft numeric fields must use strict validation');
} else ok('aircraft numeric validation');

console.log('\n=== Summary ===');
if (failures.length === 0) {
  console.log('All static checks passed.');
  process.exit(0);
}
console.log(`${failures.length} failure(s).`);
process.exit(1);
