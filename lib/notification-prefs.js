'use strict';

const { sendEmail } = require('../email-templates');
const { getPrefs } = require('../db/notification-prefs');
const { EMAIL_TYPES, TYPE_LABELS, TYPE_CATEGORIES, isRequiredEmailType } = require('./email-types');
const { appendUnsubscribeFooter } = require('./notification-footer');

function getPreferenceCatalog(role, isInstructor) {
  const visible = new Set(TYPE_CATEGORIES.flatMap((c) => c.types));
  if (role !== 'instructor' && !isInstructor) {
    visible.delete('instructor_briefing');
  }
  if (!['owner', 'admin', 'instructor', 'maintenance'].includes(role) && !isInstructor) {
    visible.delete('maintenance_alert');
  }
  for (const key of Object.keys(EMAIL_TYPES)) {
    if (isRequiredEmailType(key)) visible.delete(key);
  }
  return TYPE_CATEGORIES.map((cat) => ({
    id: cat.id,
    label: cat.label,
    types: cat.types
      .filter((key) => visible.has(key))
      .map((key) => ({ key, label: TYPE_LABELS[key] })),
  })).filter((cat) => cat.types.length > 0);
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
  getPreferenceCatalog,
  appendUnsubscribeFooter,
  shouldSendEmail,
  sendEmailToUser,
};
