'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const r2EnvVars = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
  'R2_PUBLIC_URL',
];

for (const key of r2EnvVars) delete process.env[key];
process.env.APP_URL = 'http://localhost:3000';

const { getUploadRoot, uploadBuffer } = require('../lib/r2-storage');

async function main() {
  const uploadRoot = getUploadRoot();
  const deniedFolder = 'test-no-local-fallback';
  const allowedFolder = 'test-local-fallback';
  const deniedPath = path.join(uploadRoot, deniedFolder);
  const allowedPath = path.join(uploadRoot, allowedFolder);

  fs.rmSync(deniedPath, { recursive: true, force: true });
  fs.rmSync(allowedPath, { recursive: true, force: true });

  const deniedUrl = await uploadBuffer(Buffer.from('durable only'), 'denied.txt', {
    folder: deniedFolder,
    allowLocalFallback: false,
  });

  assert.strictEqual(deniedUrl, null, 'durable-only upload should fail without R2');
  assert.strictEqual(fs.existsSync(deniedPath), false, 'durable-only upload must not write local files');

  const allowedUrl = await uploadBuffer(Buffer.from('local ok'), 'allowed.txt', {
    folder: allowedFolder,
    allowLocalFallback: true,
  });

  assert(allowedUrl && allowedUrl.includes(`/uploads/${allowedFolder}/`), 'local fallback should return an upload URL');
  assert(fs.existsSync(allowedPath), 'local fallback should write a local file');

  fs.rmSync(allowedPath, { recursive: true, force: true });
  console.log('r2-storage fallback checks passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
