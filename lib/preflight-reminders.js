'use strict';

const { getAppUrl } = require('./app-url');
const { sendEmail, preflightReminderEmailStudent, preflightReminderEmailInstructor } = require('../email-templates');

const CT_TZ = 'America/Chicago';

function toCentral(date) {
  return new Date(date.toLocaleString('en-US', { timeZone: CT_TZ }));
}

function formatDateCT(date) {
  return toCentral(date).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: CT_TZ,
  });
}

function formatTimeCT(date) {
  return toCentral(date).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: CT_TZ,
  });
}

async function runPreflightReminders(pool) {
  console.log('[reminder-email] Starting pre-flight reminder check...');

  const now = new Date();
  const windowStart = new Date(now.getTime() + 23 * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000);

  const result = await pool.query(`
    SELECT
      b.id,
      b.start_time,
      b.end_time,
      b.lesson_type,
      b.booking_type,
      b.status,
      s.id   AS student_id,
      s.name AS student_name,
      s.email AS student_email,
      i.id   AS instructor_id,
      i.name AS instructor_name,
      i.email AS instructor_email,
      a.tail_number,
      a.make_model
    FROM bookings b
    LEFT JOIN users s ON b.student_id = s.id
    LEFT JOIN users i ON b.instructor_id = i.id
    JOIN aircraft a ON b.aircraft_id = a.id
    WHERE b.start_time >= $1
      AND b.start_time <  $2
      AND b.status = 'confirmed'
      AND b.reminder_sent = false
  `, [windowStart.toISOString(), windowEnd.toISOString()]);

  console.log(`[reminder-email] Found ${result.rows.length} booking(s) needing reminders`);

  if (result.rows.length === 0) {
    console.log('[reminder-email] No pending reminders.');
    return { sent: 0, errors: 0 };
  }

  const manageUrl = `${getAppUrl()}/app`;
  let sentCount = 0;
  let errorCount = 0;

  for (const booking of result.rows) {
    try {
      const flightDate = formatDateCT(new Date(booking.start_time));
      const flightTime = formatTimeCT(new Date(booking.start_time));
      const flightType = booking.lesson_type || booking.booking_type || 'Flight';

      if (booking.student_email && booking.student_name) {
        const { subject, html, text } = preflightReminderEmailStudent({
          recipientName: booking.student_name,
          flightDate,
          flightTime,
          tailNumber: booking.tail_number,
          makeModel: booking.make_model,
          instructorName: booking.instructor_name || null,
          flightType,
          manageUrl,
        });
        await sendEmail(booking.student_email, subject, html, text);
        console.log(`[reminder-email] Student reminder sent: ${booking.student_email} for booking #${booking.id}`);
      } else {
        console.warn(`[reminder-email] No student email for booking #${booking.id}`);
      }

      if (booking.instructor_id && booking.instructor_email && booking.instructor_name) {
        const { subject, html, text } = preflightReminderEmailInstructor({
          recipientName: booking.instructor_name,
          flightDate,
          flightTime,
          tailNumber: booking.tail_number,
          makeModel: booking.make_model,
          studentName: booking.student_name || null,
          flightType,
          manageUrl,
        });
        await sendEmail(booking.instructor_email, subject, html, text);
        console.log(`[reminder-email] Instructor reminder sent: ${booking.instructor_email} for booking #${booking.id}`);
      }

      await pool.query(
        'UPDATE bookings SET reminder_sent = true, updated_at = NOW() WHERE id = $1',
        [booking.id]
      );
      sentCount++;
    } catch (err) {
      console.error(`[reminder-email] Error processing booking #${booking.id}:`, err.message);
      errorCount++;
    }
  }

  console.log(`[reminder-email] Done. Sent: ${sentCount}, Errors: ${errorCount}`);
  return { sent: sentCount, errors: errorCount };
}

function startPreflightReminderScheduler(pool) {
  if (process.env.DISABLE_IN_PROCESS_CRONS === 'true') {
    console.log('[reminder-email] In-process scheduler disabled');
    return;
  }

  console.log('[reminder-email] Hourly pre-flight reminder scheduler started');
  const run = () => runPreflightReminders(pool).catch((err) => {
    console.error('[reminder-email] Scheduler error:', err.message);
  });

  setTimeout(run, 60 * 1000);
  setInterval(run, 60 * 60 * 1000);
}

module.exports = { runPreflightReminders, startPreflightReminderScheduler };
