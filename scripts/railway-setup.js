'use strict';

/**
 * Configure Railway project via GraphQL API (workspace/account token).
 * Usage: RAILWAY_API_TOKEN=... node scripts/railway-setup.js
 */

const https = require('https');

const TOKEN = process.env.RAILWAY_API_TOKEN || process.env.RAILWAY_TOKEN;
const PROJECT_ID = process.env.RAILWAY_PROJECT_ID || '33507e47-1ddd-4db0-a42e-f8c818770dd7';
const ENV_ID = process.env.RAILWAY_ENVIRONMENT_ID || '709b9ddb-cc38-44bf-b533-d677ed619584';
const SERVICE_ID = process.env.RAILWAY_SERVICE_ID || '84613839-88ec-475c-8267-bf7a97adc712';
const GITHUB_REPO = process.env.GITHUB_REPO || 'taedetta/NEWTECH';
const BRANCH = process.env.GITHUB_BRANCH || 'main';

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
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.errors?.length) {
            reject(new Error(parsed.errors.map((e) => e.message).join('; ')));
            return;
          }
          resolve(parsed.data);
        } catch (e) {
          reject(new Error(`Invalid JSON: ${raw.slice(0, 300)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function parseEnvFile(path) {
  const fs = require('fs');
  if (!fs.existsSync(path)) return {};
  const out = {};
  for (const line of fs.readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

async function main() {
  if (!TOKEN) throw new Error('RAILWAY_API_TOKEN required');

  const renderVars = process.env.RAILWAY_VARS_JSON
    ? JSON.parse(process.env.RAILWAY_VARS_JSON)
    : {};

  const local = parseEnvFile(require('path').join(__dirname, '..', '.env'));

  const vars = {
    NODE_ENV: 'production',
    APP_ENV: 'production',
    APP_URL: 'https://www.newtechaviation.com',
    DATA_BACKUP_EMAIL: 'aviationnewtech@gmail.com',
    ADMIN_NOTIFY_EMAIL: 'aviationnewtech@gmail.com',
    SMTP_FROM: local.SMTP_FROM || 'aviationnewtech@gmail.com',
    EMAIL_FROM_NAME: local.EMAIL_FROM_NAME || 'New Tech Aviation',
    BREVO_API_KEY: local.BREVO_API_KEY || renderVars.BREVO_API_KEY,
    SMTP_HOST: local.SMTP_HOST,
    SMTP_PORT: local.SMTP_PORT,
    SMTP_SECURE: local.SMTP_SECURE,
    SMTP_USER: local.SMTP_USER,
    SMTP_PASS: local.SMTP_PASS,
    DATABASE_URL: renderVars.DATABASE_URL,
    JWT_SECRET: renderVars.JWT_SECRET,
    R2_ACCOUNT_ID: renderVars.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: renderVars.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: renderVars.R2_SECRET_ACCESS_KEY,
    R2_BUCKET: renderVars.R2_BUCKET,
    R2_PUBLIC_URL: renderVars.R2_PUBLIC_URL || 'https://pub-629428d185ca4960a0a73c850d32294b.r2.dev',
    POLSIA_API_KEY: undefined,
    POLSIA_R2_BASE_URL: undefined,
  };

  Object.keys(vars).forEach((k) => vars[k] === undefined && delete vars[k]);

  if (!vars.DATABASE_URL) throw new Error('DATABASE_URL missing — pass via RAILWAY_VARS_JSON from Render');
  if (!vars.JWT_SECRET) throw new Error('JWT_SECRET missing — pass via RAILWAY_VARS_JSON from Render');

  console.log('Connecting GitHub repo...');
  try {
    await gql(
      `mutation($id: String!, $input: ServiceConnectInput!) {
        serviceConnect(id: $id, input: $input) { id }
      }`,
      { id: SERVICE_ID, input: { repo: GITHUB_REPO, branch: BRANCH } }
    );
    console.log('Repo connected:', GITHUB_REPO, BRANCH);
  } catch (err) {
    console.warn('serviceConnect:', err.message, '(may already be connected)');
  }

  console.log('Updating service instance settings...');
  await gql(
    `mutation($environmentId: String!, $serviceId: String!, $input: ServiceInstanceUpdateInput!) {
      serviceInstanceUpdate(environmentId: $environmentId, serviceId: $serviceId, input: $input) {
        id
      }
    }`,
    {
      environmentId: ENV_ID,
      serviceId: SERVICE_ID,
      input: {
        buildCommand: 'npm install && npm run migrate',
        startCommand: 'npm start',
        healthcheckPath: '/health',
        rootDirectory: null,
      },
    }
  );

  console.log('Setting environment variables...');
  await gql(
    `mutation($projectId: String!, $environmentId: String!, $serviceId: String!, $variables: EnvironmentVariables!) {
      variableCollectionUpsert(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId, variables: $variables, replace: false) {
        id
      }
    }`,
    {
      projectId: PROJECT_ID,
      environmentId: ENV_ID,
      serviceId: SERVICE_ID,
      variables: vars,
    }
  );
  console.log('Variables set:', Object.keys(vars).join(', '));

  console.log('Triggering deployment...');
  const deploy = await gql(
    `mutation($environmentId: String!, $serviceId: String!) {
      serviceInstanceDeployV2(environmentId: $environmentId, serviceId: $serviceId) {
        id status
      }
    }`,
    { environmentId: ENV_ID, serviceId: SERVICE_ID }
  );
  console.log('Deployment:', deploy.serviceInstanceDeployV2);
}

main().catch((err) => {
  console.error('Railway setup failed:', err.message);
  process.exit(1);
});
