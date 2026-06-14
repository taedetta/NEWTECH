'use strict';

/**
 * Staging QA pass — API smoke + instructor directory + role page checks.
 * Usage: node scripts/staging-qa-pass.js [--base URL]
 */

const { chromium } = require('playwright');

const BASE = process.argv.includes('--base')
  ? process.argv[process.argv.indexOf('--base') + 1]
  : 'https://flightslate-staging-production.up.railway.app';

const PASSWORD = process.env.TEST_USER_PASSWORD || 'TestPass123!';

const ROLES = [
  {
    name: 'admin',
    email: process.env.ADMIN_EMAIL || 'evaughntaemw@gmail.com',
    password: process.env.ADMIN_PASSWORD || 'Frbaga12$$!!',
    fallbackEmail: 'qa-admin@test.local',
    fallbackPassword: PASSWORD,
    pages: [
      'dashboard', 'schedule', 'history', 'fleet', 'tracking', 'maintenance',
      'people', 'progress', 'at-risk', 'leads', 'billing', 'instructor-hours',
      'flight-log', 'hours-audit', 'website-editor', 'programs', 'endorsements',
      'availability', 'instructor-schedules', 'admin-settings', 'approvals', 'discrepancies',
      'messages', 'phone-app',
    ],
  },
  {
    name: 'instructor',
    email: 'qa-instructor@test.local',
    password: PASSWORD,
    pages: [
      'dashboard', 'schedule', 'history', 'fleet', 'tracking', 'maintenance',
      'people', 'progress', 'at-risk', 'billing', 'instructor-hours', 'flight-log',
      'endorsements', 'availability', 'instructor-schedules', 'approvals', 'messages',
    ],
  },
  {
    name: 'student',
    email: 'qa-student@test.local',
    password: PASSWORD,
    pages: [
      'dashboard', 'schedule', 'history', 'fleet', 'tracking', 'portal', 'progress',
      'billing', 'flight-log', 'endorsements', 'instructor-schedules', 'messages', 'phone-app',
    ],
  },
  {
    name: 'renter',
    email: 'qa-renter@test.local',
    password: PASSWORD,
    pages: [
      'dashboard', 'schedule', 'history', 'fleet', 'tracking', 'flight-log', 'billing',
      'instructor-schedules', 'messages', 'phone-app',
    ],
  },
  {
    name: 'maintenance',
    email: 'qa-maintenance@test.local',
    password: PASSWORD,
    pages: ['fleet', 'maintenance', 'flight-log', 'tracking'],
  },
];

const API_GETS = [
  '/health',
  '/health/deep',
  '/api/aircraft',
  '/api/bookings',
  '/api/users',
  '/api/billing/summary',
  '/api/flight-logs',
  '/api/booking-history',
  '/api/training/programs',
  '/api/endorsements',
  '/api/weather',
  '/api/leads',
  '/api/at-risk',
  '/api/discrepancies',
  '/api/approvals/pending',
  '/api/site-content',
  '/api/bookings/policy',
  '/api/instructor-availability/directory?date=2026-05-25',
  '/api/admin/system-health',
];

const failures = [];

function fail(scope, msg) {
  failures.push({ scope, msg });
  console.log(`  FAIL [${scope}] ${msg}`);
}

async function loginApi(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Login failed ${res.status}`);
  return data.token;
}

async function getToken(roleCfg) {
  const attempts = [{ email: roleCfg.email, password: roleCfg.password }];
  if (roleCfg.fallbackEmail) {
    attempts.push({ email: roleCfg.fallbackEmail, password: roleCfg.fallbackPassword || PASSWORD });
  }
  for (const a of attempts) {
    try {
      return await loginApi(a.email, a.password);
    } catch { /* next */ }
  }
  throw new Error(`Login failed for ${roleCfg.name}`);
}

async function testHealth() {
  console.log('\n=== Health ===');
  for (const p of ['/health', '/health/deep']) {
    try {
      const res = await fetch(`${BASE}${p}`);
      const text = await res.text();
      if (res.status >= 500) fail('health', `${p} → ${res.status}`);
      else console.log(`  OK ${p} (${res.status})`);
    } catch (e) {
      fail('health', `${p}: ${e.message}`);
    }
  }
}

async function testApi(token) {
  console.log('\n=== API smoke ===');
  for (const p of API_GETS) {
    try {
      const res = await fetch(`${BASE}${p}`, {
        headers: p.startsWith('/api/') ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.status >= 500) {
        const body = await res.text();
        fail('api', `${p} → ${res.status}: ${body.slice(0, 160)}`);
      } else if (p.includes('instructor-availability/directory')) {
        const j = await res.json();
        if (!j.instructors || !Array.isArray(j.instructors)) {
          fail('api', 'directory missing instructors array');
        } else {
          console.log(`  OK ${p} (${j.instructors.length} instructors, day=${j.day})`);
        }
      } else {
        console.log(`  OK ${p} (${res.status})`);
      }
    } catch (e) {
      fail('api', `${p}: ${e.message}`);
    }
  }
}

async function testInstructorDirectoryStudent() {
  console.log('\n=== Instructor directory (student) ===');
  try {
    const token = await loginApi('qa-student@test.local', PASSWORD);
    const res = await fetch(`${BASE}/api/instructor-availability/directory?date=2026-05-25`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (res.status !== 200) {
      fail('directory', `status ${res.status}: ${data.error || JSON.stringify(data)}`);
      return;
    }
    if (!data.instructors?.length) {
      console.log('  WARN no instructors returned (empty school?)');
      return;
    }
    const withContact = data.instructors.filter((i) => i.email || i.phone_number);
    console.log(`  OK ${data.instructors.length} instructors, ${withContact.length} with contact info`);
    const sample = data.instructors[0];
    if (!sample.name) fail('directory', 'instructor missing name');
    if (!sample.weekly) fail('directory', 'instructor missing weekly array');
  } catch (e) {
    fail('directory', e.message);
  }
}

async function testPages(roleCfg) {
  console.log(`\n=== Pages: ${roleCfg.name} ===`);
  let token;
  try {
    token = await getToken(roleCfg);
  } catch (e) {
    fail('login', `${roleCfg.name}: ${e.message}`);
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addInitScript((t) => {
    localStorage.setItem('token', t);
  }, token);

  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  try {
    await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);

    for (const pg of roleCfg.pages) {
      try {
        await page.evaluate((p) => {
          if (typeof navigate === 'function') navigate(p);
        }, pg);
        await page.waitForTimeout(1200);
        const visible = await page.evaluate((p) => {
          const el = document.getElementById('page-' + p);
          return el && !el.classList.contains('hidden');
        }, pg);
        if (!visible) {
          fail('page', `${roleCfg.name}/${pg} not visible after navigate`);
          continue;
        }
        const serverErr = await page.evaluate((p) => {
          const el = document.getElementById('page-' + p);
          if (!el) return null;
          const text = el.innerText || '';
          if (/server error/i.test(text) && p === 'instructor-schedules') return text.slice(0, 120);
          return null;
        }, pg);
        if (serverErr) fail('page', `${roleCfg.name}/${pg}: ${serverErr}`);
        else console.log(`  OK ${pg}`);
      } catch (e) {
        fail('page', `${roleCfg.name}/${pg}: ${e.message}`);
      }
    }

    const critical = consoleErrors.filter((e) =>
      !/favicon|Failed to load resource|404.*\.(png|jpg|ico)/i.test(e)
    );
    if (critical.length) {
      fail('console', `${roleCfg.name} JS errors: ${critical.slice(0, 3).join(' | ')}`);
    }
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log('Staging QA —', BASE);
  await testHealth();

  let adminToken;
  try {
    adminToken = await getToken(ROLES[0]);
  } catch (e) {
    fail('login', `admin: ${e.message}`);
  }
  if (adminToken) await testApi(adminToken);
  await testInstructorDirectoryStudent();

  for (const role of ROLES) {
    await testPages(role);
  }

  console.log('\n=== Summary ===');
  if (failures.length === 0) {
    console.log('All checks passed.');
    process.exit(0);
  }
  console.log(`${failures.length} failure(s):`);
  for (const f of failures) console.log(`  - [${f.scope}] ${f.msg}`);
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
