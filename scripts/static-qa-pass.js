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

// 7. FSP People export workbook should not depend on vulnerable xlsx package
console.log('\n=== FSP people export ===');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (packageJson.dependencies?.xlsx || packageJson.devDependencies?.xlsx) {
  fail('Vulnerable xlsx dependency still declared');
} else {
  ok('xlsx dependency not declared');
}
try {
  execSync(`node - <<'NODE'
(async () => {
  const { buildFspWorkbook, FSP_COLUMNS } = require('./lib/fsp-people-export');
  const workbook = await buildFspWorkbook([
    {
      id: 42,
      name: 'QA Student',
      email: 'qa-student@test.local',
      phone_number: '555-0100',
      role: 'student',
      is_instructor: false,
    },
  ], { location: 'KPSK', defaultLocation: 'KPSK', companyName: 'New Tech Aviation' });
  if (!Buffer.isBuffer(workbook) || workbook.readUInt32LE(0) !== 0x04034b50) throw new Error('not zip');
  if (workbook.length < 1000 || !Array.isArray(FSP_COLUMNS) || FSP_COLUMNS[0] !== 'FSP People guid') throw new Error('unexpected workbook payload');
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
NODE`, { cwd: root, stdio: 'pipe' });
  ok('FSP XLSX workbook generated');
} catch (err) {
  fail(`FSP workbook generation failed: ${err.message}`);
}

// 8. Critical auth/permission guardrails
console.log('\n=== Critical auth guardrails ===');
const authMiddlewareSrc = fs.readFileSync(path.join(root, 'middleware/auth.js'), 'utf8');
if (!/SELECT id, email, name, role, is_instructor, approval_status, deleted_at[\s\S]+FROM users/.test(authMiddlewareSrc)) {
  fail('authenticateToken does not revalidate JWT users from DB');
} else ok('JWT users revalidated from DB');
if (!authMiddlewareSrc.includes("user.approval_status && user.approval_status !== 'approved'")) {
  fail('authenticateToken does not reject non-approved accounts');
} else ok('Non-approved accounts rejected by middleware');
if (/owner', 'admin', 'maintenance'.*return next\(\)/.test(authMiddlewareSrc)) {
  fail('Maintenance role still bypasses all permission checks');
} else ok('Maintenance permission scope is constrained');

const authRoutesSrc = fs.readFileSync(path.join(root, 'routes/auth.js'), 'utf8');
if (/Reactivated soft-deleted|deleted_at = NULL, updated_at = NOW\(\) WHERE id/.test(authRoutesSrc)) {
  fail('Login/reset can reactivate deleted accounts');
} else ok('Login/reset do not reactivate deleted accounts');
if (!authRoutesSrc.includes('isPlatformAdminEmail(req.user.email)')) {
  fail('Owner claim is not limited to platform admin');
} else ok('Owner claim limited to platform admin');

const trainingSrc = fs.readFileSync(path.join(root, 'routes/training.js'), 'utf8');
for (const route of ['programs', 'stages', 'maneuvers']) {
  if (!trainingSrc.includes(`/${route}`)) continue;
}
if (!/router\.post\('\/admin\/programs', authenticateToken, requireRole\('owner', 'admin'\)/.test(trainingSrc)
  || !/router\.put\('\/admin\/stages\/:id', authenticateToken, requireRole\('owner', 'admin'\)/.test(trainingSrc)
  || !/router\.delete\('\/admin\/maneuvers\/:id', authenticateToken, requireRole\('owner', 'admin'\)/.test(trainingSrc)) {
  fail('Training admin routes missing authenticateToken');
} else ok('Training admin routes require authentication');
if (!trainingSrc.includes('canWriteStudentTraining(req.user, studentId)')) {
  fail('Training writes missing assigned-instructor/admin guard');
} else ok('Training writes are scoped');

const bookingsSrc = fs.readFileSync(path.join(root, 'routes/bookings-routes.js'), 'utf8');
if (!bookingsSrc.includes('Only owners and admins can force bookings')) {
  fail('Non-admin force booking bypass still possible');
} else ok('Force booking limited to owners/admins');
if (!bookingsSrc.includes('FOR UPDATE') || !bookingsSrc.includes('Only confirmed bookings can be cancelled')) {
  fail('Booking cancellation missing row-lock/status guard');
} else ok('Booking cancellation row-lock/status guard present');

const completionSrc = fs.readFileSync(path.join(root, 'routes/bookings-completion.js'), 'utf8');
if (!completionSrc.includes('FOR UPDATE') || !completionSrc.includes('canAccessBooking(req.user, result.rows[0])')) {
  fail('Booking completion/detail guards incomplete');
} else ok('Booking completion/detail guards present');

const aircraftSrc = fs.readFileSync(path.join(root, 'routes/aircraft.js'), 'utf8');
if (aircraftSrc.includes("requireRole('owner', 'admin', 'maintenance')")) {
  fail('Maintenance can still delete aircraft');
} else ok('Aircraft delete limited to owners/admins');
if (!aircraftSrc.includes('parseOptionalNumber')) {
  fail('Aircraft numeric fields missing strict validation');
} else ok('Aircraft numeric validation present');

const billingSrc = fs.readFileSync(path.join(root, 'routes/billing.js'), 'utf8');
if (/total_hobbs_hours\s*=\s*total_hobbs_hours\s*-|current_hobbs\s*=\s*current_hobbs\s*-/.test(billingSrc)) {
  fail('Billing void still mutates operational hour totals');
} else ok('Billing void is non-destructive');

console.log('\n=== Summary ===');
if (failures.length === 0) {
  console.log('All static checks passed.');
  process.exit(0);
}
console.log(`${failures.length} failure(s).`);
process.exit(1);
