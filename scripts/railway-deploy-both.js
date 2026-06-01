'use strict';

const https = require('https');

const TOKEN = process.env.RAILWAY_API_TOKEN;
const ENV_ID = '709b9ddb-cc38-44bf-b533-d677ed619584';
const PROD = '8ab1e88f-75d5-4a39-a14a-3b036716011b';
const STAGING = '5f3e71e8-7fdf-4f08-b6ba-04a349e30264';

function gql(query, variables) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, variables });
    const req = https.request({
      hostname: 'backboard.railway.com',
      path: '/graphql/v2',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => {
        const p = JSON.parse(d);
        if (p.errors?.length) reject(new Error(p.errors.map((e) => e.message).join('; ')));
        else resolve(p.data);
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function deploy(serviceId, label) {
  const data = await gql(
    `mutation($environmentId: String!, $serviceId: String!) {
      serviceInstanceDeployV2(environmentId: $environmentId, serviceId: $serviceId)
    }`,
    { environmentId: ENV_ID, serviceId }
  );
  console.log(`${label}: deploy queued (${data.serviceInstanceDeployV2})`);
}

async function waitHealthy(url, label) {
  for (let i = 0; i < 24; i++) {
    await new Promise((r) => setTimeout(r, 10000));
    try {
      const res = await fetch(`${url}/api/config`);
      const cfg = await res.json();
      process.stdout.write(`${label}: ${cfg.version || '?'} (${res.status})\r`);
      if (res.ok && cfg.version === '2e1d233') {
        console.log(`\n${label}: live at ${cfg.version}`);
        return;
      }
    } catch {
      process.stdout.write(`${label}: waiting...\r`);
    }
  }
  console.warn(`\n${label}: timeout waiting for health (may still be deploying)`);
}

(async () => {
  if (!TOKEN) throw new Error('RAILWAY_API_TOKEN required');
  console.log('GitHub: main + staging target 2e1d233');
  await deploy(PROD, 'production (www.newtechaviation.com)');
  await deploy(STAGING, 'staging (flightslate-staging)');
  console.log('\nWaiting for deploys...');
  await Promise.all([
    waitHealthy('https://www.newtechaviation.com', 'production'),
    waitHealthy('https://flightslate-staging-production.up.railway.app', 'staging'),
  ]);
  console.log('\nDone.');
})().catch((err) => {
  console.error('Deploy failed:', err.message);
  process.exit(1);
});
