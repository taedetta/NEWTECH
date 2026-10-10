'use strict';

const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('./jwt-secret');

const JWT_SECRET = getJwtSecret();

function passwordChangedValue(user) {
  if (!user || !user.password_changed_at) return null;
  const ms = new Date(user.password_changed_at).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function signAuthToken(user, opts = {}) {
  const payload = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  };
  const pwdAt = passwordChangedValue(user);
  if (pwdAt !== null) payload.pwd_at = pwdAt;
  return jwt.sign(payload, JWT_SECRET, { expiresIn: opts.expiresIn || '7d' });
}

function tokenMatchesPasswordVersion(decoded, user) {
  const pwdAt = passwordChangedValue(user);
  if (pwdAt === null) return true;
  return Number(decoded?.pwd_at) === pwdAt;
}

module.exports = {
  signAuthToken,
  tokenMatchesPasswordVersion,
};
