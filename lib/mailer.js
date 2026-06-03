'use strict';

const { isStaging } = require('./app-env');
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

async function sendViaBrevoApi({ to, subject, html, text, attachments }) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return null;

  const fromEmail = process.env.SMTP_FROM || process.env.EMAIL_FROM || 'aviationnewtech@gmail.com';
  const fromName = process.env.EMAIL_FROM_NAME || 'New Tech Aviation';

  const payload = {
    sender: { name: fromName, email: fromEmail },
    to: [{ email: to }],
    subject,
    htmlContent: html,
    textContent: text || subject,
  };
  if (attachments?.length) {
    payload.attachment = attachments.map((a) => ({
      content: Buffer.isBuffer(a.content) ? a.content.toString('base64') : Buffer.from(a.content).toString('base64'),
      name: a.name,
    }));
  }

  const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Brevo API ${resp.status}: ${err.slice(0, 300)}`);
  }
  console.log(`[email] Sent to ${to}: ${subject}`);
  return true;
}

async function sendViaSmtp({ to, subject, html, text, attachments }) {
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
    attachments: attachments?.map((a) => ({
      filename: a.name,
      content: a.content,
    })),
  });
  console.log(`[email] Sent to ${to}: ${subject}`);
  return true;
}

async function sendMail({ to, subject, html, text, attachments, deliverToRecipientOnStaging = false }) {
  let recipient = to;
  let finalSubject = subject;
  let finalHtml = html;

  // Staging: redirect most emails to admin sink — auth/password-reset goes to the real recipient for testing
  if (isStaging() && !deliverToRecipientOnStaging) {
    const sink = process.env.STAGING_EMAIL_SINK || process.env.ADMIN_NOTIFY_EMAIL || process.env.DATA_BACKUP_EMAIL;
    if (!sink) {
      console.log(`[email][staging] Blocked (no STAGING_EMAIL_SINK): ${to} — ${subject}`);
      return true;
    }
    finalSubject = `[STAGING] ${subject}`;
    finalHtml = `<div style="background:#fff3cd;border:1px solid #ffc107;padding:10px;margin-bottom:12px;font-family:sans-serif;font-size:13px;">
      <strong>Staging environment</strong> — this would have been sent to: <code>${to}</code>
    </div>${html || ''}`;
    recipient = sink;
    console.log(`[email][staging] Redirecting ${to} → ${sink}`);
  } else if (isStaging() && deliverToRecipientOnStaging) {
    finalSubject = `[STAGING] ${subject}`;
    console.log(`[email][staging] Direct delivery to ${to}`);
  }

  try {
    if (process.env.BREVO_API_KEY) {
      return await sendViaBrevoApi({ to: recipient, subject: finalSubject, html: finalHtml, text, attachments });
    }
    const smtp = await sendViaSmtp({ to: recipient, subject: finalSubject, html: finalHtml, text, attachments });
    if (smtp) return true;
    console.error('[email] Not configured — set BREVO_API_KEY or SMTP_HOST/SMTP_USER/SMTP_PASS');
    return false;
  } catch (err) {
    console.error('[email] sendMail error:', err.message);
    return false;
  }
}

module.exports = { sendMail, getTransporter };
