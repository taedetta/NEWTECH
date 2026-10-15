'use strict';

const assert = require('assert');
const {
  formatDateCT,
  formatDateLongCT,
  formatDateTimeCT,
  formatTimeCT,
} = require('../lib/timezone-ct');

assert.strictEqual(
  formatDateCT('2026-06-10'),
  '06/10/2026',
  'date-only DB values must not shift to the prior Eastern day'
);

assert.strictEqual(
  formatDateLongCT('2026-06-10'),
  'Wednesday, June 10, 2026',
  'long date-only DB values must preserve their calendar date'
);

assert.strictEqual(
  formatDateCT('2026-02-30'),
  '—',
  'invalid date-only strings should not normalize to a different date'
);

assert.strictEqual(
  formatTimeCT('2026-06-10T12:00:00Z'),
  '8:00 AM',
  'timestamp inputs should still format in Eastern time'
);

assert.match(
  formatDateTimeCT('2026-06-10T12:00:00Z'),
  /^06\/10\/2026, 8:00 AM$/,
  'timestamp date-times should still format in Eastern time'
);

console.log('timezone formatting regression tests passed');
