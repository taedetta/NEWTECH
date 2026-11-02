'use strict';

const yazl = require('yazl');

function createZipFile() {
  return new yazl.ZipFile();
}

function addBuffer(zip, content, name) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content ?? ''), 'utf8');
  zip.addBuffer(buffer, name);
}

function addFile(zip, filePath, name) {
  zip.addFile(filePath, name);
}

function pipeToResponse(zip, res, onError) {
  zip.outputStream.on('error', onError);
  zip.outputStream.pipe(res);
}

module.exports = {
  createZipFile,
  addBuffer,
  addFile,
  pipeToResponse,
};
