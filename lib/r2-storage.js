'use strict';

const { randomUUID } = require('crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const CONTENT_TYPES = {
  pdf: 'application/pdf',
  csv: 'text/csv',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

function isConfigured() {
  return !!(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET &&
    process.env.R2_PUBLIC_URL
  );
}

function getClient() {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

function guessContentType(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  return CONTENT_TYPES[ext] || 'application/octet-stream';
}

function buildObjectKey(filename, folder) {
  const safeName = (filename || 'file').replace(/[^\w.-]+/g, '_');
  const prefix = folder ? `${folder.replace(/\/+$/, '')}/` : '';
  return `${prefix}${Date.now()}-${randomUUID().slice(0, 8)}-${safeName}`;
}

function getPublicUrl(key) {
  const base = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');
  if (!base) return null;
  return `${base}/${key}`;
}

/**
 * Upload a buffer to Cloudflare R2. Returns the public URL or null.
 */
async function uploadBuffer(buffer, filename, opts = {}) {
  if (!isConfigured()) {
    console.error('[r2] Not configured — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL');
    return null;
  }

  const key = buildObjectKey(filename, opts.folder);
  const contentType = opts.contentType || guessContentType(filename);

  try {
    await getClient().send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }));
    const url = getPublicUrl(key);
    console.log(`[r2] Uploaded ${key}: ${url}`);
    return url;
  } catch (err) {
    console.error(`[r2] Upload failed for ${filename}:`, err.message);
    return null;
  }
}

module.exports = { isConfigured, uploadBuffer, getPublicUrl };
