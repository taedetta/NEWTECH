'use strict';
/**
 * Render dashboard login + service setup helper.
 * Reads RENDER_EMAIL and RENDER_PASSWORD from env.
 */
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

function parseCookies(setCookie = []) {
  const jar = {};
  setCookie.forEach((c) => {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    if (i > 0) jar[pair.slice(0, i).trim()] = pair.slice(i + 1);
  });
  return jar;
}

function cookieHeader(jar) {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

function mergeJar(jar, setCookie) {
  return { ...jar, ...parseCookies(setCookie) };
}

async function gql(jar, query, variables = {}) {
  const body = JSON.stringify({ query, variables });
  const r = await request({
    hostname: 'api.render.com',
    path: '/graphql',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      Accept: 'application/json',
      Origin: 'https://dashboard.render.com',
      Referer: 'https://dashboard.render.com/',
      Cookie: cookieHeader(jar),
    },
  }, body);
  let data;
  try { data = JSON.parse(r.body); } catch { data = { raw: r.body.slice(0, 500) }; }
  return { status: r.status, data, jar: mergeJar(jar, r.headers['set-cookie']) };
}

async function main() {
  if (!PASS) throw new Error('Set RENDER_PASSWORD env var');

  let jar = {};

  // Try dashboard login endpoints
  for (const path of ['/api/v1/auth/login', '/api/v1/login', '/api/auth/login']) {
    const body = JSON.stringify({ email: EMAIL, password: PASS });
    const r = await request({
      hostname: 'dashboard.render.com',
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Accept: 'application/json',
        Origin: 'https://dashboard.render.com',
        Referer: 'https://dashboard.render.com/login',
      },
    }, body);
    jar = mergeJar(jar, r.headers['set-cookie']);
    console.log(path, '→', r.status, 'cookies:', Object.keys(jar).join(',') || '(none)', 'body:', r.body.slice(0, 120));
  }

  // GraphQL login mutation variants
  const mutations = [
    `mutation($email:String!,$password:String!){ login(email:$email,password:$password){ token user { id email } } }`,
    `mutation($input:LoginInput!){ login(input:$input){ token } }`,
    `mutation($email:String!,$password:String!){ emailPasswordLogin(email:$email,password:$password){ token } }`,
  ];
  for (const query of mutations) {
    const vars = query.includes('LoginInput')
      ? { input: { email: EMAIL, password: PASS } }
      : { email: EMAIL, password: PASS };
    const body = JSON.stringify({ query, variables: vars });
    const r = await request({
      hostname: 'dashboard.render.com',
      path: '/graphql',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Accept: 'application/json',
        Origin: 'https://dashboard.render.com',
        Cookie: cookieHeader(jar),
      },
    }, body);
    jar = mergeJar(jar, r.headers['set-cookie']);
    console.log('GQL login →', r.status, r.body.slice(0, 300));
    let parsed;
    try { parsed = JSON.parse(r.body); } catch { continue; }
    const token = parsed?.data?.login?.token
      || parsed?.data?.emailPasswordLogin?.token;
    if (token) {
      console.log('\nGot token, probing API...');
      const apiBody = JSON.stringify({ query: '{ owner { id email } }' });
      const api = await request({
        hostname: 'api.render.com',
        path: '/graphql',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(apiBody),
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
      }, apiBody);
      console.log('Owner:', api.status, api.body.slice(0, 400));
      return;
    }
  }

  // Session cookie probes
  const probes = [
    { host: 'dashboard.render.com', path: '/api/v1/services?limit=5' },
    { host: 'api.render.com', path: '/v1/services?limit=5' },
  ];
  for (const p of probes) {
    const r = await request({
      hostname: p.host,
      path: p.path,
      method: 'GET',
      headers: { Accept: 'application/json', Cookie: cookieHeader(jar) },
    });
    console.log(`GET ${p.host}${p.path} →`, r.status, r.body.slice(0, 250));
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
