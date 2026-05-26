/**
 * routes/leads.js — Discovery flight lead capture endpoints.
 * Owns: POST /api/leads (public form submission), GET/PATCH/DELETE /api/leads (admin/owner only).
 * Does NOT own: user authentication, aircraft/booking data, flight logs.
 */

const express = require('express');
const router = express.Router();
const { createLead, listLeads, updateLeadStatus } = require('../db/leads');
const { sendEmail } = require('../email-templates');
const { authenticateToken, requireRole } = require('../middleware/auth');

// In-memory IP rate limiter: 5 submissions per IP per hour
const ipSubmissions = new Map();
function checkIpRateLimit(ip) {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000; // 1 hour
  const max = 5;
  const attempts = (ipSubmissions.get(ip) || []).filter(t => now - t < windowMs);
  if (attempts.length >= max) return false;
  attempts.push(now);
  ipSubmissions.set(ip, attempts);
  return true;
}

// Prune stale IP entries hourly to avoid memory growth
setInterval(() => {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  for (const [ip, attempts] of ipSubmissions.entries()) {
    const fresh = attempts.filter(t => now - t < windowMs);
    if (fresh.length === 0) ipSubmissions.delete(ip);
    else ipSubmissions.set(ip, fresh);
  }
}, 60 * 60 * 1000);

const ADMIN_NOTIFY_EMAIL = process.env.ADMIN_NOTIFY_EMAIL || process.env.DATA_BACKUP_EMAIL || 'aviationnewtech@gmail.com';
const APP_URL = process.env.APP_URL || 'https://www.newtechaviation.com';
const LOGO_URL = 'https://pub-629428d185ca4960a0a73c850d32294b.r2.dev/company_96457/images/6131da51-11d1-4327-8e6f-470c3e242f0b.png';

/** HTML for the admin notification email */
function adminNotificationHtml(lead) {
  const esc = (s) => s ? String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '—';
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>New Discovery Flight Lead</title></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
        <tr><td style="background:#1B2A4A;padding:24px 32px;">
          <img src="${LOGO_URL}" alt="New Tech Aviation" style="height:48px;display:block;">
        </td></tr>
        <tr><td style="padding:32px;">
          <h2 style="color:#1B2A4A;margin:0 0 8px;">New Discovery Flight Request</h2>
          <p style="color:#666;margin:0 0 24px;">Someone just requested a discovery flight. Reach out within 24 hours.</p>
          <table width="100%" cellpadding="8" cellspacing="0" style="border-collapse:collapse;font-size:15px;">
            <tr style="border-bottom:1px solid #eee;"><td style="color:#888;width:140px;">Name</td><td style="color:#1B2A4A;font-weight:600;">${esc(lead.name)}</td></tr>
            <tr style="border-bottom:1px solid #eee;"><td style="color:#888;">Email</td><td><a href="mailto:${esc(lead.email)}" style="color:#F5A623;">${esc(lead.email)}</a></td></tr>
            <tr style="border-bottom:1px solid #eee;"><td style="color:#888;">Phone</td><td><a href="tel:${esc(lead.phone)}" style="color:#F5A623;">${esc(lead.phone)}</a></td></tr>
            <tr style="border-bottom:1px solid #eee;"><td style="color:#888;">Experience</td><td>${esc(lead.experience_level)}</td></tr>
            <tr style="border-bottom:1px solid #eee;"><td style="color:#888;">Preferred Date</td><td>${esc(lead.preferred_date)}</td></tr>
            <tr><td style="color:#888;vertical-align:top;padding-top:12px;">Message</td><td style="padding-top:12px;">${esc(lead.message)}</td></tr>
          </table>
          <div style="margin-top:28px;text-align:center;">
            <a href="${APP_URL}/app.html" style="display:inline-block;background:#F5A623;color:#1B2A4A;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:6px;font-size:15px;">Open FlightSlate Dashboard</a>
          </div>
        </td></tr>
        <tr><td style="background:#1B2A4A;padding:16px 32px;text-align:center;">
          <p style="color:rgba(255,255,255,0.5);font-size:12px;margin:0;">New Tech Aviation · Powered by FlightSlate</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** HTML for the confirmation email sent to the lead */
function leadConfirmationHtml(name) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Discovery Flight Request Received</title></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
        <tr><td style="background:#1B2A4A;padding:24px 32px;">
          <img src="${LOGO_URL}" alt="New Tech Aviation" style="height:48px;display:block;">
        </td></tr>
        <tr><td style="padding:40px 32px;text-align:center;">
          <div style="background:#F5A623;border-radius:50%;width:64px;height:64px;margin:0 auto 24px;display:flex;align-items:center;justify-content:center;">
            <span style="font-size:32px;">✈️</span>
          </div>
          <h2 style="color:#1B2A4A;margin:0 0 12px;">You're on the runway, ${esc(name)}!</h2>
          <p style="color:#555;font-size:16px;line-height:1.6;margin:0 0 24px;">Thanks for your interest in a discovery flight with <strong>New Tech Aviation</strong>. We've received your request and will reach out within <strong>24 hours</strong> to schedule your introductory flight.</p>
          <div style="background:#f8f9fc;border-left:4px solid #F5A623;border-radius:4px;padding:20px;text-align:left;margin:0 0 28px;">
            <p style="margin:0 0 8px;font-weight:600;color:#1B2A4A;">What to expect:</p>
            <ul style="margin:0;padding-left:20px;color:#555;line-height:1.8;">
              <li>30-minute introductory flight with a certified flight instructor</li>
              <li>No obligation — just come and experience flying</li>
              <li>All experience levels welcome, including complete beginners</li>
            </ul>
          </div>
          <p style="color:#888;font-size:14px;margin:0;">Questions? Reply to this email or call us directly.</p>
        </td></tr>
        <tr><td style="background:#1B2A4A;padding:16px 32px;text-align:center;">
          <p style="color:rgba(255,255,255,0.5);font-size:12px;margin:0;">New Tech Aviation · All experience levels welcome</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// POST /api/leads — public, no auth required
router.post('/', async (req, res) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';

  if (!checkIpRateLimit(ip)) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  const { name, email, phone, preferred_date, experience_level, message } = req.body;

  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required.' });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Valid email is required.' });
  if (!phone || !phone.trim()) return res.status(400).json({ error: 'Phone number is required.' });

  let lead;
  try {
    lead = await createLead({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      preferred_date: preferred_date || null,
      experience_level: experience_level || null,
      message: message ? message.trim() : null,
    });
  } catch (err) {
    console.error('[leads] DB insert error:', err.message);
    return res.status(500).json({ error: 'Could not save your request. Please try again.' });
  }

  // Fire-and-forget: notify admin, confirm to lead
  Promise.allSettled([
    sendEmail(
      ADMIN_NOTIFY_EMAIL,
      `New Discovery Flight Request — ${lead.name}`,
      adminNotificationHtml(lead),
      `New discovery flight lead:\nName: ${lead.name}\nEmail: ${lead.email}\nPhone: ${lead.phone}\nExperience: ${lead.experience_level || '—'}\nPreferred: ${lead.preferred_date || '—'}\nMessage: ${lead.message || '—'}`
    ),
    sendEmail(
      lead.email,
      'Discovery Flight Request Received — New Tech Aviation',
      leadConfirmationHtml(lead.name),
      `Hi ${lead.name},\n\nThanks for your interest in a discovery flight with New Tech Aviation! We'll reach out within 24 hours to schedule your introductory flight.\n\nWhat to expect:\n- 30-minute introductory flight with a certified instructor\n- No obligation\n- All experience levels welcome\n\nNew Tech Aviation`
    ),
  ]);

  return res.json({ success: true, lead_id: lead.id });
});

// GET /api/leads — admin/owner only
router.get('/', authenticateToken, requireRole('owner', 'admin'), async (req, res) => {
  try {
    const leads = await listLeads();
    return res.json({ leads });
  } catch (err) {
    console.error('[leads] list error:', err.message);
    return res.status(500).json({ error: 'Could not retrieve leads.' });
  }
});

// PATCH /api/leads/:id/status — admin/owner only
router.patch('/:id/status', authenticateToken, requireRole('owner', 'admin'), async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const validStatuses = ['new', 'contacted', 'booked', 'no_show', 'converted'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
  }
  try {
    const lead = await updateLeadStatus(Number(id), status);
    if (!lead) return res.status(404).json({ error: 'Lead not found.' });
    return res.json({ lead });
  } catch (err) {
    console.error('[leads] status update error:', err.message);
    return res.status(500).json({ error: 'Could not update status.' });
  }
});

// DELETE /api/leads/:id — admin/owner only
router.delete('/:id', authenticateToken, requireRole('owner', 'admin'), async (req, res) => {
  const db = require('../db/index');
  try {
    const id = parseInt(req.params.id);
    const result = await db.query('DELETE FROM discovery_flight_leads WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Lead not found.' });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[leads] delete error:', err.message);
    return res.status(500).json({ error: 'Could not delete lead.' });
  }
});

module.exports = router;
