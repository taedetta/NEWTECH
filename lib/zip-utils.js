'use strict';

const yazl = require('yazl');

function normalizeZipPath(name) {
  const normalized = String(name || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.split('/').some(part => part === '..')) {
    throw new Error(`Invalid ZIP entry path: ${name}`);
  }
  return normalized;
}

function createZip() {
  return new yazl.ZipFile();
}

function addBuffer(zip, content, name) {
  const buffer = Buffer.isBuffer(content)
    ? content
    : Buffer.from(content == null ? '' : String(content), 'utf8');
  zip.addBuffer(buffer, normalizeZipPath(name));
}

function addFile(zip, filePath, name) {
  zip.addFile(filePath, normalizeZipPath(name));
}

function buildZipBuffer(entries, readme = null) {
  return new Promise((resolve, reject) => {
    const zip = createZip();
    const chunks = [];

    zip.outputStream.on('data', (chunk) => chunks.push(chunk));
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    zip.outputStream.on('error', reject);

    try {
      if (readme) addBuffer(zip, readme, 'README.txt');
      for (const entry of entries) {
        addBuffer(zip, entry.content ?? '', entry.name);
      }
      zip.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  createZip,
  addBuffer,
  addFile,
  buildZipBuffer,
};
