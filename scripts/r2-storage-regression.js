'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  getUploadRoot,
  isLocalFallbackAllowed,
  uploadBuffer,
} = require('../lib/r2-storage');

const ENV_KEYS = [
  'APP_ENV',
  'NODE_ENV',
  'RAILWAY_ENVIRONMENT',
  'RAILWAY_SERVICE_ID',
  'RAILWAY_PROJECT_ID',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
  'R2_PUBLIC_URL',
];

function applyEnv(overrides) {
  const oldEnv = {};
  for (const key of ENV_KEYS) {
    oldEnv[key] = process.env[key];
    if (Object.prototype.hasOwnProperty.call(overrides, key)) {
      if (overrides[key] === undefined) delete process.env[key];
      else process.env[key] = overrides[key];
    } else {
      delete process.env[key];
    }
  }
  return () => {
    for (const key of ENV_KEYS) {
      if (oldEnv[key] === undefined) delete process.env[key];
      else process.env[key] = oldEnv[key];
    }
  };
}

async function withEnv(overrides, fn) {
  const restore = applyEnv(overrides);
  try {
    await fn();
  } finally {
    restore();
  }
}

(async () => {
  await withEnv({
    NODE_ENV: 'production',
    APP_ENV: 'staging',
    RAILWAY_ENVIRONMENT: 'staging',
  }, async () => {
    assert.strictEqual(isLocalFallbackAllowed(), false);
    const url = await uploadBuffer(Buffer.from('secret'), 'backup.pdf', { folder: 'backups' });
    assert.strictEqual(url, null);
  });

  await withEnv({
    NODE_ENV: 'development',
  }, async () => {
    assert.strictEqual(isLocalFallbackAllowed(), true);
    const folder = 'r2-storage-regression';
    const url = await uploadBuffer(Buffer.from('dev'), 'doc.pdf', { folder });
    assert.match(url, /\/uploads\/r2-storage-regression\//);
    fs.rmSync(path.join(getUploadRoot(), folder), { recursive: true, force: true });
  });

  console.log('r2-storage fallback regression checks passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
