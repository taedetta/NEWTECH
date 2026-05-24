'use strict';
/**
 * Merge Brevo SMTP env vars onto Render without wiping existing vars.
 * Requires RENDER_API_KEY or RENDER_PASSWORD (dashboard login → session cookie).
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const SERVICE_ID = process.env.RENDER_SERVICE_ID || 'srv-d89h9kq8qa3s73e20h3g';

function loadDotEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

function req(opts, body, cookie) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = {
      Accept: 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(process.env.RENDER_API_KEY ? { Authorization: `Bearer ${process.env.RENDER_API_KEY}` } : {}),
      ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
    };
    const r = https.request({ hostname: 'api.render.com', ...opts, headers }, (resp) => {
      let raw = '';
      resp.on('data', (c) => { raw += c; });
      resp.on('end', () => resolve({ status: resp.statusCode, body: raw, headers: resp.headers }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function loginCookie() {
  const email = process.env.RENDER_EMAIL || 'evaughntaemw@gmail.com';
  const pass = process.env.RENDER_PASSWORD;
  if (!pass) return null;

  const body = JSON.stringify({ email, password: pass });
  const r = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'dashboard.render.com',
      path: '/api/v1/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Accept: 'application/json',
        Origin: 'https://dashboard.render.com',
      },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: raw }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  const setCookie = r.headers['set-cookie'] || [];
  if (!setCookie.length) throw new Error(`Render login failed (${r.status}): ${r.body.slice(0, 200)}`);
  return setCookie.map((c) => c.split(';')[0]).join('; ');
}

function smtpVarsFromEnv() {
  const keys = [
    'BREVO_API_KEY', 'SMTP_FROM', 'EMAIL_FROM_NAME',
    'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS',
  ];
  const out = [];
  for (const key of keys) {
    if (process.env[key]) out.push({ key, value: process.env[key] });
  }
  if (out.length < 1) throw new Error('Missing BREVO_API_KEY or SMTP credentials in environment/.env');
  return out;
}

async function main() {
  loadDotEnv();
  const smtpVars = smtpVarsFromEnv();
  let cookie = null;
  if (!process.env.RENDER_API_KEY) {
    cookie = await loginCookie();
    if (!cookie) throw new Error('Set RENDER_API_KEY or RENDER_PASSWORD');
  }

  const authOpts = cookie ? { cookie } : {};
  const getRes = await req({ method: 'GET', path: `/v1/services/${SERVICE_ID}/env-vars` }, null, authOpts.cookie);
  if (getRes.status !== 200) throw new Error(`GET env-vars failed (${getRes.status}): ${getRes.body.slice(0, 300)}`);

  const existing = JSON.parse(getRes.body);
  const map = new Map();
  for (const row of existing) {
    const item = row.envVar || row;
    if (item?.key) map.set(item.key, item.value);
  }
  for (const { key, value } of smtpVars) map.set(key, value);

  const merged = [...map.entries()].map(([key, value]) => ({ key, value }));
  const putRes = await req({ method: 'PUT', path: `/v1/services/${SERVICE_ID}/env-vars` }, merged, authOpts.cookie);
  console.log('PUT env-vars:', putRes.status, putRes.status < 400 ? `(${merged.length} vars)` : putRes.body.slice(0, 300));
  if (putRes.status >= 400) process.exit(1);

  const deployRes = await req({ method: 'POST', path: `/v1/services/${SERVICE_ID}/deploys` }, { clearCache: 'do_not_clear' }, authOpts.cookie);
  console.log('Deploy triggered:', deployRes.status);
  console.log('SMTP keys set:', smtpVars.map((v) => v.key).join(', '));
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
