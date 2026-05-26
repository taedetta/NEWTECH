'use strict';

const https = require('https');

const TOKEN = process.env.RAILWAY_API_TOKEN;
const PROJECT_ID = '33507e47-1ddd-4db0-a42e-f8c818770dd7';
const ENV_ID = '709b9ddb-cc38-44bf-b533-d677ed619584';
const OLD_DB_SERVICE = '7e6ece04-aed8-4711-9172-169d9761118c';

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
        const parsed = JSON.parse(d);
        if (parsed.errors?.length) reject(new Error(parsed.errors.map((e) => e.message).join('; ')));
        else resolve(parsed.data);
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  try {
    await gql('mutation($id: String!) { serviceDelete(id: $id) }', { id: OLD_DB_SERVICE });
    console.log('Deleted old postgres service');
  } catch (e) {
    console.warn('Delete old service:', e.message);
  }

  const created = await gql(
    'mutation($input: ServiceCreateInput!) { serviceCreate(input: $input) { id name } }',
    {
      input: {
        projectId: PROJECT_ID,
        name: 'flightslate-db',
        source: { image: 'ghcr.io/railwayapp-templates/postgres-ssl:16' },
      },
    }
  );
  const serviceId = created.serviceCreate.id;
  console.log('Created postgres-ssl service:', serviceId);

  await gql(
    'mutation($environmentId: String!, $serviceId: String!, $input: ServiceInstanceUpdateInput!) { serviceInstanceUpdate(environmentId: $environmentId, serviceId: $serviceId, input: $input) }',
    {
      environmentId: ENV_ID,
      serviceId,
      input: { mountPath: '/var/lib/postgresql/data' },
    }
  ).catch((e) => console.warn('mountPath update:', e.message));

  for (let i = 0; i < 12; i++) {
    await sleep(10000);
    const dep = await gql(
      'query($projectId: String!, $serviceId: String!) { deployments(input: { projectId: $projectId, serviceId: $serviceId }, first: 1) { edges { node { status } } } }',
      { projectId: PROJECT_ID, serviceId }
    );
    const status = dep.deployments.edges[0]?.node?.status;
    console.log(`Deploy status (${i + 1}/12):`, status);
    if (status === 'SUCCESS') break;
    if (status === 'FAILED' || status === 'CRASHED') throw new Error(`Postgres deploy ${status}`);
  }

  const vars = await gql(
    'query($projectId: String!, $environmentId: String!, $serviceId: String!) { variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) }',
    { projectId: PROJECT_ID, environmentId: ENV_ID, serviceId }
  );
  console.log('Postgres variables:', JSON.stringify(vars.variables, null, 2));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
