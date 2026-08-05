'use strict';

const fs = require('fs');
const path = require('path');

function loadDotEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;

  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq === -1) return;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = val;
  });
}

function argValue(name) {
  const idx = process.argv.indexOf(name);
  return idx === -1 ? null : process.argv[idx + 1] || null;
}

function resolveBaseUrl(defaultBase = null) {
  return argValue('--base') || process.env.QA_BASE || defaultBase;
}

function isProductionBaseUrl(baseUrl) {
  if (!baseUrl) return false;
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === 'www.newtechaviation.com' || host === 'newtechaviation.com';
  } catch {
    return false;
  }
}

function requireEnv(name, purpose) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required${purpose ? ` for ${purpose}` : ''}`);
  }
  return value;
}

function optionalAdminCredentials() {
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    return [{ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }];
  }
  return [];
}

function requireAdminCredentials() {
  return {
    email: requireEnv('ADMIN_EMAIL', 'admin QA login'),
    password: requireEnv('ADMIN_PASSWORD', 'admin QA login'),
  };
}

function requireQaMutationSafety({ baseUrl, databaseUrl, scriptName }) {
  if (!databaseUrl) {
    throw new Error(`${scriptName}: DATABASE_URL is required; refusing to guess a database for a mutating QA script`);
  }
  requireApiMutationSafety({ baseUrl, scriptName });
}

function requireApiMutationSafety({ baseUrl, scriptName }) {
  if (process.env.ALLOW_QA_MUTATIONS !== 'true') {
    throw new Error(`${scriptName}: set ALLOW_QA_MUTATIONS=true to run mutating QA against an explicit non-production target`);
  }
  if (isProductionBaseUrl(baseUrl)) {
    throw new Error(`${scriptName}: refusing to run mutating QA against production (${baseUrl})`);
  }
}

module.exports = {
  argValue,
  isProductionBaseUrl,
  loadDotEnv,
  optionalAdminCredentials,
  requireAdminCredentials,
  requireEnv,
  requireApiMutationSafety,
  requireQaMutationSafety,
  resolveBaseUrl,
};
