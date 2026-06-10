'use strict';
/**
 * One-time setup: staging web service + staging Postgres on Railway.
 * Usage: RAILWAY_API_TOKEN=... node scripts/railway-setup-staging.js
 */
const https = require('https');

const TOKEN = process.env.RAILWAY_API_TOKEN;
const PROJECT_ID = '33507e47-1ddd-4db0-a42e-f8c818770dd7';
const ENV_ID = '709b9ddb-cc38-44bf-b533-d677ed619584';
const PROD_WEB = '8ab1e88f-75d5-4a39-a14a-3b036716011b';
const GITHUB_REPO = 'taedetta/NEWTECH';
const STAGING_BRANCH = 'staging';

function gql(query, variables) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, variables });
    const req = https.request({
      hostname: 'backboard.railway.com', path: '/graphql/v2', method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
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

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function upsertVar(serviceId, name, value, skipDeploys = true) {
  await gql(
    'mutation($input: VariableUpsertInput!) { variableUpsert(input: $input) }',
    { input: { projectId: PROJECT_ID, environmentId: ENV_ID, serviceId, name, value: String(value), skipDeploys } }
  );
}

async function findService(name) {
  const r = await gql(`
    query($id: String!) {
      project(id: $id) { services { edges { node { id name } } } }
    }
  `, { id: PROJECT_ID });
  return r.project?.services?.edges?.find((e) => e.node.name === name)?.node || null;
}

async function createService(name, source) {
  const r = await gql(
    'mutation($input: ServiceCreateInput!) { serviceCreate(input: $input) { id name } }',
    { input: { projectId: PROJECT_ID, name, source, environmentId: ENV_ID } }
  );
  if (!r.serviceCreate) throw new Error('serviceCreate returned empty');
  return r.serviceCreate;
}

(async () => {
  if (!TOKEN) throw new Error('RAILWAY_API_TOKEN required');

  console.log('1. Ensure staging Postgres...');
  let dbSvc = await findService('flightslate-staging-db');
  if (!dbSvc) {
    dbSvc = await createService('flightslate-staging-db', { image: 'postgres:16-alpine' });
    console.log('   Created DB service:', dbSvc.id);
    await sleep(8000);
  } else {
    console.log('   DB service exists:', dbSvc.id);
  }

  console.log('2. Ensure staging web service...');
  let webSvc = await findService('flightslate-staging');
  if (!webSvc) {
    webSvc = await createService('flightslate-staging', {
      repo: GITHUB_REPO,
      branch: STAGING_BRANCH,
    });
    console.log('   Created web service:', webSvc.id);
  } else {
    console.log('   Web service exists:', webSvc.id);
    await gql(`
      mutation($environmentId: String!, $serviceId: String!, $input: ServiceInstanceUpdateInput!) {
        serviceInstanceUpdate(environmentId: $environmentId, serviceId: $serviceId, input: $input)
      }
    `, {
      environmentId: ENV_ID,
      serviceId: webSvc.id,
      input: { source: { repo: GITHUB_REPO, branch: STAGING_BRANCH } },
    });
  }

  console.log('3. Copy production env vars to staging (override APP_ENV / APP_URL / DATABASE_URL)...');
  const prodVars = await gql(`
    query($projectId: String!, $environmentId: String!, $serviceId: String!) {
      variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
    }
  `, { projectId: PROJECT_ID, environmentId: ENV_ID, serviceId: PROD_WEB });

  const skipKeys = new Set(['RAILWAY_', 'DATABASE_URL', 'APP_ENV', 'APP_URL']);
  for (const [name, value] of Object.entries(prodVars.variables || {})) {
    if ([...skipKeys].some((p) => name.startsWith(p))) continue;
    await upsertVar(webSvc.id, name, value);
    console.log('   copied', name);
  }

  await upsertVar(webSvc.id, 'APP_ENV', 'staging');
  await upsertVar(webSvc.id, 'APP_URL', 'https://flightslate-staging-production.up.railway.app');
  await upsertVar(webSvc.id, 'DATABASE_URL', '${{flightslate-staging-db.DATABASE_URL}}');
  await upsertVar(webSvc.id, 'NODE_ENV', 'production');

  console.log('4. Deploy staging...');
  const deploy = await gql(
    'mutation($environmentId: String!, $serviceId: String!) { serviceInstanceDeployV2(environmentId: $environmentId, serviceId: $serviceId) }',
    { environmentId: ENV_ID, serviceId: webSvc.id }
  );
  console.log('   Deploy id:', deploy.serviceInstanceDeployV2);

  console.log('\n=== STAGING SETUP COMPLETE ===');
  console.log('Web service ID:', webSvc.id);
  console.log('DB service ID:', dbSvc.id);
  console.log('\nNext steps:');
  console.log('1. Railway dashboard → flightslate-staging → Settings → Networking → add custom domain staging.newtechaviation.com');
  console.log('2. Namecheap: CNAME staging → (Railway target from dashboard)');
  console.log('3. After first deploy: DATABASE_URL=<staging> node scripts/seed-test-users.js');
  console.log('4. Test: https://staging.newtechaviation.com/api/config → isStaging: true');
  console.log('\nWorkflow: push to `staging` branch to test; merge staging → main for production.');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
