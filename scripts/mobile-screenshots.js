'use strict';

/**
 * Capture mobile viewport screenshots of key app pages.
 * Usage:
 *   node scripts/mobile-screenshots.js [baseUrl]
 * Env:
 *   QA_EMAIL, QA_PASSWORD — login credentials (defaults: local dev owner)
 */

const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.argv[2] || process.env.QA_BASE || 'http://localhost:3000';
const EMAIL = process.env.QA_EMAIL || 'evaughntaemw@gmail.com';
const PASSWORD = process.env.QA_PASSWORD || process.env.TEST_USER_PASSWORD || 'NewTech2026!';
const OUT_DIR = path.join(__dirname, '..', 'screenshots', 'mobile-' + new Date().toISOString().slice(0, 10));

const VIEWPORTS = [
  { name: 'iphone-se', width: 375, height: 667 },
  { name: 'iphone-14', width: 390, height: 844 },
  { name: 'pixel-7', width: 412, height: 915 },
  { name: 'iphone-14-pro-max', width: 430, height: 932 },
];

const PAGES = [
  { id: 'dashboard', wait: '#dashboard-stats, #dashboard-empty' },
  { id: 'schedule', wait: '#calendar-grid' },
  { id: 'fleet', wait: '#fleet-table, #fleet-empty' },
  { id: 'messages', wait: '.messages-layout, #messages-empty' },
  { id: 'progress', wait: '#progress-content, .progress-student-grid' },
  { id: 'history', wait: '#history-table-body, #history-empty, #history-cards' },
  { id: 'billing', wait: '#billing-students-list, #billing-detail, #billing-empty' },
  { id: 'instructor-hours', wait: '#ih-tbody, #ih-empty, #ih-cards' },
  { id: 'portal', wait: '#portal-content, .portal-hero' },
];

async function loginViaApi(request) {
  const res = await request.post(`${BASE}/api/auth/login`, {
    data: { email: EMAIL, password: PASSWORD },
  });
  const data = await res.json();
  if (!res.ok()) throw new Error(`Login failed: ${data.error || res.status()}`);
  return data.token;
}

async function injectSession(page, token) {
  await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(function (t) {
    localStorage.setItem('fs_token', t);
  }, token);
  await page.reload({ waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 60000 });
  await page.waitForTimeout(1500);
}

async function screenshotPage(page, pageId, viewportName) {
  await page.evaluate(function (p) {
    if (typeof navigate === 'function') navigate(p);
  }, pageId);
  await page.waitForTimeout(2000);
  const file = path.join(OUT_DIR, `${viewportName}-${pageId}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log('  saved', path.basename(file));
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log('Mobile screenshots →', OUT_DIR);
  console.log('Base URL:', BASE);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const request = context.request;
  const token = await loginViaApi(request);
  console.log('Logged in as', EMAIL);

  for (const vp of VIEWPORTS) {
    console.log('\nViewport:', vp.name, vp.width + 'x' + vp.height);
    const page = await context.newPage();
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await injectSession(page, token);

    await screenshotPage(page, 'dashboard', vp.name);
    for (const p of PAGES.slice(1)) {
      try {
        await screenshotPage(page, p.id, vp.name);
      } catch (err) {
        console.warn('  skip', p.id, '-', err.message);
      }
    }

    // Auth modal on small screen
    await page.evaluate(function () {
      if (typeof logout === 'function') logout();
    });
    await page.waitForTimeout(800);
    await page.screenshot({
      path: path.join(OUT_DIR, `${vp.name}-auth-modal.png`),
      fullPage: false,
    });
    console.log('  saved', `${vp.name}-auth-modal.png`);

    await page.close();
  }

  await browser.close();
  console.log('\nDone. Review screenshots in:', OUT_DIR);
}

main().catch(function (err) {
  console.error(err.message || err);
  process.exit(1);
});
