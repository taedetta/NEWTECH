'use strict';

const assert = require('assert');
const path = require('path');
const { resolveProjectPath, isProjectPathError } = require('../lib/project-path');

const projectRoot = path.resolve('/workspace/project');

function expectPath(input, expectedRel, options) {
  const resolved = resolveProjectPath(projectRoot, input, options);
  assert.strictEqual(resolved.root, projectRoot);
  assert.strictEqual(resolved.relPath, expectedRel);
  assert.strictEqual(resolved.fullPath, expectedRel === '.'
    ? projectRoot
    : path.join(projectRoot, expectedRel));
}

function expectProjectPathError(input, code, options) {
  assert.throws(
    () => resolveProjectPath(projectRoot, input, options),
    (err) => isProjectPathError(err) && err.code === code
  );
}

expectPath('public/app.html', path.join('public', 'app.html'));
expectPath('public/../server.js', 'server.js');
expectPath('.', '.');

expectProjectPathError('../../etc/passwd', 'OUTSIDE_PROJECT_ROOT');
expectProjectPathError('../project-sibling/secrets.txt', 'OUTSIDE_PROJECT_ROOT');
expectProjectPathError('/workspace/project/public/app.html', 'ABSOLUTE_PROJECT_PATH');
expectProjectPathError('public/\0app.html', 'INVALID_PROJECT_PATH');
expectProjectPathError('.', 'ROOT_PROJECT_PATH', { allowRoot: false });

console.log('project path security tests passed');
