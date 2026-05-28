'use strict';

/**
 * Browser E2E: Fleet Docs button opens modal for each role.
 * Usage: QA_BASE=http://localhost:3000 node scripts/e2e-aircraft-docs-ui.js
 */
const { chromium } = require('playwright');

const BASE = process.env.QA_BASE || 'http://localhost:3000';
const PASSWORD = process.env.TEST_USER_PASSWORD || 'TestPass123!';

const ROLES = [
  { email: 'qa-admin@test.local', role: 'admin', canUpload: true },
  { email: 'qa-instructor@test.local', role: 'instructor', canUpload: false },
  { email: 'qa-student@test.local', role: 'student', canUpload: false },
  { email: 'qa-maintenance@test.local', role: 'maintenance', canUpload: false },
  { email: 'qa-renter@test.local', role: 'renter', canUpload: false },
];

const failures = [];

function ok(name, cond, detail) {
  if (cond) console.log(`  OK ${name}`);
  else {
    failures.push(name + (detail ? `: ${detail}` : ''));
    console.log(`  FAIL ${name}${detail ? `: ${detail}` : ''}`);
  }
}

async function login(page, email) {
  await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#login-email', { timeout: 15000 });
  await page.fill('#login-email', email);
  await page.fill('#login-password', PASSWORD);
  await page.click('#login-form button[type="submit"]');
  await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 15000 });
  await page.waitForTimeout(600);
}

async function openFleetDocs(page) {
  await page.click('[data-page="fleet"]');
  await page.waitForSelector('#fleet-table tr', { timeout: 10000 });
  const docsBtn = page.locator('#fleet-table button[data-aircraft-id]').first();
  ok('docs button exists', (await docsBtn.count()) > 0);
  await docsBtn.click();
  await page.waitForTimeout(500);
  const modal = page.locator('#aircraft-docs-modal');
  const hidden = await modal.evaluate((el) => el.classList.contains('hidden'));
  ok('modal visible after click', !hidden, hidden ? 'still hidden' : '');
  return modal;
}

async function main() {
  console.log('E2E Fleet Docs UI:', BASE);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('pageerror', (err) => console.log('  PAGE ERROR:', err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('  CONSOLE ERROR:', msg.text());
  });

  // Admin: open modal + upload if form visible
  console.log('\n--- admin ---');
  await login(page, ROLES[0].email);
  const adminModal = await openFleetDocs(page);
  const uploadWrap = page.locator('#aircraft-docs-upload-wrap');
  ok('admin sees upload form', !(await uploadWrap.evaluate((el) => el.classList.contains('hidden'))));

  // Try upload a tiny PDF if R2 configured (API test handles upload; UI smoke here)
  await page.click('#aircraft-docs-modal .modal button.btn-secondary', { hasText: 'Close' }).catch(() =>
    page.locator('#aircraft-docs-modal').click({ position: { x: 5, y: 5 } })
  );

  for (const user of ROLES.slice(1)) {
    console.log(`\n--- ${user.role} ---`);
    await page.evaluate(() => { localStorage.removeItem('fs_token'); location.reload(); });
    await page.waitForTimeout(500);
    await login(page, user.email);
    await openFleetDocs(page);
    const hiddenUpload = await page.locator('#aircraft-docs-upload-wrap').evaluate((el) => el.classList.contains('hidden'));
    ok(`${user.role} upload hidden`, hiddenUpload === !user.canUpload);
    await page.keyboard.press('Escape').catch(() => {});
    await page.locator('#aircraft-docs-modal').evaluate((el) => el.classList.add('hidden')).catch(() => {});
  }

  await browser.close();
  console.log('\n' + (failures.length ? `FAILED (${failures.length}):\n` + failures.map((f) => ' - ' + f).join('\n') : 'ALL UI TESTS PASSED'));
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
