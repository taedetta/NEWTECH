'use strict';

/**
 * Cloudflare Turnstile CAPTCHA verification.
 * Enabled when TURNSTILE_SECRET_KEY is set (all environments).
 * Set CAPTCHA_ENABLED=false to disable without removing keys.
 */

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

function isCaptchaEnabled() {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return false;
  if (process.env.CAPTCHA_ENABLED === 'false') return false;
  return true;
}

function getTurnstileSiteKey() {
  return process.env.TURNSTILE_SITE_KEY || '';
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || '';
}

async function verifyTurnstileToken(token, remoteIp) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { success: true, skipped: true };

  const body = new URLSearchParams({
    secret,
    response: token,
  });
  if (remoteIp) body.set('remoteip', remoteIp);

  const res = await fetch(TURNSTILE_VERIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await res.json().catch(() => ({}));
  return {
    success: !!data.success,
    errorCodes: data['error-codes'] || [],
  };
}

/** Returns false and sends JSON error if captcha fails. */
async function enforceCaptcha(req, res) {
  if (!isCaptchaEnabled()) return true;

  const token = req.body?.captchaToken;
  if (!token || typeof token !== 'string') {
    res.status(400).json({
      error: 'Captcha verification required. Please complete the security check and try again.',
    });
    return false;
  }

  try {
    const result = await verifyTurnstileToken(token, getClientIp(req));
    if (!result.success) {
      console.warn('[captcha] verification failed:', result.errorCodes?.join(', ') || 'unknown');
      res.status(400).json({
        error: 'Captcha verification failed. Please try again.',
      });
      return false;
    }
    return true;
  } catch (err) {
    console.error('[captcha] verify error:', err.message);
    res.status(503).json({ error: 'Security check unavailable. Please try again shortly.' });
    return false;
  }
}

module.exports = {
  isCaptchaEnabled,
  getTurnstileSiteKey,
  verifyTurnstileToken,
  enforceCaptcha,
};
