'use strict';

const { buildZipBuffer } = require('./zip-writer');

/**
 * Build an in-memory ZIP from { name, content } entries.
 * @param {Array<{ name: string, content: string|Buffer }>} entries
 * @param {string|null} readme optional README.txt body
 */
module.exports = { buildZipBuffer };
