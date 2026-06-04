'use strict';

const archiver = require('archiver');
const { PassThrough } = require('stream');

/**
 * Build an in-memory ZIP from { name, content } entries.
 * @param {Array<{ name: string, content: string|Buffer }>} entries
 * @param {string|null} readme optional README.txt body
 */
function buildZipBuffer(entries, readme = null) {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 6 } });
    const stream = new PassThrough();
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
    archive.on('error', reject);
    archive.pipe(stream);
    if (readme) archive.append(readme, { name: 'README.txt' });
    for (const e of entries) {
      archive.append(e.content ?? '', { name: e.name });
    }
    archive.finalize();
  });
}

module.exports = { buildZipBuffer };
