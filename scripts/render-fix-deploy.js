'use strict';
const https = require('https');
const crypto = require('crypto');

const API_KEY = process.env.RENDER_API_KEY;
const SERVICE_ID = 'srv-d89h9kq8qa3s73e20h3g';
const DB_ID = 'dpg-d89hevv7f7vs73c7gggg-a';

if (!API_KEY) {
  console.error('RENDER_API_KEY required');
  process.exit(1);
}

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = https.request({
      hostname: 'api.render.com',
      path,
      method,
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        Accept: 'application/json',
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

async function main() {
  const connRes = await req('GET', `/v1/postgres/${DB_ID}/connection-info`);
  if (connRes.status !== 200) throw new Error(`connection-info failed: ${connRes.body}`);
  const conn = JSON.parse(connRes.body);
  const dbUrl = `${conn.internalConnectionString}?sslmode=require`;
  const jwt = crypto.randomBytes(32).toString('hex');

  const envVars = [
    { key: 'DATABASE_URL', value: dbUrl },
    { key: 'JWT_SECRET', value: jwt },
    { key: 'NODE_ENV', value: 'production' },
    { key: 'APP_ENV', value: 'production' },
    { key: 'APP_URL', value: 'https://newtech-zek5.onrender.com' },
  ];

  const putRes = await req('PUT', `/v1/services/${SERVICE_ID}/env-vars`, envVars);
  console.log('PUT env-vars:', putRes.status);
  if (putRes.status >= 400) {
    console.log(putRes.body.slice(0, 400));
    throw new Error('Failed to set env vars');
  }
  console.log('Environment variables set (DATABASE_URL, JWT_SECRET, NODE_ENV, APP_ENV, APP_URL)');

  const patchRes = await req('PATCH', `/v1/services/${SERVICE_ID}`, {
    serviceDetails: {
      envSpecificDetails: {
        buildCommand: 'npm install',
        startCommand: 'npm start',
      },
      healthCheckPath: '/health',
    },
  });
  console.log('PATCH service:', patchRes.status, patchRes.status < 400 ? 'OK' : patchRes.body.slice(0, 200));

  const deployRes = await req('POST', `/v1/services/${SERVICE_ID}/deploys`, { clearCache: 'clear' });
  console.log('Deploy triggered:', deployRes.status);
  if (deployRes.status >= 400) console.log(deployRes.body.slice(0, 300));
  else console.log(JSON.parse(deployRes.body).id || 'deploy started');

  console.log('\nService URL: https://newtech-zek5.onrender.com');
  console.log('Run migrations + seed CMS after first successful deploy if site looks empty.');
}

main().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
