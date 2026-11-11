'use strict';

const yazl = require('yazl');

function normalizeZipPath(name) {
  const normalized = String(name || 'file').replace(/\\/g, '/').replace(/^\/+/, '');
  return normalized || 'file';
}

function createZipFile() {
  return new yazl.ZipFile();
}

function addFileToZip(zipfile, filePath, name) {
  zipfile.addFile(filePath, normalizeZipPath(name));
}

function addBufferToZip(zipfile, content, name) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content ?? '', 'utf8');
  zipfile.addBuffer(buffer, normalizeZipPath(name));
}

function buildZipBuffer(entries, readme = null) {
  return new Promise((resolve, reject) => {
    const zipfile = createZipFile();
    const chunks = [];

    zipfile.outputStream.on('data', (chunk) => chunks.push(chunk));
    zipfile.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    zipfile.outputStream.on('error', reject);

    if (readme) addBufferToZip(zipfile, readme, 'README.txt');
    for (const entry of entries) {
      addBufferToZip(zipfile, entry.content, entry.name);
    }
    zipfile.end();
  });
}

module.exports = {
  createZipFile,
  addFileToZip,
  addBufferToZip,
  buildZipBuffer,
};
