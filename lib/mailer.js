'use strict';

/**
 * Transactional email via SMTP (Brevo, Gmail, etc.) — no Polsia required.
 * Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and optionally SMTP_FROM.
 */
const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  transporter = nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user, pass },
  });
  return transporter;
}

async function sendMail({ to, subject, html, text }) {
  const tx = getTransporter();
  if (!tx) {
    console.error('[email] SMTP not configured — set SMTP_HOST, SMTP_USER, SMTP_PASS');
    return false;
  }
  const fromName = process.env.EMAIL_FROM_NAME || 'New Tech Aviation';
  const fromAddr = process.env.SMTP_FROM || process.env.EMAIL_FROM || userFromEnv();
  const from = fromAddr.includes('<')
    ? fromAddr
    : `"${fromName}" <${fromAddr}>`;

  await tx.sendMail({
    from,
    to,
    subject,
    html,
    text: text || subject.replace(/<[^>]+>/g, ''),
  });
  console.log(`[email] Sent to ${to}: ${subject}`);
  return true;
}

function userFromEnv() {
  return process.env.SMTP_USER;
}

module.exports = { sendMail, getTransporter };
