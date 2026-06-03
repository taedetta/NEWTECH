'use strict';
/**
 * Copy Turnstile keys from staging to production (or set via env) and redeploy production.
 * Usage: RAILWAY_API_TOKEN=xxx node scripts/railway-set-production-captcha.js
 */
const https = require('https');

const TOKEN = process.env.RAILWAY_API_TOKEN;
const PROJECT_ID = '33507e47-1ddd-4db0-a42e-f8c818770dd7';
const ENV_ID = '709b9ddb-cc38-44bf-b533-d677ed619584';
const STAGING = '5f3e71e8-7fdf-4f08-b6ba-04a349e30264';
const PROD = '8ab1e88f-75d5-4a39-a14a-3b036716011b';

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
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${d.slice(0, 200)}`));
        try {
          const parsed = JSON.parse(d);
          if (parsed.errors?.length) reject(new Error(parsed.errors.map((e) => e.message).join('; ')));
          else resolve(parsed.data);
        } catch {
          reject(new Error(d.slice(0, 300)));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error('GraphQL timeout')));
    req.write(body);
    req.end();
  });
}

async function getVars(serviceId) {
  const r = await gql(
    'query($projectId: String!, $environmentId: String!, $serviceId: String!) { variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) }',
    { projectId: PROJECT_ID, environmentId: ENV_ID, serviceId }
  );
  return r.variables || {};
}

async function upsertVar(serviceId, name, value, skipDeploys) {
  await gql('mutation($input: VariableUpsertInput!) { variableUpsert(input: $input) }', {
    input: {
      projectId: PROJECT_ID,
      environmentId: ENV_ID,
      serviceId,
      name,
      value: String(value),
      skipDeploys,
    },
  });
  console.log(`Set ${name} on ${serviceId === PROD ? 'production' : 'staging'}`);
}

async function main() {
  if (!TOKEN) throw new Error('RAILWAY_API_TOKEN required');

  let siteKey = process.env.TURNSTILE_SITE_KEY;
  let secretKey = process.env.TURNSTILE_SECRET_KEY;

  if (!siteKey || !secretKey) {
    console.log('Reading Turnstile keys from staging service…');
    const stagingVars = await getVars(STAGING);
    siteKey = siteKey || stagingVars.TURNSTILE_SITE_KEY;
    secretKey = secretKey || stagingVars.TURNSTILE_SECRET_KEY;
  }

  if (!siteKey || !secretKey) {
    throw new Error('Turnstile keys not found — set TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY or configure staging first.');
  }

  await upsertVar(PROD, 'TURNSTILE_SITE_KEY', siteKey, true);
  await upsertVar(PROD, 'TURNSTILE_SECRET_KEY', secretKey, true);
  await upsertVar(PROD, 'CAPTCHA_ENABLED', 'true', true);

  await gql(
    'mutation($environmentId: String!, $serviceId: String!) { serviceInstanceDeployV2(environmentId: $environmentId, serviceId: $serviceId) }',
    { environmentId: ENV_ID, serviceId: PROD }
  );
  console.log('Production redeploy queued');

  for (let i = 0; i < 36; i++) {
    await new Promise((r) => setTimeout(r, 10000));
    const cfg = await fetch('https://www.newtechaviation.com/api/config').then((r) => r.json());
    process.stdout.write(`production: captcha=${cfg.captchaEnabled} key=${cfg.turnstileSiteKey ? 'set' : 'none'} v=${cfg.version}\r`);
    if (cfg.captchaEnabled && cfg.turnstileSiteKey) {
      console.log(`\nProduction CAPTCHA live (version ${cfg.version})`);
      return;
    }
  }
  console.warn('\nTimeout — verify /api/config on production manually');
}

main().catch((e) => {
  console.error('Failed:', e.message);
  process.exit(1);
});
