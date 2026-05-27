'use strict';

/**
 * Comprehensive QA runner — API smoke tests + Playwright page navigation per role.
 * Usage: node scripts/comprehensive-qa.js [--base http://localhost:3000]
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.argv.includes('--base')
  ? process.argv[process.argv.indexOf('--base') + 1]
  : 'https://www.newtechaviation.com';

const PASSWORD = process.env.TEST_USER_PASSWORD || 'TestPass123!';

const ROLES = [
  {
    name: 'admin',
    email: 'evaughntaemw@gmail.com',
    password: process.env.ADMIN_PASSWORD || 'NewTech2026!',
    pages: [
      'dashboard', 'schedule', 'history', 'fleet', 'tracking', 'maintenance',
      'people', 'progress', 'at-risk', 'leads', 'billing', 'instructor-hours',
      'flight-log', 'hours-audit', 'website-editor', 'programs', 'endorsements',
      'availability', 'admin-settings', 'approvals', 'discrepancies',
    ],
  },
  {
    name: 'instructor',
    email: 'qa-instructor@test.local',
    password: PASSWORD,
    pages: [
      'dashboard', 'schedule', 'history', 'fleet', 'tracking', 'maintenance',
      'people', 'progress', 'at-risk', 'billing', 'instructor-hours', 'flight-log',
      'endorsements', 'availability', 'approvals',
    ],
  },
  {
    name: 'student',
    email: 'qa-student@test.local',
    password: PASSWORD,
    pages: ['dashboard', 'schedule', 'history', 'fleet', 'tracking', 'portal', 'progress', 'billing', 'flight-log', 'endorsements'],
  },
  {
    name: 'maintenance',
    email: 'qa-maintenance@test.local',
    password: PASSWORD,
    pages: ['fleet', 'maintenance', 'flight-log', 'tracking'],
  },
  {
    name: 'renter',
    email: 'qa-renter@test.local',
    password: PASSWORD,
    pages: ['dashboard', 'schedule', 'history', 'fleet', 'tracking', 'flight-log', 'billing'],
  },
];

const PUBLIC_PAGES = ['/', '/app', '/become-a-pilot', '/mosaic', '/health', '/health/deep'];

const API_GETS = [
  '/api/auth/diagnostic',
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
  '/api/instructor-availability?instructor_id=1',
  '/api/admin/system-health',
];

const failures = [];
const warnings = [];

function fail(scope, msg) {
  failures.push({ scope, msg });
  console.log(`  FAIL [${scope}] ${msg}`);
}

function warn(scope, msg) {
  warnings.push({ scope, msg });
  console.log(`  WARN [${scope}] ${msg}`);
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

async function testPublicPages() {
  console.log('\n=== Public pages ===');
  for (const p of PUBLIC_PAGES) {
    try {
      const res = await fetch(`${BASE}${p}`);
      if (res.status >= 500) fail('public', `${p} returned ${res.status}`);
      else if (p === '/health/deep') {
        const j = await res.json();
        if (j.status !== 'healthy' && !j.ok) fail('public', `/health/deep unhealthy: ${JSON.stringify(j)}`);
        else console.log(`  OK ${p}`);
      } else console.log(`  OK ${p} (${res.status})`);
    } catch (e) {
      fail('public', `${p}: ${e.message}`);
    }
  }
}

async function testApiEndpoints(token) {
  console.log('\n=== API smoke (admin token) ===');
  for (const p of API_GETS) {
    try {
      const res = await fetch(`${BASE}${p}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status >= 500) {
        const body = await res.text();
        fail('api', `${p} → ${res.status}: ${body.slice(0, 120)}`);
      } else if (res.status === 404 && !p.includes('diagnostic')) {
        warn('api', `${p} → 404`);
      } else {
        console.log(`  OK ${p} (${res.status})`);
      }
    } catch (e) {
      fail('api', `${p}: ${e.message}`);
    }
  }
}

async function testRoleBrowser(roleConfig) {
  console.log(`\n=== Browser: ${roleConfig.name} (${roleConfig.email}) ===`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  const jsErrors = [];
  const apiErrors = [];

  page.on('pageerror', (e) => jsErrors.push(e.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('favicon')) {
      jsErrors.push(msg.text());
    }
  });
  page.on('response', (res) => {
    const url = res.url();
    if (url.includes('/api/') && res.status() >= 500) {
      apiErrors.push(`${res.status()} ${url}`);
    }
  });

  try {
    await page.goto(`${BASE}/app`, { waitUntil: 'networkidle', timeout: 30000 });

    // Login via form
    await page.fill('#login-email', roleConfig.email);
    await page.fill('#login-password', roleConfig.password);
    await page.click('#login-form button[type="submit"]');
    await page.waitForTimeout(2500);

    const authModal = await page.evaluate(() => {
      const m = document.getElementById('auth-modal');
      return m && getComputedStyle(m).display !== 'none';
    });
    if (authModal) {
      fail(`browser:${roleConfig.name}`, 'Login failed — auth modal still visible');
      await browser.close();
      return;
    }

    const appScreen = await page.$('#app-screen:not(.hidden)');
    if (!appScreen) {
      fail(`browser:${roleConfig.name}`, 'App screen not visible after login');
      await browser.close();
      return;
    }
    console.log('  Login OK');

    // Navigate each page
    for (const pg of roleConfig.pages) {
      jsErrors.length = 0;
      apiErrors.length = 0;

      await page.evaluate((p) => { if (typeof navigate === 'function') navigate(p); }, pg);
      await page.waitForTimeout(1500);

      const pageEl = await page.$(`#page-${pg}:not(.hidden)`);
      if (!pageEl) {
        // Some pages hidden by role — check if nav link is hidden
        const navHidden = await page.evaluate((p) => {
          const link = document.querySelector(`[data-page="${p}"]`);
          if (!link) return 'missing';
          const style = getComputedStyle(link);
          return style.display === 'none' || link.classList.contains('hidden') ? 'hidden' : 'visible';
        }, pg);
        if (navHidden === 'hidden' || navHidden === 'missing') {
          warn(`browser:${roleConfig.name}`, `Page ${pg} not accessible for role (nav ${navHidden})`);
        } else {
          fail(`browser:${roleConfig.name}`, `Page #page-${pg} not visible after navigate()`);
        }
        continue;
      }

      const hasContent = await page.evaluate((p) => {
        const el = document.getElementById('page-' + p);
        return el && el.innerText.trim().length > 10;
      }, pg);
      if (!hasContent) warn(`browser:${roleConfig.name}`, `Page ${pg} appears empty`);

      for (const err of jsErrors) {
        if (!err.includes('ResizeObserver') && !err.includes('Non-Error')) {
          fail(`browser:${roleConfig.name}:${pg}`, `JS: ${err.slice(0, 200)}`);
        }
      }
      for (const err of apiErrors) {
        fail(`browser:${roleConfig.name}:${pg}`, `API: ${err}`);
      }
      console.log(`  OK page: ${pg}`);
    }

    // Test logout
    await page.evaluate(() => { if (typeof logout === 'function') logout(); });
    await page.waitForTimeout(1000);
  } catch (e) {
    fail(`browser:${roleConfig.name}`, e.message);
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log(`QA base URL: ${BASE}`);
  await testPublicPages();

  let adminToken;
  try {
    adminToken = await loginApi('evaughntaemw@gmail.com', process.env.ADMIN_PASSWORD || 'NewTech2026!');
    console.log('\nAdmin API login OK');
  } catch (e) {
    fail('auth', `Admin login: ${e.message}`);
    adminToken = null;
  }

  if (adminToken) await testApiEndpoints(adminToken);

  for (const role of ROLES) {
    try {
      await testRoleBrowser(role);
    } catch (e) {
      fail(`browser:${role.name}`, e.message);
    }
  }

  console.log('\n========================================');
  console.log(`FAILURES: ${failures.length}`);
  console.log(`WARNINGS: ${warnings.length}`);
  if (failures.length) {
    console.log('\n--- Failures ---');
    failures.forEach((f) => console.log(`  [${f.scope}] ${f.msg}`));
  }
  if (warnings.length) {
    console.log('\n--- Warnings ---');
    warnings.forEach((w) => console.log(`  [${w.scope}] ${w.msg}`));
  }

  const reportPath = path.join(__dirname, '..', 'qa-report.json');
  fs.writeFileSync(reportPath, JSON.stringify({ base: BASE, failures, warnings, ts: new Date().toISOString() }, null, 2));
  console.log(`\nReport: ${reportPath}`);
  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
