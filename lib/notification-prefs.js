'use strict';

const { sendEmail } = require('../email-templates');
const { getPrefs } = require('../db/notification-prefs');

/** Optional email categories users may opt out of. Security/account emails must not use these. */
const EMAIL_TYPES = {
  booking_confirmation: 'booking_confirmation',
  booking_cancelled: 'booking_cancelled',
  preflight_reminder: 'preflight_reminder',
  flight_completed: 'flight_completed',
  instructor_briefing: 'instructor_briefing',
  endorsement_expiry: 'endorsement_expiry',
  maintenance_alert: 'maintenance_alert',
};

const TYPE_LABELS = {
  booking_confirmation: 'Booking confirmations',
  booking_cancelled: 'Booking cancellations',
  preflight_reminder: 'Pre-flight reminders (24 hours before)',
  flight_completed: 'Flight completed summaries',
  instructor_briefing: 'Daily instructor briefing',
  endorsement_expiry: 'Endorsement expiry alerts',
  maintenance_alert: 'Aircraft maintenance / grounding alerts',
};

async function shouldSendEmail(userId, type) {
  if (!userId || !type || !EMAIL_TYPES[type]) return true;
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
  return sendEmail(to, subject, html, text, attachments, options);
}

module.exports = {
  EMAIL_TYPES,
  TYPE_LABELS,
  shouldSendEmail,
  sendEmailToUser,
};
