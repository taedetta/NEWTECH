'use strict';

const crypto = require('crypto');

const fallbackSecret = crypto.randomBytes(64).toString('hex');

if (!process.env.JWT_SECRET) {
  console.warn('[auth] JWT_SECRET is not set; using an ephemeral per-process secret');
}

function getJwtSecret() {
  return process.env.JWT_SECRET || fallbackSecret;
}

module.exports = { getJwtSecret };
