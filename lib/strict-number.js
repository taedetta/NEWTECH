'use strict';

function parseStrictNumber(value, fieldName, {
  required = true,
  min = 0,
  max = 99999,
  allowEmpty = false,
} = {}) {
  if (value === undefined || value === null || value === '') {
    if (!required || allowEmpty) return { value: null };
    return { error: `${fieldName} must be a number` };
  }

  const raw = typeof value === 'number' ? String(value) : String(value).trim();
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw)) {
    return { error: `${fieldName} must be a valid number` };
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return { error: `${fieldName} must be a valid number` };
  if (parsed < min) {
    return { error: min === 0 ? `${fieldName} cannot be negative` : `${fieldName} must be at least ${min}` };
  }
  if (parsed > max) return { error: `${fieldName} exceeds maximum allowed value` };
  return { value: parsed };
}

function parsePositiveNumber(value, fieldName, options = {}) {
  const parsed = parseStrictNumber(value, fieldName, options);
  if (parsed.error) return parsed;
  if (parsed.value == null) return parsed;
  if (parsed.value <= 0) return { error: `${fieldName} must be greater than 0` };
  return parsed;
}

module.exports = {
  parseStrictNumber,
  parsePositiveNumber,
};
