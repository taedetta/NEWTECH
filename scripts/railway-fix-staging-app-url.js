'use strict';
/** Point staging APP_URL back to the default Railway hostname and redeploy. */
const https = require('https');

const TOKEN = process.env.RAILWAY_API_TOKEN;
const PROJECT_ID = '33507e47-1ddd-4db0-a42e-f8c818770dd7';
const ENV_ID = '709b9ddb-cc38-44bf-b533-d677ed619584';
const STAGING_WEB = '5f3e71e8-7fdf-4f08-b6ba-04a349e30264';
const STAGING_URL = 'https://flightslate-staging-production.up.railway.app';

function gql(query, variables = {}) {
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
      timeout: 60000,
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
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

async function main() {
  if (!TOKEN) throw new Error('RAILWAY_API_TOKEN required');

  console.log('Setting APP_URL on flightslate-staging →', STAGING_URL);
  await gql('mutation($input: VariableUpsertInput!) { variableUpsert(input: $input) }', {
    input: {
      projectId: PROJECT_ID,
      environmentId: ENV_ID,
      serviceId: STAGING_WEB,
      name: 'APP_URL',
      value: STAGING_URL,
      skipDeploys: false,
    },
  });

  console.log('Redeploying staging…');
  const dep = await gql(
    'mutation($environmentId: String!, $serviceId: String!) { serviceInstanceDeployV2(environmentId: $environmentId, serviceId: $serviceId) }',
    { environmentId: ENV_ID, serviceId: STAGING_WEB }
  );
  console.log('Deploy queued:', dep.serviceInstanceDeployV2);

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 10000));
    const res = await fetch(`${STAGING_URL}/api/config`);
    const cfg = await res.json();
    process.stdout.write(`appUrl=${cfg.appUrl} version=${cfg.version}\r`);
    if (cfg.appUrl === STAGING_URL) {
      console.log('\nStaging is live at default Railway URL.');
      return;
    }
  }
  throw new Error('Timed out waiting for APP_URL update');
}

main().catch((e) => {
  console.error('Failed:', e.message);
  process.exit(1);
});
