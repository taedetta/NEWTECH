'use strict';

const pool = require('../db/index');
const { bookingConfirmationEmail, flightCancelledEmail } = require('../email-templates');
const { sendEmailToUser, EMAIL_TYPES } = require('./notification-prefs');

async function fetchBookingEmailContext(db, bookingId) {
  const result = await (db || pool).query(
    `SELECT b.id, b.student_id, b.instructor_id, b.start_time, b.end_time,
            s.name AS student_name, s.email AS student_email,
            i.name AS instructor_name, i.email AS instructor_email,
            a.tail_number, a.make_model
     FROM bookings b
     LEFT JOIN users s ON b.student_id = s.id
     LEFT JOIN users i ON b.instructor_id = i.id
     JOIN aircraft a ON b.aircraft_id = a.id
     WHERE b.id = $1`,
    [bookingId]
  );
  return result.rows[0] || null;
}

/**
 * Send booking confirmation to student/renter and instructor (when assigned).
 */
async function sendBookingConfirmationEmails(bookingId, db) {
  const b = await fetchBookingEmailContext(db, bookingId);
  if (!b) return;

  const emailParams = {
    studentName: b.student_name || null,
    instructorName: b.instructor_name || null,
    aircraftTailNumber: b.tail_number || null,
    startTime: b.start_time,
    endTime: b.end_time,
  };

  const sends = [];

  if (b.student_email) {
    const tpl = bookingConfirmationEmail({
      ...emailParams,
      recipientName: b.student_name,
      isStudent: true,
    });
    sends.push(sendEmailToUser(
      b.student_id, b.student_email, EMAIL_TYPES.booking_confirmation,
      tpl.subject, tpl.html, tpl.text
    ));
  }

  if (b.instructor_email && b.instructor_id !== b.student_id) {
    const tpl = bookingConfirmationEmail({
      ...emailParams,
      recipientName: b.instructor_name,
      isStudent: false,
    });
    sends.push(sendEmailToUser(
      b.instructor_id, b.instructor_email, EMAIL_TYPES.booking_confirmation,
      tpl.subject, tpl.html, tpl.text
    ));
  } else if (b.instructor_email && !b.student_email) {
    const tpl = bookingConfirmationEmail({
      ...emailParams,
      recipientName: b.instructor_name,
      isStudent: false,
    });
    sends.push(sendEmailToUser(
      b.instructor_id, b.instructor_email, EMAIL_TYPES.booking_confirmation,
      tpl.subject, tpl.html, tpl.text
    ));
  }

  await Promise.allSettled(sends);

  const userIds = [b.student_id, b.instructor_id].filter(Boolean);
  try {
    const { notifyBookingConfirmed } = require('./app-notifications');
    await notifyBookingConfirmed(userIds, {
      tailNumber: b.tail_number,
      startTime: b.start_time,
    });
  } catch (_) { /* push optional */ }
}

/**
 * Send cancellation notice to all booking participants.
 */
async function sendBookingCancellationEmails(bookingId, cancelledById, cancelledByRole, cancellationReason, db) {
  const b = await fetchBookingEmailContext(db, bookingId);
  if (!b) return;

  const cancelledByName = await (db || pool).query('SELECT name FROM users WHERE id = $1', [cancelledById])
    .then((r) => r.rows[0]?.name || 'New Tech Aviation')
    .catch(() => 'New Tech Aviation');

  const baseParams = {
    studentName: b.student_name,
    instructorName: b.instructor_name,
    tailNumber: b.tail_number,
    makeModel: b.make_model,
    flightDate: b.start_time,
    startTime: b.start_time,
    endTime: b.end_time,
    cancelledBy: cancelledByName,
    cancelledByRole: cancelledByRole,
    cancellationReason: cancellationReason,
  };

  const sends = [];

  if (b.student_email) {
    const tpl = flightCancelledEmail({ ...baseParams, recipientName: b.student_name || 'Pilot' });
    sends.push(sendEmailToUser(
      b.student_id, b.student_email, EMAIL_TYPES.booking_cancelled,
      tpl.subject, tpl.html, tpl.text
    ));
  }

  if (b.instructor_email) {
    const tpl = flightCancelledEmail({ ...baseParams, recipientName: b.instructor_name || 'Instructor' });
    sends.push(sendEmailToUser(
      b.instructor_id, b.instructor_email, EMAIL_TYPES.booking_cancelled,
      tpl.subject, tpl.html, tpl.text
    ));
  }

  await Promise.allSettled(sends);

  const userIds = [b.student_id, b.instructor_id].filter(Boolean);
  try {
    const { notifyBookingCancelled } = require('./app-notifications');
    await notifyBookingCancelled(userIds, {
      tailNumber: b.tail_number,
      reason: cancellationReason,
    });
  } catch (_) { /* push optional */ }
}

module.exports = {
  sendBookingConfirmationEmails,
  sendBookingCancellationEmails,
};
