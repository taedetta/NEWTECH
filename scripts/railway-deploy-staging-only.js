'use strict';
/** Deploy staging web service only and wait for target git SHA on /api/config */
const https = require('https');

const TOKEN = process.env.RAILWAY_API_TOKEN;
const ENV_ID = '709b9ddb-cc38-44bf-b533-d677ed619584';
const STAGING = '5f3e71e8-7fdf-4f08-b6ba-04a349e30264';
const BASE = 'https://flightslate-staging-production.up.railway.app';
const TARGET = process.argv[2] || process.env.DEPLOY_TARGET_SHA;

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

async function main() {
  if (!TOKEN) throw new Error('RAILWAY_API_TOKEN required');
  if (!TARGET) throw new Error('Pass commit SHA as first argument');

  console.log(`Deploying staging only — target ${TARGET}`);
  await gql(
    'mutation($environmentId: String!, $serviceId: String!) { serviceInstanceDeployV2(environmentId: $environmentId, serviceId: $serviceId) }',
    { environmentId: ENV_ID, serviceId: STAGING }
  );

  for (let i = 0; i < 36; i++) {
    await new Promise((r) => setTimeout(r, 10000));
    const cfg = await fetch(`${BASE}/api/config`).then((r) => r.json());
    process.stdout.write(`staging: ${cfg.version || '?'} captcha=${cfg.captchaEnabled} appEnv=${cfg.appEnv}\r`);
    if (cfg.version === TARGET) {
      console.log(`\nStaging live at ${TARGET} (captchaEnabled=${cfg.captchaEnabled})`);
      return;
    }
  }
  console.error('\nTimeout waiting for staging deploy');
  process.exit(1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
