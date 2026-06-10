'use strict';
/**
 * Finish staging setup: fix staging Postgres, create web service, deploy, seed.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const TOKEN = process.env.RAILWAY_API_TOKEN;
const PROJECT_ID = '33507e47-1ddd-4db0-a42e-f8c818770dd7';
const ENV_ID = '709b9ddb-cc38-44bf-b533-d677ed619584';
const PROD_WEB = '8ab1e88f-75d5-4a39-a14a-3b036716011b';
const STAGING_DB = '1159c76d-017d-4361-91b4-65c4adf09856';
const NEWTECH = '84613839-88ec-475c-8267-bf7a97adc712';
const GITHUB_REPO = 'taedetta/NEWTECH';

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
  await gql('mutation($input: VariableUpsertInput!) { variableUpsert(input: $input) }', {
    input: { projectId: PROJECT_ID, environmentId: ENV_ID, serviceId, name, value: String(value), skipDeploys },
  });
}

async function findService(name) {
  const r = await gql(`query($id: String!) { project(id: $id) { services { edges { node { id name } } } } }`, { id: PROJECT_ID });
  return r.project?.services?.edges?.find((e) => e.node.name === name)?.node || null;
}

async function waitDeploy(serviceId, label) {
  for (let i = 0; i < 30; i++) {
    const r = await gql(`
      query($input: DeploymentListInput!, $first: Int) {
        deployments(input: $input, first: $first) { edges { node { status } } }
      }
    `, { input: { projectId: PROJECT_ID, serviceId }, first: 1 });
    const st = r.deployments?.edges?.[0]?.node?.status;
    console.log(`  [${label}] ${st}`);
    if (st === 'SUCCESS') return;
    if (st === 'FAILED' || st === 'CRASHED') throw new Error(`${label} deploy ${st}`);
    await sleep(10000);
  }
  throw new Error(`${label} timeout`);
}

(async () => {
  console.log('0. Disconnect duplicate NEWTECH from GitHub...');
  await gql(`
    mutation($environmentId: String!, $serviceId: String!, $input: ServiceInstanceUpdateInput!) {
      serviceInstanceUpdate(environmentId: $environmentId, serviceId: $serviceId, input: $input)
    }
  `, { environmentId: ENV_ID, serviceId: NEWTECH, input: { source: null } });

  console.log('1. Fix staging Postgres vars...');
  await upsertVar(STAGING_DB, 'POSTGRES_USER', 'postgres');
  await upsertVar(STAGING_DB, 'POSTGRES_DB', 'railway');
  await upsertVar(STAGING_DB, 'PGDATA', '/var/lib/postgresql/data/pgdata');
  const stagingDbUrl = 'postgresql://postgres:${{PGPASSWORD}}@flightslate-staging-db.railway.internal:5432/railway';
  await upsertVar(STAGING_DB, 'DATABASE_URL', stagingDbUrl);
  await gql('mutation($environmentId: String!, $serviceId: String!) { serviceInstanceDeployV2(environmentId: $environmentId, serviceId: $serviceId) }', {
    environmentId: ENV_ID, serviceId: STAGING_DB,
  });
  await waitDeploy(STAGING_DB, 'staging-db');

  console.log('2. Create staging web service...');
  let web = await findService('flightslate-staging');
  if (!web) {
    const created = await gql(
      'mutation($input: ServiceCreateInput!) { serviceCreate(input: $input) { id name } }',
      { input: { projectId: PROJECT_ID, name: 'flightslate-staging', environmentId: ENV_ID } }
    );
    web = created.serviceCreate;
    console.log('   Created empty service:', web.id);
    await sleep(3000);
  }

  await gql(`
    mutation($environmentId: String!, $serviceId: String!, $input: ServiceInstanceUpdateInput!) {
      serviceInstanceUpdate(environmentId: $environmentId, serviceId: $serviceId, input: $input)
    }
  `, {
    environmentId: ENV_ID,
    serviceId: web.id,
    input: {
      source: { repo: GITHUB_REPO, branch: 'staging' },
      buildCommand: 'npm install',
      startCommand: 'npm start',
      healthcheckPath: '/health',
    },
  });

  console.log('3. Set staging web env vars...');
  const prodVars = await gql(`
    query($projectId: String!, $environmentId: String!, $serviceId: String!) {
      variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
    }
  `, { projectId: PROJECT_ID, environmentId: ENV_ID, serviceId: PROD_WEB });

  const skip = (k) => k.startsWith('RAILWAY_') || k === 'DATABASE_URL' || k === 'APP_ENV' || k === 'APP_URL';
  for (const [k, v] of Object.entries(prodVars.variables || {})) {
    if (!skip(k)) await upsertVar(web.id, k, v);
  }
  await upsertVar(web.id, 'APP_ENV', 'staging');
  await upsertVar(web.id, 'APP_URL', 'https://flightslate-staging-production.up.railway.app');
  await upsertVar(web.id, 'DATABASE_URL', '${{flightslate-staging-db.DATABASE_URL}}');
  await upsertVar(web.id, 'NODE_ENV', 'production');

  console.log('4. Deploy staging web...');
  await gql('mutation($environmentId: String!, $serviceId: String!) { serviceInstanceDeployV2(environmentId: $environmentId, serviceId: $serviceId) }', {
    environmentId: ENV_ID, serviceId: web.id,
  });
  await waitDeploy(web.id, 'staging-web');

  const domains = await gql(`
    query($id: String!) {
      service(id: $id) { serviceInstances { edges { node { domains { serviceDomains { domain } } } } } }
    }
  `, { id: web.id });
  const domain = domains.service?.serviceInstances?.edges?.[0]?.node?.domains?.serviceDomains?.[0]?.domain;
  console.log('\nStaging URL:', domain ? `https://${domain}` : '(check Railway dashboard)');

  console.log('5. Seed staging test users (via TCP if available)...');
  const dbVars = await gql(`
    query($projectId: String!, $environmentId: String!, $serviceId: String!) {
      variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
    }
  `, { projectId: PROJECT_ID, environmentId: ENV_ID, serviceId: STAGING_DB });
  const dbUrl = dbVars.variables?.DATABASE_URL;
  if (dbUrl && dbUrl.startsWith('postgresql://')) {
    try {
      execSync('node scripts/seed-test-users.js', {
        stdio: 'inherit',
        env: { ...process.env, DATABASE_URL: dbUrl, APP_ENV: 'staging' },
        cwd: path.join(__dirname, '..'),
      });
    } catch (e) {
      console.warn('   Seed skipped (DB not reachable externally — run after TCP proxy):', e.message);
    }
  }

  console.log('\nDone. Staging service ID:', web.id);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
