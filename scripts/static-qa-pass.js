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

// 7. QA script safety guardrails
console.log('\n=== QA script safety ===');
const scriptDir = path.join(root, 'scripts');
const scriptFiles = fs.readdirSync(scriptDir)
  .filter((f) => f.endsWith('.js'))
  .map((f) => path.join(scriptDir, f));
for (const f of scriptFiles) {
  const rel = path.relative(root, f);
  const src = fs.readFileSync(f, 'utf8');
  if (/postgresql:\/\/postgres:(?!\$\{)[^@\s]+@/i.test(src)) {
    fail(`${rel} embeds a Postgres password in a connection URL`);
  }
  if (/process\.env\.(ADMIN_PASSWORD|OWNER_PASSWORD|QA_PASSWORD)\s*\|\|/.test(src)) {
    fail(`${rel} falls back to a committed privileged password`);
  }
}

const mutatingQaScripts = [
  ['scripts/full-beta-qa.js', 'requireQaMutationSafety'],
  ['scripts/user-flow-e2e.js', 'requireQaMutationSafety'],
  ['scripts/flow-qa.js', 'requireApiMutationSafety'],
  ['scripts/full-role-qa-loop.js', 'requireApiMutationSafety'],
];
for (const [rel, guard] of mutatingQaScripts) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  if (!src.includes(guard)) fail(`${rel} missing ${guard}`);
  if (src.includes('https://www.newtechaviation.com')) {
    fail(`${rel} defaults mutating QA to production`);
  }
}
if (!failures.some((f) => f.includes('Postgres password') || f.includes('privileged password') || f.includes('mutating QA'))) {
  ok('QA scripts do not embed DB credentials or privileged password fallbacks');
}

console.log('\n=== package.json test scripts ===');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
for (const [name, cmd] of Object.entries(pkg.scripts || {})) {
  if (!name.startsWith('test')) continue;
  for (const match of cmd.matchAll(/node\s+(scripts\/[^\s&|;]+\.js)/g)) {
    const scriptPath = path.join(root, match[1]);
    if (!fs.existsSync(scriptPath)) {
      fail(`package script ${name} references missing ${match[1]}`);
    }
  }
}
if (!failures.some((f) => f.includes('package script'))) {
  ok('All package test script targets exist');
}

console.log('\n=== Auth guardrails ===');
const authSrc = fs.readFileSync(path.join(root, 'middleware', 'auth.js'), 'utf8');
if (!/SELECT[\s\S]*FROM users[\s\S]*WHERE id = \$1/.test(authSrc)
  || !authSrc.includes('deleted_at')
  || !authSrc.includes('approval_status')) {
  fail('authenticateToken does not revalidate user account state from DB');
}
if (/owner', 'admin', 'maintenance'\]\.includes\(req\.user\.role\)/.test(authSrc)) {
  fail('requirePermission grants maintenance every permission');
}
if (!authSrc.includes("permKey === 'can_manage_aircraft'")) {
  fail('requirePermission missing maintenance aircraft-only permission scope');
}

const trainingSrc = fs.readFileSync(path.join(root, 'routes', 'training.js'), 'utf8');
const unauthedTrainingAdminRoutes = trainingSrc.split(/\r?\n/)
  .filter((line) => /router\.(post|put|delete)\('\/admin\//.test(line) && !line.includes('authenticateToken'));
if (unauthedTrainingAdminRoutes.length) {
  fail(`Training admin routes missing authenticateToken: ${unauthedTrainingAdminRoutes.length}`);
}
if (!failures.some((f) => f.includes('authenticateToken') || f.includes('requirePermission') || f.includes('Training admin'))) {
  ok('Auth middleware and training admin routes include critical guards');
}

console.log('\n=== Summary ===');
if (failures.length === 0) {
  console.log('All static checks passed.');
  process.exit(0);
}
console.log(`${failures.length} failure(s).`);
process.exit(1);
