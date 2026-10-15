'use strict';

const DECIMAL_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

function parseStrictNumber(value, fieldName, options = {}) {
  const {
    min = 0,
    max = 99999,
    allowBlank = false,
  } = options;

  if (value == null || value === '') {
    if (allowBlank) return { value: null };
    return { error: `${fieldName} is required` };
  }

  let num;
  if (typeof value === 'number') {
    num = value;
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      if (allowBlank) return { value: null };
      return { error: `${fieldName} is required` };
    }
    if (!DECIMAL_RE.test(trimmed)) {
      return { error: `${fieldName} must be a valid number` };
    }
    num = Number(trimmed);
  } else {
    return { error: `${fieldName} must be a valid number` };
  }

  if (!Number.isFinite(num)) return { error: `${fieldName} must be a valid number` };
  if (min != null && num < min) return { error: `${fieldName} cannot be less than ${min}` };
  if (max != null && num > max) return { error: `${fieldName} exceeds maximum allowed value` };
  return { value: num };
}

function parseStrictNumberOrThrow(value, fieldName, options = {}) {
  const parsed = parseStrictNumber(value, fieldName, options);
  if (parsed.error) {
    const err = new Error(parsed.error);
    err.statusCode = 400;
    throw err;
  }
  return parsed.value;
}

module.exports = {
  parseStrictNumber,
  parseStrictNumberOrThrow,
};
