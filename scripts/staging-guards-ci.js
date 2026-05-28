#!/usr/bin/env node
'use strict';

const assert = require('assert');

process.env.APP_ENV = 'staging';

const { runPreflightReminders } = require('../lib/preflight-reminders');

async function main() {
  let queried = false;
  const fakePool = {
    async query() {
      queried = true;
      throw new Error('staging guard should skip database queries');
    },
  };

  const result = await runPreflightReminders(fakePool);
  assert.deepStrictEqual(result, { sent: 0, errors: 0, skipped: true });
  assert.strictEqual(queried, false, 'staging reminder guard must not touch the database');

  console.log('staging guard tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
