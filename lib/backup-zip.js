'use strict';

const yazl = require('yazl');

/**
 * Build an in-memory ZIP from { name, content } entries.
 * @param {Array<{ name: string, content: string|Buffer }>} entries
 * @param {string|null} readme optional README.txt body
 */
function buildZipBuffer(entries, readme = null) {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    const chunks = [];
    zip.outputStream.on('data', (c) => chunks.push(c));
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    zip.outputStream.on('error', reject);
    if (readme) zip.addBuffer(Buffer.from(readme), 'README.txt');
    for (const e of entries) {
      const content = Buffer.isBuffer(e.content) ? e.content : Buffer.from(String(e.content ?? ''));
      zip.addBuffer(content, e.name);
    }
    zip.end();
  });
}

module.exports = { buildZipBuffer };
