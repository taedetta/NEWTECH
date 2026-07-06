'use strict';

const path = require('path');

function createProjectPathError(code, message, statusCode) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = statusCode;
  return err;
}

function resolveProjectPath(projectRoot, requestedPath = '.', options = {}) {
  const { allowRoot = true } = options;
  const root = path.resolve(projectRoot);
  const input = requestedPath === undefined || requestedPath === null || requestedPath === ''
    ? '.'
    : requestedPath;

  if (typeof input !== 'string' || input.includes('\0')) {
    throw createProjectPathError('INVALID_PROJECT_PATH', 'Invalid project path', 400);
  }

  if (path.isAbsolute(input)) {
    throw createProjectPathError('ABSOLUTE_PROJECT_PATH', 'Access denied: absolute paths are not allowed', 403);
  }

  const fullPath = path.resolve(root, input);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  const isRoot = fullPath === root;

  if (!isRoot && !fullPath.startsWith(rootWithSep)) {
    throw createProjectPathError('OUTSIDE_PROJECT_ROOT', 'Access denied: path outside project root', 403);
  }

  if (isRoot && !allowRoot) {
    throw createProjectPathError('ROOT_PROJECT_PATH', 'Invalid project path', 400);
  }

  return {
    root,
    fullPath,
    relPath: isRoot ? '.' : path.relative(root, fullPath),
  };
}

function isProjectPathError(err) {
  return Boolean(err && (
    err.code === 'INVALID_PROJECT_PATH' ||
    err.code === 'ABSOLUTE_PROJECT_PATH' ||
    err.code === 'OUTSIDE_PROJECT_ROOT' ||
    err.code === 'ROOT_PROJECT_PATH'
  ));
}

module.exports = {
  resolveProjectPath,
  isProjectPathError,
};
