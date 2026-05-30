'use strict';

const { spawn } = require('child_process');

const PORT = 3300 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const failures = [];

function fail(name, detail) {
  failures.push(`${name}: ${detail}`);
  console.log(`  FAIL ${name}: ${detail}`);
}

function ok(name) {
  console.log(`  OK ${name}`);
}

async function waitForHealth() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch (_) {
      // Server is still booting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('server did not become healthy');
}

async function expectUnauthorized(path, method = 'POST', body = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (res.status !== 401) {
    fail(`${method} ${path}`, `expected 401, got ${res.status}: ${text.slice(0, 160)}`);
    return;
  }
  ok(`${method} ${path} requires auth`);
}

async function main() {
  console.log('Training admin route smoke test');
  const child = spawn(process.execPath, ['server.js'], {
    cwd: `${__dirname}/..`,
    env: {
      ...process.env,
      PORT: String(PORT),
      DATABASE_URL: 'postgresql://127.0.0.1:1/nope',
      JWT_SECRET: 'training-admin-route-smoke',
      APP_ENV: 'staging',
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });

  try {
    await waitForHealth();
    await expectUnauthorized('/api/admin/training/programs', 'POST', { name: 'Smoke', code: 'SMK' });
    await expectUnauthorized('/api/admin/training/stages', 'POST', { program_id: 1, name: 'Stage' });
    await expectUnauthorized('/api/admin/training/stages/reorder', 'PUT', { stages: [] });
    await expectUnauthorized('/api/admin/training/maneuvers', 'POST', { stage_id: 1, name: 'Maneuver' });

    // Legacy paths remain registered for any older clients that used the router's /admin prefix.
    await expectUnauthorized('/api/admin/training/admin/programs', 'POST', { name: 'Smoke', code: 'SMK' });
  } finally {
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 2000).unref();
  }

  if (failures.length) {
    console.log('\nServer output:\n' + output.slice(-4000));
    process.exit(1);
  }
  console.log('All training admin route smoke tests passed');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
