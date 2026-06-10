'use strict';
const https = require('https');
const TOKEN = process.env.RAILWAY_API_TOKEN;
const PROJECT_ID = '33507e47-1ddd-4db0-a42e-f8c818770dd7';
const ENV_ID = '709b9ddb-cc38-44bf-b533-d677ed619584';
const PROD_WEB = '8ab1e88f-75d5-4a39-a14a-3b036716011b';
const STAGING_WEB = '5f3e71e8-7fdf-4f08-b6ba-04a349e30264';

function gql(query, variables) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, variables });
    const req = https.request({
      hostname: 'backboard.railway.com', path: '/graphql/v2', method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve(JSON.parse(d)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function stageAndCommit(patch, message) {
  await gql(
    'mutation($environmentId: String!, $input: EnvironmentConfig!) { environmentStageChanges(environmentId: $environmentId, input: $input) { id status } }',
    { environmentId: ENV_ID, input: patch }
  );
  await gql(
    'mutation($environmentId: String!, $patch: EnvironmentConfig!, $commitMessage: String) { environmentPatchCommit(environmentId: $environmentId, patch: $patch, commitMessage: $commitMessage) { id status } }',
    { environmentId: ENV_ID, patch, commitMessage: message }
  );
}

(async () => {
  const patch = {
    services: {
      [STAGING_WEB]: {
        isCreated: true,
        source: { repo: 'taedetta/NEWTECH', branch: 'staging' },
        buildCommand: 'npm install',
        startCommand: 'npm start',
        healthcheckPath: '/health',
      },
    },
  };
  console.log('Patch commit staging web...');
  const r = await stageAndCommit(patch, 'Connect staging branch to flightslate-staging');
  console.log(JSON.stringify(r, null, 2));

  const prodVars = await gql(`
    query($projectId: String!, $environmentId: String!, $serviceId: String!) {
      variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
    }
  `, { projectId: PROJECT_ID, environmentId: ENV_ID, serviceId: PROD_WEB });

  const vars = { ...prodVars.data?.variables || prodVars.variables };
  vars.APP_ENV = 'staging';
  vars.APP_URL = 'https://flightslate-staging-production.up.railway.app';
  vars.DATABASE_URL = '${{flightslate-staging-db.DATABASE_URL}}';
  delete vars.RAILWAY_PUBLIC_DOMAIN;
  delete vars.RAILWAY_STATIC_URL;

  console.log('Set vars...');
  await gql('mutation($input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $input) }', {
    input: { projectId: PROJECT_ID, environmentId: ENV_ID, serviceId: STAGING_WEB, variables: vars, replace: true },
  });

  console.log('Deploy...');
  const dep = await gql('mutation($environmentId: String!, $serviceId: String!) { serviceInstanceDeployV2(environmentId: $environmentId, serviceId: $serviceId) }', {
    environmentId: ENV_ID, serviceId: STAGING_WEB,
  });
  console.log(dep);

  for (let i = 0; i < 30; i++) {
    await sleep(10000);
    const s = await gql(`
      query($input: DeploymentListInput!, $first: Int) {
        deployments(input: $input, first: $first) { edges { node { status } } }
      }
    `, { input: { projectId: PROJECT_ID, serviceId: STAGING_WEB }, first: 1 });
    const st = s.data?.deployments?.edges?.[0]?.node?.status;
    console.log('status:', st);
    if (st === 'SUCCESS') break;
    if (st === 'FAILED' || st === 'CRASHED') process.exit(1);
  }
})().catch((e) => console.error(e));
