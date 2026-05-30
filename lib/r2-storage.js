'use strict';

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { isStaging } = require('./app-env');

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
  let prefix = folder ? `${folder.replace(/\/+$/, '')}/` : '';
  if (isStaging()) prefix = `staging/${prefix}`;
  return `${prefix}${Date.now()}-${randomUUID().slice(0, 8)}-${safeName}`;
}

function getPublicUrl(key) {
  const base = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');
  if (!base) return null;
  return `${base}/${key}`;
}

function getUploadRoot() {
  return path.join(__dirname, '..', 'data', 'uploads');
}

function getAppBaseUrl() {
  const port = process.env.PORT || 3000;
  let base = process.env.APP_URL ? process.env.APP_URL.replace(/\/$/, '') : '';
  if (base) {
    try {
      const u = new URL(base);
      if (u.hostname === 'localhost' && u.port && String(u.port) !== String(port)) {
        u.port = String(port);
        return u.origin;
      }
    } catch { /* ignore */ }
  }
  // Staging custom domains may not be live yet — Railway public domain serves uploads reliably
  if (process.env.RAILWAY_PUBLIC_DOMAIN && isStaging()) {
    return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  }
  if (base) return base;
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  return `http://localhost:${port}`;
}

function uploadLocal(buffer, filename, opts = {}) {
  const key = buildObjectKey(filename, opts.folder);
  const fullPath = path.join(getUploadRoot(), key);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, buffer);
  return `${getAppBaseUrl()}/uploads/${key.replace(/\\/g, '/')}`;
}

/**
 * Upload a buffer to Cloudflare R2, or local disk when fallback is allowed.
 * Returns the public URL or null.
 */
async function uploadBuffer(buffer, filename, opts = {}) {
  const allowLocalFallback = opts.allowLocalFallback !== false;

  if (isConfigured()) {
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
      if (url) {
        console.log(`[r2] Uploaded ${key}: ${url}`);
        return url;
      }
      if (!allowLocalFallback) {
        console.error(`[r2] Upload ok but R2_PUBLIC_URL missing for ${filename}; local fallback disabled`);
        return null;
      }
      console.warn(`[r2] Upload ok but R2_PUBLIC_URL missing — falling back to local storage`);
    } catch (err) {
      if (!allowLocalFallback) {
        console.error(`[r2] Upload failed for ${filename}:`, err.message, '— local fallback disabled');
        return null;
      }
      console.error(`[r2] Upload failed for ${filename}:`, err.message, '— falling back to local storage');
    }
  } else if (!allowLocalFallback) {
    console.error(`[r2] Storage not configured for ${filename}; local fallback disabled`);
    return null;
  }

  try {
    const url = uploadLocal(buffer, filename, opts);
    console.log(`[upload-local] ${url}`);
    return url;
  } catch (err) {
    console.error(`[upload-local] Failed for ${filename}:`, err.message);
    return null;
  }
}

module.exports = { isConfigured, uploadBuffer, getPublicUrl, getUploadRoot };
