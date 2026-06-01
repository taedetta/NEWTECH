'use strict';

/**
 * Run full QA suite in a test/fix loop until clean or max iterations.
 * Usage: node scripts/full-role-qa-loop.js [--base https://www.newtechaviation.com] [--max 5]
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASE = process.argv.includes('--base')
  ? process.argv[process.argv.indexOf('--base') + 1]
  : 'https://www.newtechaviation.com';

const MAX = process.argv.includes('--max')
  ? parseInt(process.argv[process.argv.indexOf('--max') + 1], 10)
  : 5;

const env = {
  ...process.env,
  QA_BASE: BASE,
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'Frbaga12$$!!',
  TEST_USER_PASSWORD: process.env.TEST_USER_PASSWORD || 'TestPass123!',
};

const SUITES = [
  { name: 'comprehensive-qa', cmd: `node scripts/comprehensive-qa.js --base ${BASE}` },
  { name: 'full-beta-qa', cmd: `node scripts/full-beta-qa.js --base ${BASE}` },
  { name: 'user-flow-e2e', cmd: `node scripts/user-flow-e2e.js --base ${BASE}` },
  { name: 'aircraft-docs-api', cmd: `node scripts/e2e-aircraft-docs-api.js`, env: { QA_BASE: BASE } },
  { name: 'aircraft-docs-ui', cmd: `node scripts/e2e-aircraft-docs-ui.js`, env: { QA_BASE: BASE } },
];

function runSuite(suite) {
  console.log(`\n>>> Running ${suite.name}...`);
  try {
    execSync(suite.cmd, {
      stdio: 'inherit',
      env: { ...env, ...(suite.env || {}) },
      cwd: path.join(__dirname, '..'),
    });
    return { name: suite.name, ok: true };
  } catch {
    return { name: suite.name, ok: false };
  }
}

async function main() {
  console.log('Full role QA loop —', BASE, `(max ${MAX} iterations)`);
  let iteration = 0;
  let lastFailures = [];

  while (iteration < MAX) {
    iteration++;
    console.log('\n' + '='.repeat(60));
    console.log(`ITERATION ${iteration}/${MAX}`);
    console.log('='.repeat(60));

    const results = SUITES.map(runSuite);
    const failed = results.filter((r) => !r.ok).map((r) => r.name);
    lastFailures = failed;

    if (!failed.length) {
      console.log('\n✅ ALL SUITES PASSED — no failures remaining');
      const report = {
        base: BASE,
        iterations: iteration,
        status: 'pass',
        ts: new Date().toISOString(),
      };
      fs.writeFileSync(path.join(__dirname, '..', 'qa-report.json'), JSON.stringify(report, null, 2));
      process.exit(0);
    }

    console.log(`\n❌ Failed suites: ${failed.join(', ')}`);
    if (iteration < MAX) {
      console.log('Fixing issues and re-running...\n');
      // Brief pause for deploy if fixes were pushed externally
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  console.log('\n❌ QA loop exhausted — remaining failures:', lastFailures.join(', '));
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
