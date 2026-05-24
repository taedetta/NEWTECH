'use strict';
const https = require('https');

const EMAIL = process.env.RENDER_EMAIL || 'evaughntaemw@gmail.com';
const PASS = process.env.RENDER_PASSWORD;

function request(opts, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function jarFrom(setCookie = []) {
  const jar = {};
  setCookie.forEach((c) => {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    if (i > 0) jar[pair.slice(0, i)] = pair.slice(i + 1);
  });
  return jar;
}

function jarStr(jar) {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

function mergeJar(jar, setCookie) {
  return { ...jar, ...jarFrom(setCookie) };
}

(async () => {
  if (!PASS) { console.error('Set RENDER_PASSWORD'); process.exit(1); }

  let jar = {};
  const loginBody = JSON.stringify({ email: EMAIL, password: PASS });
  const login = await request({
    hostname: 'dashboard.render.com',
    path: '/api/v1/auth/login',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(loginBody),
      Accept: 'application/json',
      Origin: 'https://dashboard.render.com',
      Referer: 'https://dashboard.render.com/login',
    },
  }, loginBody);
  jar = mergeJar(jar, login.headers['set-cookie']);
  console.log('Login:', login.status, login.body || '(empty)');

  const endpoints = [
    '/api/v1/user',
    '/api/v1/users/me',
    '/api/v1/owners',
    '/api/v1/services?limit=10',
    '/api/v1/api-keys',
  ];

  for (const path of endpoints) {
    const r = await request({
      hostname: 'dashboard.render.com',
      path,
      method: 'GET',
      headers: { Accept: 'application/json', Cookie: jarStr(jar) },
    });
    console.log(path, '→', r.status, r.body.slice(0, 300));
    jar = mergeJar(jar, r.headers['set-cookie']);
  }

  // Try official Render API with cookie (unlikely)
  const api = await request({
    hostname: 'api.render.com',
    path: '/v1/services?limit=5',
    method: 'GET',
    headers: { Accept: 'application/json', Cookie: jarStr(jar) },
  });
  console.log('api.render.com services →', api.status, api.body.slice(0, 300));
})();
