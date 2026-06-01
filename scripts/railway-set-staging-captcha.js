'use strict';
/** Set Cloudflare Turnstile keys on staging web service only (not production). */
const https = require('https');

const TOKEN = process.env.RAILWAY_API_TOKEN;
const PROJECT_ID = '33507e47-1ddd-4db0-a42e-f8c818770dd7';
const ENV_ID = '709b9ddb-cc38-44bf-b533-d677ed619584';
const STAGING_WEB = '5f3e71e8-7fdf-4f08-b6ba-04a349e30264';

// Cloudflare Turnstile test keys — always pass (for staging verification)
const VARS = {
  TURNSTILE_SITE_KEY: process.env.TURNSTILE_SITE_KEY || '1x00000000000000000000AA',
  TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY || '1x0000000000000000000000000000000AA',
};

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

async function upsertVar(name, value) {
  await gql(
    'mutation($input: VariableUpsertInput!) { variableUpsert(input: $input) }',
    {
      input: {
        projectId: PROJECT_ID,
        environmentId: ENV_ID,
        serviceId: STAGING_WEB,
        name,
        value: String(value),
        skipDeploys: true,
      },
    }
  );
  console.log(`Set ${name} on staging`);
}

(async () => {
  if (!TOKEN) throw new Error('RAILWAY_API_TOKEN required');
  for (const [name, value] of Object.entries(VARS)) {
    await upsertVar(name, value);
  }
  console.log('Staging captcha env vars set (APP_ENV=staging enables captcha automatically).');
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
