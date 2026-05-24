'use strict';

// In-memory rate limiter for password reset requests: max 3 per email per hour
const passwordResetRateLimit = new Map();

function checkPasswordResetRateLimit(email) {
  const key = email.toLowerCase().trim();
  const now = Date.now();
  const windowMs = 60 * 60 * 1000; // 1 hour
  const maxRequests = 3;
  const attempts = (passwordResetRateLimit.get(key) || []).filter(t => now - t < windowMs);
  if (attempts.length >= maxRequests) return false;
  attempts.push(now);
  passwordResetRateLimit.set(key, attempts);
  return true;
}

// Prune stale entries every hour to avoid memory growth
setInterval(() => {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  for (const [key, attempts] of passwordResetRateLimit.entries()) {
    const fresh = attempts.filter(t => now - t < windowMs);
    if (fresh.length === 0) passwordResetRateLimit.delete(key);
    else passwordResetRateLimit.set(key, fresh);
  }
}, 60 * 60 * 1000);

module.exports = { checkPasswordResetRateLimit };