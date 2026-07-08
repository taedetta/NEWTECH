'use strict';

const { sendEmail } = require('../email-templates');
const { getPrefs } = require('../db/notification-prefs');
const { buildUnsubscribeUrl, buildManagePrefsUrl, typeLabel } = require('./unsubscribe-token');
const { EMAIL_TYPES, TYPE_LABELS, TYPE_CATEGORIES } = require('./email-types');

const REQUIRED_EMAIL_TYPES = new Set([
  EMAIL_TYPES.password_reset,
]);

function isRequiredEmailType(type) {
  return REQUIRED_EMAIL_TYPES.has(type);
}

function getPreferenceCatalog(role, isInstructor) {
  const visible = new Set(TYPE_CATEGORIES.flatMap((c) => c.types));
  for (const type of REQUIRED_EMAIL_TYPES) visible.delete(type);
  if (role !== 'instructor' && !isInstructor) {
    visible.delete('instructor_briefing');
  }
  if (!['owner', 'admin', 'instructor', 'maintenance'].includes(role) && !isInstructor) {
    visible.delete('maintenance_alert');
  }
  return TYPE_CATEGORIES.map((cat) => ({
    id: cat.id,
    label: cat.label,
    types: cat.types
      .filter((key) => visible.has(key))
      .map((key) => ({ key, label: TYPE_LABELS[key] })),
  })).filter((cat) => cat.types.length > 0);
}

function appendUnsubscribeFooter(html, text, userId, emailType) {
  if (!userId || !emailType || !EMAIL_TYPES[emailType] || isRequiredEmailType(emailType)) return { html, text };
  const unsubTypeUrl = buildUnsubscribeUrl(userId, emailType);
  const unsubAllUrl = buildUnsubscribeUrl(userId, 'all');
  const manageUrl = buildManagePrefsUrl();
  const label = typeLabel(emailType);

  const footerHtml = `
              <div style="margin-top:28px;padding-top:20px;border-top:1px solid #e2e8f0;text-align:center;">
                <p style="margin:0 0 8px;font-size:12px;color:#94a3b8;line-height:1.6;">
                  You're receiving this because you have ${label} enabled.
                </p>
                <p style="margin:0;font-size:12px;color:#64748b;line-height:1.6;">
                  <a href="${unsubTypeUrl}" style="color:#64748b;text-decoration:underline;">Unsubscribe from this type</a>
                  &nbsp;·&nbsp;
                  <a href="${unsubAllUrl}" style="color:#64748b;text-decoration:underline;">Unsubscribe from all</a>
                  &nbsp;·&nbsp;
                  <a href="${manageUrl}" style="color:#0EA5E9;text-decoration:none;">Manage preferences</a>
                </p>
              </div>`;

  const footerText = `\n\n---\nUnsubscribe from ${label}: ${unsubTypeUrl}\nUnsubscribe from all emails: ${unsubAllUrl}\nManage preferences: ${manageUrl}`;
  const newText = text ? text + footerText : footerText.trim();

  if (!html) {
    return { html, text: newText };
  }

  let newHtml = html;
  if (html.includes('<!-- Footer -->')) {
    newHtml = html.replace('          <!-- Footer -->', `${footerHtml}\n          <!-- Footer -->`);
  } else if (html.includes('</body>')) {
    newHtml = html.replace('</body>', `${footerHtml}</body>`);
  } else {
    newHtml = html + footerHtml;
  }

  return { html: newHtml, text: newText };
}

async function shouldSendEmail(userId, type) {
  if (!userId || !type || !EMAIL_TYPES[type]) return true;
  if (isRequiredEmailType(type)) return true;
  try {
    const prefs = await getPrefs(userId);
    if (prefs.email_all_off) return false;
    return prefs[type] !== false;
  } catch (err) {
    console.error('[notification-prefs] shouldSendEmail error:', err.message);
    return true;
  }
}

async function sendEmailToUser(userId, to, type, subject, html, text, attachments, options) {
  if (userId && !(await shouldSendEmail(userId, type))) {
    console.log(`[email] Skipped ${type} for user ${userId} (preferences)`);
    return false;
  }
  const withFooter = appendUnsubscribeFooter(html, text, userId, type);
  return sendEmail(to, subject, withFooter.html, withFooter.text, attachments, options);
}

module.exports = {
  EMAIL_TYPES,
  TYPE_LABELS,
  TYPE_CATEGORIES,
  REQUIRED_EMAIL_TYPES,
  isRequiredEmailType,
  getPreferenceCatalog,
  appendUnsubscribeFooter,
  shouldSendEmail,
  sendEmailToUser,
};
