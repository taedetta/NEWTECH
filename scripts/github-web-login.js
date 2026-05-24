'use strict';
const https = require('https');

const USER = process.env.GITHUB_USER || 'evaughntaemw@gmail.com';
const PASS = process.env.GITHUB_PASSWORD;

if (!PASS) {
  console.error('Set GITHUB_PASSWORD env var');
  process.exit(1);
}

function get(path, cookies = '') {
  return new Promise((resolve, reject) => {
    https.get({
      hostname: 'github.com',
      path,
      headers: { 'User-Agent': 'Mozilla/5.0', Cookie: cookies },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data }));
    }).on('error', reject);
  });
}

function post(path, body, cookies = '') {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'github.com',
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'Mozilla/5.0',
        Cookie: cookies,
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function mergeCookies(existing, setCookie) {
  const jar = {};
  (existing ? existing.split('; ') : []).forEach((c) => {
    const [k, ...v] = c.split('=');
    if (k) jar[k] = v.join('=');
  });
  (setCookie || []).forEach((c) => {
    const [pair] = c.split(';');
    const [k, ...v] = pair.split('=');
    if (k) jar[k] = v.join('=');
  });
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

(async () => {
  const loginPage = await get('/login');
  const tokenMatch = loginPage.data.match(/name="authenticity_token" value="([^"]+)"/);
  if (!tokenMatch) {
    console.error('Could not parse authenticity token');
    process.exit(1);
  }
  let cookies = mergeCookies('', loginPage.headers['set-cookie']);
  const body = new URLSearchParams({
    commit: 'Sign in',
    login: USER,
    password: PASS,
    authenticity_token: tokenMatch[1],
  }).toString();
  const session = await post('/session', body, cookies);
  cookies = mergeCookies(cookies, session.headers['set-cookie']);
  console.log('Session status:', session.status, 'redirect:', session.headers.location || '(none)');
  if (session.status === 302 && session.headers.location?.includes('sessions/two-factor')) {
    console.log('2FA required — password login blocked for automation');
    process.exit(2);
  }
  if (session.status !== 302 || !session.headers.location?.includes('github.com')) {
    console.log('Login likely failed');
    process.exit(1);
  }
  // Test API with session cookie
  const userRes = await new Promise((resolve, reject) => {
    https.get({
      hostname: 'api.github.com',
      path: '/user',
      headers: { 'User-Agent': 'Mozilla/5.0', Cookie: cookies, Accept: 'application/vnd.github+json' },
    }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    }).on('error', reject);
  });
  console.log('API /user:', userRes.status, userRes.body.slice(0, 200));
})();
