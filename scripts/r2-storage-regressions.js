'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { uploadBuffer, getUploadRoot, isHostedRuntime } = require('../lib/r2-storage');

const ENV_KEYS = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
  'R2_PUBLIC_URL',
  'RAILWAY_ENVIRONMENT',
  'RENDER',
  'RENDER_SERVICE_ID',
  'FLY_APP_NAME',
  'APP_URL',
  'PORT',
];

function snapshotEnv() {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
  for (const key of ENV_KEYS) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
}

async function withEnv(overrides, fn) {
  const before = snapshotEnv();
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, overrides);
  try {
    return await fn();
  } finally {
    restoreEnv(before);
  }
}

function removeTestUploads() {
  fs.rmSync(path.join(getUploadRoot(), 'r2-storage-tests'), { recursive: true, force: true });
}

async function main() {
  removeTestUploads();

  await withEnv({
    RAILWAY_ENVIRONMENT: 'production',
    APP_URL: 'https://www.newtechaviation.com',
  }, async () => {
    assert.strictEqual(isHostedRuntime(), true, 'Railway must be treated as hosted');
    const url = await uploadBuffer(Buffer.from('hosted'), 'hosted.txt', {
      folder: 'r2-storage-tests',
      allowLocalUrl: true,
    });
    assert.strictEqual(url, null, 'hosted deployments must fail closed instead of returning local URLs');
    assert.strictEqual(
      fs.existsSync(path.join(getUploadRoot(), 'r2-storage-tests')),
      false,
      'hosted fail-closed path must not persist files to ephemeral disk'
    );
  });

  await withEnv({
    APP_URL: 'http://localhost:3333',
    PORT: '3333',
  }, async () => {
    assert.strictEqual(isHostedRuntime(), false, 'plain local dev must not be treated as hosted');
    const url = await uploadBuffer(Buffer.from('local'), 'local.txt', {
      folder: 'r2-storage-tests',
      allowLocalUrl: true,
    });
    assert.ok(url && url.startsWith('http://localhost:3333/uploads/r2-storage-tests/'), 'local dev can opt into local URLs');
  });

  await withEnv({
    APP_URL: 'http://localhost:3333',
    PORT: '3333',
  }, async () => {
    const url = await uploadBuffer(Buffer.from('attachment'), 'attachment.txt', {
      folder: 'r2-storage-tests',
    });
    assert.strictEqual(url, null, 'local dev without allowLocalUrl keeps attachment-only fallback behavior');
  });

  removeTestUploads();
  console.log('R2 storage fallback checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
