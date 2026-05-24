'use strict';
/** Login to Render dashboard, extract API token, merge email env vars, redeploy. */
const { chromium } = require('playwright');
const https = require('https');
const fs = require('fs');
const path = require('path');

const SERVICE_ID = 'srv-d89h9kq8qa3s73e20h3g';
const EMAIL = process.env.RENDER_EMAIL || 'evaughntaemw@gmail.com';
const PASS = process.env.RENDER_PASSWORD || '';

function loadDotEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

function api(method, apiPath, token, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = https.request({
      hostname: 'api.render.com',
      path: apiPath,
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, (resp) => {
      let raw = '';
      resp.on('data', (c) => { raw += c; });
      resp.on('end', () => resolve({ status: resp.statusCode, body: raw }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function getRenderToken() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto('https://dashboard.render.com/login', { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Email').fill(EMAIL);
    await page.locator('[data-test-id="signin-password-field"]').fill(PASS);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 90000 });
    const token = await page.evaluate(() => {
      try {
        const auth = JSON.parse(localStorage.getItem('render-auth') || '{}');
        return auth.idToken || null;
      } catch { return null; }
    });
    if (!token) throw new Error('Could not read render-auth idToken');
    return token;
  } finally {
    await browser.close();
  }
}

async function main() {
  loadDotEnv();
  if (!PASS) throw new Error('RENDER_PASSWORD required');

  const toSet = {
    BREVO_API_KEY: process.env.BREVO_API_KEY,
    SMTP_FROM: process.env.SMTP_FROM,
    EMAIL_FROM_NAME: process.env.EMAIL_FROM_NAME || 'New Tech Aviation',
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT || '587',
    SMTP_SECURE: process.env.SMTP_SECURE || 'false',
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASS: process.env.SMTP_PASS,
  };

  console.log('Logging into Render...');
  const token = await getRenderToken();

  const getRes = await api('GET', `/v1/services/${SERVICE_ID}/env-vars`, token);
  if (getRes.status !== 200) throw new Error(`GET env-vars ${getRes.status}: ${getRes.body.slice(0, 200)}`);

  const existing = JSON.parse(getRes.body);
  const map = new Map();
  for (const row of existing) {
    const item = row.envVar || row;
    if (item?.key) map.set(item.key, item.value);
  }
  for (const [key, value] of Object.entries(toSet)) {
    if (value) map.set(key, value);
  }
  const merged = [...map.entries()].map(([key, value]) => ({ key, value }));

  const putRes = await api('PUT', `/v1/services/${SERVICE_ID}/env-vars`, token, merged);
  console.log('PUT env-vars:', putRes.status, putRes.status < 400 ? `(${merged.length} total vars)` : putRes.body.slice(0, 300));
  if (putRes.status >= 400) process.exit(1);

  const deployRes = await api('POST', `/v1/services/${SERVICE_ID}/deploys`, token, { clearCache: 'do_not_clear' });
  console.log('Deploy triggered:', deployRes.status);
  console.log('Email env keys set:', Object.keys(toSet).filter((k) => toSet[k]).join(', '));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
