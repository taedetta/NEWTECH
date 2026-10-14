'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.html'), 'utf8');

for (const fn of [
  'canRemoveMissingHoursBooking',
  'missingHoursDeleteBtn',
  'removeMissingHoursBooking',
]) {
  assert.match(
    appHtml,
    new RegExp(`function\\s+${fn}\\s*\\(`),
    `Missing Hours helper ${fn} must be defined before loadMissingHours renders pending rows`
  );
}

assert.ok(
  appHtml.indexOf('function missingHoursDeleteBtn') < appHtml.indexOf('async function loadMissingHours'),
  'missingHoursDeleteBtn must be defined before loadMissingHours is called'
);

console.log('missing hours regression tests passed');
