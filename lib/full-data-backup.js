'use strict';

/**
 * Full operational data backup — generates organized CSV ZIP and emails via Brevo.
 */
const archiver = require('archiver');
const { PassThrough } = require('stream');
const { generateAllCsvExports } = require('../export-service');
const { sendMail } = require('./mailer');

const DEFAULT_RECIPIENTS = [
  process.env.DATA_BACKUP_EMAIL || 'aviationnewtech@gmail.com',
  'aviationnewtech@gmail.com',
];

function uniqueRecipients(extra = []) {
  const all = [...DEFAULT_RECIPIENTS, ...extra].filter(Boolean);
  return [...new Set(all.map((e) => e.toLowerCase()))];
}

function buildZipBuffer(files, readme) {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 6 } });
    const stream = new PassThrough();
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
    archive.on('error', reject);
    archive.pipe(stream);
    archive.append(readme, { name: 'README.txt' });
    for (const f of files) {
      archive.append(f.csv || '', { name: `${f.folder}/${f.filename}` });
    }
    archive.finalize();
  });
}

function buildBackupEmail({ dateLabel, reason, triggeredBy, files, zipName }) {
  const generatedAt = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });
  const totalRecords = files.reduce((s, f) => s + (f.count || 0), 0);
  const reasonLabel = {
    scheduled: 'Scheduled backup',
    manual: 'Manual backup',
    'pre-reset': 'Pre-reset safety backup',
    nightly: 'Nightly export',
  }[reason] || reason || 'Data backup';

  const tableRows = files.map((f, i) => `
    <tr style="background:${i % 2 === 0 ? '#fff' : '#F9FAFB'}">
      <td style="padding:10px 16px;color:#374151;font-size:13px;">${f.folder}</td>
      <td style="padding:10px 16px;color:#374151;font-size:13px;font-family:monospace;font-size:12px;">${f.filename}</td>
      <td style="padding:10px 16px;color:#2563EB;font-size:13px;text-align:right;">${Number(f.count || 0).toLocaleString()}</td>
    </tr>`).join('');

  const subject = `New Tech Aviation — Complete Data Backup — ${dateLabel}`;
  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f6f9;font-family:Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:32px 0;">
<tr><td align="center">
<table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#fff;border-radius:10px;overflow:hidden;">
<tr><td style="background:#0F1D2F;padding:24px 32px;">
<p style="margin:0;color:#fff;font-size:20px;font-weight:bold;">✈ New Tech Aviation — Data Backup</p>
<p style="margin:4px 0 0;color:#38BDF8;font-size:13px;">Complete operational records export</p>
</td></tr>
<tr><td style="padding:32px;">
<h2 style="margin:0 0 8px;color:#0F1D2F;font-size:22px;">${reasonLabel}</h2>
<p style="margin:0 0 4px;color:#6B7280;font-size:13px;">Export date: <strong>${dateLabel}</strong></p>
<p style="margin:0 0 4px;color:#6B7280;font-size:13px;">Generated: <strong>${generatedAt} CT</strong></p>
${triggeredBy ? `<p style="margin:0 0 20px;color:#6B7280;font-size:13px;">Triggered by: <strong>${triggeredBy}</strong></p>` : '<p style="margin:0 0 20px;"></p>'}
<p style="color:#374151;font-size:15px;margin:0 0 16px;">Attached ZIP contains <strong>${files.length} organized CSV files</strong> (${totalRecords.toLocaleString()} total records). Full history — no date filtering.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5E7EB;border-radius:8px;overflow:hidden;margin-bottom:20px;">
<tr style="background:#0F1D2F;">
<td style="padding:12px 16px;font-weight:bold;color:#fff;font-size:13px;">Category</td>
<td style="padding:12px 16px;font-weight:bold;color:#fff;font-size:13px;">File</td>
<td style="padding:12px 16px;font-weight:bold;color:#fff;font-size:13px;text-align:right;">Records</td>
</tr>
${tableRows}
</table>
<p style="margin:0;color:#64748b;font-size:13px;">Attachment: <strong>${zipName}</strong></p>
</td></tr>
<tr><td style="background:#0F1D2F;padding:20px 32px;">
<p style="margin:0;color:#9CA3AF;font-size:12px;">New Tech Aviation · KPSK · Dublin, Virginia</p>
</td></tr>
</table>
</td></tr>
</table></body></html>`;

  const text = `${subject}\nGenerated: ${generatedAt} CT\nReason: ${reasonLabel}\n`
    + `Attachment: ${zipName}\n\n`
    + files.map((f) => `${f.folder}/${f.filename}: ${f.count || 0} records`).join('\n');

  return { subject, html, text };
}

/**
 * Generate full CSV backup ZIP and email to configured recipients.
 * Returns { ok, dateLabel, files, recipients, zipName }.
 */
async function emailFullDataBackup(pool, { reason = 'manual', triggeredBy = null, recipients = [] } = {}) {
  const { dateLabel, files } = await generateAllCsvExports(pool);
  const zipName = `NTA_Data_Backup_${dateLabel.replace(/-/g, '')}.zip`;
  const readme = [
    'New Tech Aviation — Complete Data Backup',
    `Generated: ${new Date().toISOString()}`,
    `Reason: ${reason}`,
    triggeredBy ? `Triggered by: ${triggeredBy}` : '',
    '',
    'Folder structure:',
    ...files.map((f) => `  ${f.folder}/${f.filename} (${f.count || 0} records)`),
    '',
    'Categories:',
    '  STUDENTS           — All user accounts',
    '  FLIGHT_LOGS        — Every flight log entry',
    '  HOURS_RECORDS      — Hobbs/Tach hours per flight',
    '  MAINTENANCE_SQUAWKS— Aircraft squawks/discrepancies',
    '  BILLING            — All charges (flights + ground)',
    '  INSTRUCTOR_HOURS   — Instructor billing hours',
    '  ENDORSEMENTS       — FAA endorsements',
    '  STUDENT_HOURS      — Per-student hour totals',
    '  STUDENT_PROGRESS   — Training program progress',
  ].filter(Boolean).join('\n');

  const zipBuffer = await buildZipBuffer(files, readme);
  const email = buildBackupEmail({ dateLabel, reason, triggeredBy, files, zipName });
  const toList = uniqueRecipients(recipients);
  let sent = 0;

  for (const to of toList) {
    const ok = await sendMail({
      to,
      subject: email.subject,
      html: email.html,
      text: email.text,
      attachments: [{ name: zipName, content: zipBuffer }],
    });
    if (ok) sent++;
  }

  if (sent === 0) {
    throw new Error('Failed to send backup email — check BREVO_API_KEY or SMTP settings');
  }

  console.log(`[backup-email] Sent ${zipName} to ${sent} recipient(s) (${reason})`);
  return { ok: true, dateLabel, files, recipients: toList, zipName, sent };
}

module.exports = { emailFullDataBackup, DEFAULT_RECIPIENTS };
