'use strict';
/** Create Render API key via dashboard, then set email env vars. */
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const path = require('path');

const PASS = process.env.RENDER_PASSWORD || '';

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  if (!PASS) throw new Error('RENDER_PASSWORD required');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://dashboard.render.com/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Email').fill('evaughntaemw@gmail.com');
  await page.locator('[data-test-id="signin-password-field"]').fill(PASS);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 90000 });

  await page.goto('https://dashboard.render.com/u/settings#api-keys', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(3000);

  const createBtn = page.getByRole('button', { name: /Create API Key|New API Key|Generate/i }).first();
  if (await createBtn.count()) {
    await createBtn.click();
    await sleep(1000);
    const nameInput = page.locator('input').filter({ hasText: '' }).first();
    await page.getByLabel(/name/i).fill('flightslate-email-setup').catch(() => {});
    await page.getByRole('button', { name: /Create|Generate|Save/i }).last().click().catch(() => {});
    await sleep(2000);
  }

  const body = await page.locator('body').innerText();
  const match = body.match(/rnd_[A-Za-z0-9]+/g);
  const apiKey = match ? match[match.length - 1] : null;
  await browser.close();

  if (!apiKey) throw new Error('Could not find Render API key on settings page');
  console.log('Got Render API key (not printing full value)');

  const script = path.join(__dirname, 'set-render-smtp-env.js');
  execSync(`node "${script}"`, {
    stdio: 'inherit',
    env: { ...process.env, RENDER_API_KEY: apiKey },
  });
}

main().catch((e) => { console.error(e.message); process.exit(1); });
