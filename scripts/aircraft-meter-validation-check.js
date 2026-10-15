'use strict';

const assert = require('assert');
const { parseMeterReading, parseOptionalMeterReading, MAX_METER_READING } = require('../lib/aircraft-meter');

function ok(input, expected, field = 'hobbs') {
  const result = parseMeterReading(input, field);
  assert.strictEqual(result.error, undefined, `${input} should be valid`);
  assert.strictEqual(result.value, expected);
}

function bad(input, expectedError, field = 'hobbs') {
  const result = parseMeterReading(input, field);
  assert.strictEqual(result.value, undefined, `${input} should be invalid`);
  assert.strictEqual(result.error, expectedError);
}

ok(123.4, 123.4);
ok('123.4', 123.4);
ok(' 123.4 ', 123.4);
ok('.5', 0.5);
ok(String(MAX_METER_READING), MAX_METER_READING);

bad('', 'hobbs must be a valid number');
bad('12abc', 'hobbs must be a valid number');
bad('NaN', 'hobbs must be a valid number');
bad(Number.NaN, 'hobbs must be a valid number');
bad(Number.POSITIVE_INFINITY, 'hobbs must be a valid number');
bad(-0.1, 'hobbs cannot be negative');
bad(MAX_METER_READING + 0.1, 'hobbs exceeds maximum allowed value');
bad({}, 'tach must be a valid number', 'tach');

assert.deepStrictEqual(parseOptionalMeterReading(undefined, 'due_hobbs'), { provided: false, value: null });
assert.deepStrictEqual(parseOptionalMeterReading(null, 'due_hobbs'), { provided: true, value: null });
assert.deepStrictEqual(parseOptionalMeterReading('', 'due_hobbs'), { provided: true, value: null });
assert.deepStrictEqual(parseOptionalMeterReading('0', 'due_hobbs'), { provided: true, value: 0 });
assert.deepStrictEqual(parseOptionalMeterReading('12abc', 'due_hobbs'), {
  error: 'due_hobbs must be a valid number',
});

console.log('Aircraft meter validation checks passed');
