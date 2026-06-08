'use strict';
/** Playwright UI test: Fleet downtime modal + Maintenance Mark Down */
const { chromium } = require('playwright');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const BASE = process.env.QA_BASE || 'http://localhost:3001';
const DB = process.env.DATABASE_URL || (
  fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8').match(/DATABASE_URL=(.+)/)?.[1]?.trim() : null
);
const JWT_SECRET = process.env.JWT_SECRET || (
  fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8').match(/JWT_SECRET=(.+)/)?.[1]?.trim() : null
);

async function getMaintenanceToken() {
  const pool = new Pool({
    connectionString: DB,
    ssl: /\.rlwy\.net|railway\.internal/i.test(DB || '') ? false : undefined,
  });
  const r = await pool.query(
    "SELECT id, email, name, role FROM users WHERE role = 'maintenance' AND deleted_at IS NULL LIMIT 1"
  );
  await pool.end();
  const u = r.rows[0];
  return jwt.sign({ id: u.id, email: u.email, role: u.role, name: u.name }, JWT_SECRET, { expiresIn: '1h' });
}

async function main() {
  const failures = [];
  const ok = (name, cond, detail = '') => {
    if (cond) console.log('  OK', name);
    else { failures.push(name); console.log('  FAIL', name, detail); }
  };

  console.log('Downtime UI E2E —', BASE);
  const token = await getMaintenanceToken();

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on('pageerror', (err) => console.log('  PAGE ERROR:', err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('  CONSOLE ERROR:', msg.text());
  });

  await page.goto(`${BASE}/app.html`, { waitUntil: 'networkidle' });
  await page.evaluate((t) => {
    localStorage.setItem('fs_token', t);
  }, token);
  await page.reload({ waitUntil: 'networkidle' });

  // Wait for app shell
  await page.waitForSelector('.sidebar', { timeout: 15000 }).catch(() => {});

  // Navigate to Fleet
  await page.click('[data-page="fleet"]', { timeout: 10000 }).catch(async () => {
    await page.evaluate(() => navigate('fleet'));
  });
  await page.waitForTimeout(1500);

  const downtimeBtn = page.locator('button:has-text("Downtime")').first();
  ok('fleet downtime button visible', await downtimeBtn.isVisible().catch(() => false));

  await downtimeBtn.click();
  await page.waitForSelector('#downtime-modal:not(.hidden)', { timeout: 5000 });
  await page.waitForTimeout(1000);

  const entriesHtml = await page.locator('#downtime-entries').innerText();
  ok('downtime entries load (not failed message)', !entriesHtml.includes('Failed to load entries'), entriesHtml.slice(0, 120));

  // Schedule downtime
  await page.fill('#downtime-reason', 'Playwright UI test');
  await page.click('#downtime-form button[type="submit"]');
  await page.waitForTimeout(2000);

  const entriesAfter = await page.locator('#downtime-entries').innerText();
  ok('downtime entry created', entriesAfter.includes('Playwright UI test') || entriesAfter.includes('all day') || entriesAfter.includes('08:00'), entriesAfter.slice(0, 200));

  const errVisible = await page.locator('#downtime-error:not(.hidden)').isVisible().catch(() => false);
  if (errVisible) {
    const errText = await page.locator('#downtime-error').innerText();
    ok('no downtime form error', false, errText);
  }

  await page.click('#downtime-modal button:has-text("Cancel")').catch(() => page.evaluate(() => closeDowntimeModal()));

  // Maintenance tab — Mark Down
  await page.click('[data-page="maintenance"]', { timeout: 10000 }).catch(async () => {
    await page.evaluate(() => navigate('maintenance'));
  });
  await page.waitForTimeout(1500);

  const markDownBtn = page.locator('button:has-text("Mark Down")').first();
  ok('mark down button visible', await markDownBtn.isVisible().catch(() => false));
  await markDownBtn.click();
  await page.waitForSelector('#maint-status-modal:not(.hidden)', { timeout: 5000 });

  await page.fill('#maint-status-reason', 'Playwright mark down');
  await page.click('#maint-status-form button[type="submit"]');
  await page.waitForTimeout(2500);

  const maintErr = await page.locator('#maint-status-error:not(.hidden)').innerText().catch(() => '');
  ok('mark down saved without error', !maintErr, maintErr);

  const modalHidden = await page.locator('#maint-status-modal.hidden').isVisible().catch(() => false);
  ok('maint modal closed after save', modalHidden);

  await browser.close();

  if (failures.length) {
    console.error('\nFailures:', failures.join(', '));
    process.exit(1);
  }
  console.log('\nAll downtime UI tests passed.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
