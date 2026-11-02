'use strict';

const { createZipFile, addBuffer } = require('./zip-archive');

/**
 * Build an in-memory ZIP from { name, content } entries.
 * @param {Array<{ name: string, content: string|Buffer }>} entries
 * @param {string|null} readme optional README.txt body
 */
function buildZipBuffer(entries, readme = null) {
  return new Promise((resolve, reject) => {
    const archive = createZipFile();
    const chunks = [];
    archive.outputStream.on('data', (c) => chunks.push(c));
    archive.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    archive.outputStream.on('error', reject);
    if (readme) addBuffer(archive, readme, 'README.txt');
    for (const e of entries) {
      addBuffer(archive, e.content, e.name);
    }
    archive.end();
  });
}

module.exports = { buildZipBuffer };
