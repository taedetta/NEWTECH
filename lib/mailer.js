'use strict';

/**
 * Transactional email — Brevo REST API (preferred) or SMTP fallback.
 * Set BREVO_API_KEY + SMTP_FROM, or SMTP_HOST/USER/PASS.
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

async function sendViaBrevoApi({ to, subject, html, text }) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return null;

  const fromEmail = process.env.SMTP_FROM || process.env.EMAIL_FROM || 'aviationnewtech@gmail.com';
  const fromName = process.env.EMAIL_FROM_NAME || 'New Tech Aviation';

  const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify({
      sender: { name: fromName, email: fromEmail },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text || subject,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Brevo API ${resp.status}: ${err.slice(0, 300)}`);
  }
  console.log(`[email] Sent to ${to}: ${subject}`);
  return true;
}

async function sendViaSmtp({ to, subject, html, text }) {
  const tx = getTransporter();
  if (!tx) return null;

  const fromName = process.env.EMAIL_FROM_NAME || 'New Tech Aviation';
  const fromAddr = process.env.SMTP_FROM || process.env.EMAIL_FROM || process.env.SMTP_USER;
  const from = fromAddr.includes('<') ? fromAddr : `"${fromName}" <${fromAddr}>`;

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

async function sendMail({ to, subject, html, text }) {
  try {
    if (process.env.BREVO_API_KEY) {
      return await sendViaBrevoApi({ to, subject, html, text });
    }
    const smtp = await sendViaSmtp({ to, subject, html, text });
    if (smtp) return true;
    console.error('[email] Not configured — set BREVO_API_KEY or SMTP_HOST/SMTP_USER/SMTP_PASS');
    return false;
  } catch (err) {
    console.error('[email] sendMail error:', err.message);
    return false;
  }
}

module.exports = { sendMail, getTransporter };
