'use strict';
/**
 * Create (or reuse) a Cloudflare Turnstile widget and optionally push keys to Railway staging.
 *
 * Requires:
 *   CLOUDFLARE_API_TOKEN — with Turnstile Sites Write (+ Account Read recommended)
 *
 * Optional:
 *   CLOUDFLARE_ACCOUNT_ID — auto-detected from token if omitted
 *   TURNSTILE_WIDGET_NAME — default "FlightSlate Auth"
 *   RAILWAY_API_TOKEN — if set, updates staging TURNSTILE_* vars and redeploys
 */
const https = require('https');

const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const WIDGET_NAME = process.env.TURNSTILE_WIDGET_NAME || 'FlightSlate Auth';
const DOMAINS = (process.env.TURNSTILE_DOMAINS || [
  'newtechaviation.com',
  'www.newtechaviation.com',
  'staging.newtechaviation.com',
  'flightslate-staging-production.up.railway.app',
  'localhost',
].join(',')).split(',').map((d) => d.trim()).filter(Boolean);

const RAILWAY_TOKEN = process.env.RAILWAY_API_TOKEN;
const RAILWAY_PROJECT = '33507e47-1ddd-4db0-a42e-f8c818770dd7';
const RAILWAY_ENV = '709b9ddb-cc38-44bf-b533-d677ed619584';
const STAGING_WEB = '5f3e71e8-7fdf-4f08-b6ba-04a349e30264';

async function cf(path, { method = 'GET', body } = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!data.success) {
    const msg = (data.errors || []).map((e) => e.message).join('; ') || res.statusText;
    throw new Error(msg);
  }
  return data.result;
}

async function resolveAccountId() {
  if (ACCOUNT_ID) return ACCOUNT_ID;
  const accounts = await cf('/accounts');
  const list = Array.isArray(accounts) ? accounts : accounts?.result || [];
  if (!list.length) throw new Error('No Cloudflare accounts found for this token');
  if (list.length === 1) return list[0].id;
  const named = list.find((a) => /new tech|aviation|flightslate/i.test(a.name || ''));
  return (named || list[0]).id;
}

async function findOrCreateWidget(accountId) {
  const widgets = await cf(`/accounts/${accountId}/challenges/widgets?per_page=50`);
  const existing = (widgets || []).find((w) => w.name === WIDGET_NAME);
  if (existing) {
    const current = new Set((existing.domains || []).map((d) => d.toLowerCase()));
    const missing = DOMAINS.filter((d) => !current.has(d.toLowerCase()));
    if (missing.length) {
      const merged = [...new Set([...(existing.domains || []), ...DOMAINS])];
      console.log(`Updating widget domains (+${missing.join(', ')})`);
      await cf(`/accounts/${accountId}/challenges/widgets/${existing.sitekey}`, {
        method: 'PUT',
        body: { domains: merged },
      });
    }
    console.log(`Reusing existing widget "${WIDGET_NAME}" (${existing.sitekey})`);
    return existing;
  }

  console.log(`Creating Turnstile widget "${WIDGET_NAME}" for: ${DOMAINS.join(', ')}`);
  return cf(`/accounts/${accountId}/challenges/widgets`, {
    method: 'POST',
    body: {
      name: WIDGET_NAME,
      domains: DOMAINS,
      mode: 'managed',
    },
  });
}

async function getWidgetSecret(accountId, sitekey) {
  const detail = await cf(`/accounts/${accountId}/challenges/widgets/${sitekey}`);
  if (detail.secret) return detail.secret;

  console.log('Rotating widget secret to obtain a new secret key…');
  const rotated = await cf(`/accounts/${accountId}/challenges/widgets/${sitekey}/rotate_secret`, {
    method: 'POST',
    body: { invalidate_immediately: false },
  });
  if (!rotated.secret) throw new Error('Could not retrieve secret key from Cloudflare');
  return rotated.secret;
}

function railwayGql(query, variables) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, variables });
    const req = https.request({
      hostname: 'backboard.railway.com',
      path: '/graphql/v2',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RAILWAY_TOKEN}`,
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

async function pushToRailwayStaging(siteKey, secretKey) {
  for (const [name, value] of Object.entries({
    TURNSTILE_SITE_KEY: siteKey,
    TURNSTILE_SECRET_KEY: secretKey,
  })) {
    await railwayGql(
      'mutation($input: VariableUpsertInput!) { variableUpsert(input: $input) }',
      {
        input: {
          projectId: RAILWAY_PROJECT,
          environmentId: RAILWAY_ENV,
          serviceId: STAGING_WEB,
          name,
          value: String(value),
          skipDeploys: true,
        },
      }
    );
    console.log(`Railway staging: set ${name}`);
  }

  await railwayGql(
    'mutation($environmentId: String!, $serviceId: String!) { serviceInstanceDeployV2(environmentId: $environmentId, serviceId: $serviceId) }',
    { environmentId: RAILWAY_ENV, serviceId: STAGING_WEB }
  );
  console.log('Railway staging: redeploy queued');
}

(async () => {
  if (!TOKEN) {
    console.error(`
Missing CLOUDFLARE_API_TOKEN.

Create one in Cloudflare Dashboard:
  1. My Profile → API Tokens → Create Token
  2. Use template "Edit Turnstile" OR custom with:
     - Account → Turnstile → Edit
     - Account → Account Settings → Read
  3. Run:
     set CLOUDFLARE_API_TOKEN=your_token_here
     node scripts/cloudflare-setup-turnstile.js
`);
    process.exit(1);
  }

  const accountId = await resolveAccountId();
  console.log(`Cloudflare account: ${accountId}`);

  const widget = await findOrCreateWidget(accountId);
  const siteKey = widget.sitekey;
  const secretKey = await getWidgetSecret(accountId, siteKey);

  console.log('\nTurnstile widget ready:');
  console.log(`  Site key:   ${siteKey}`);
  console.log(`  Secret key: ${secretKey.slice(0, 8)}… (hidden)`);

  if (RAILWAY_TOKEN) {
    await pushToRailwayStaging(siteKey, secretKey);
  } else {
    console.log('\nSet RAILWAY_API_TOKEN to auto-push keys to staging, or add manually in Railway.');
  }
})().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
