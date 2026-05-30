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
  const docsBtn = page.locator('#fleet-table [data-aircraft-docs-id]').first();
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

  const pdfPath = require('path').join(__dirname, 'fixtures', 'e2e-test-doc.pdf');
  require('fs').mkdirSync(require('path').dirname(pdfPath), { recursive: true });
  if (!require('fs').existsSync(pdfPath)) {
    require('fs').writeFileSync(pdfPath, '%PDF-1.4\n%%EOF\n');
  }
  const bigPdfPath = require('path').join(__dirname, 'fixtures', 'e2e-big-doc.pdf');
  if (!require('fs').existsSync(bigPdfPath)) {
    const header = Buffer.from('%PDF-1.4\n%%EOF\n');
    const big = Buffer.alloc(600 * 1024, 0);
    header.copy(big);
    require('fs').writeFileSync(bigPdfPath, big);
  }

  // Admin: open modal, upload, verify View link opens PDF
  console.log('\n--- admin ---');
  await login(page, ROLES[0].email);
  await openFleetDocs(page);
  const uploadWrap = page.locator('#aircraft-docs-upload-wrap');
  ok('admin sees upload form', !(await uploadWrap.evaluate((el) => el.classList.contains('hidden'))));

  await page.selectOption('#aircraft-doc-type', 'other');
  await page.fill('#aircraft-doc-title', 'E2E UI Test Doc');
  await page.setInputFiles('#aircraft-doc-file', bigPdfPath);
  await page.click('#aircraft-doc-upload-btn');
  await page.waitForTimeout(3000);
  const uploadErr = await page.locator('#aircraft-docs-error.visible').textContent().catch(() => '');
  ok('large PDF upload succeeds', !uploadErr, uploadErr || '');
  const viewLink = page.locator('#aircraft-docs-list a.btn', { hasText: 'View' }).first();
  ok('admin sees View link after upload', (await viewLink.count()) > 0);
  const viewHref = await viewLink.getAttribute('href');
  ok('View link has URL', !!viewHref && viewHref.startsWith('http'));
  const viewRes = await page.request.get(viewHref);
  ok('View URL returns PDF', viewRes.ok(), `status=${viewRes.status()}`);
  await page.locator('#aircraft-docs-modal .modal').locator('button.btn-secondary', { hasText: 'Close' }).click().catch(() => {});

  for (const user of ROLES.slice(1)) {
    console.log(`\n--- ${user.role} ---`);
    await page.evaluate(() => { localStorage.removeItem('fs_token'); location.reload(); });
    await page.waitForTimeout(500);
    await login(page, user.email);
    await openFleetDocs(page);
    const hiddenUpload = await page.locator('#aircraft-docs-upload-wrap').evaluate((el) => el.classList.contains('hidden'));
    ok(`${user.role} upload hidden`, hiddenUpload === !user.canUpload);
    ok(`${user.role} sees uploaded doc`, (await page.locator('#aircraft-docs-list a.btn', { hasText: 'View' }).count()) > 0);
    const roleView = page.locator('#aircraft-docs-list a.btn', { hasText: 'View' }).first();
    const roleHref = await roleView.getAttribute('href');
    const roleRes = await page.request.get(roleHref);
    ok(`${user.role} can fetch document`, roleRes.ok(), `status=${roleRes.status()}`);
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
