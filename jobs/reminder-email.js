/**
 * Pre-Flight Email Reminder Job
 *
 * Standalone script run via polsia.toml [[crons]].
 * Sends 24-hour reminder emails to students and instructors for confirmed flights.
 *
 * Query: bookings with start_time in [NOW+23h, NOW+25h], status='confirmed', reminder_sent=false
 * For each booking: sends student email, sends instructor email (if instructor assigned)
 * After send: sets reminder_sent = true
 *
 * Edge cases:
 * - No instructor assigned → only send to student
 * - No email on file → skip gracefully, log warning
 * - Already cancelled/completed → skip (status check in query)
 * - Duplicate run: reminder_sent=true prevents re-send
 */
'use strict';

const { Pool } = require('pg');
const { sendEmail, preflightReminderEmailStudent, preflightReminderEmailInstructor } = require('../email-templates');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
  max: 3,
  idleTimeoutMillis: 15000,
});

const APP_URL = process.env.APP_URL || 'https://www.newtechaviation.com';
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

async function runReminderCheck() {
  console.log('[reminder-email] Starting pre-flight reminder check...');

  const now = new Date();
  const windowStart = new Date(now.getTime() + 23 * 60 * 60 * 1000); // +23h
  const windowEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000);    // +25h

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
    console.log('[reminder-email] No pending reminders. Exiting.');
    await pool.end();
    return;
  }

  let sentCount = 0;
  let skipCount = 0;
  let errorCount = 0;

  for (const booking of result.rows) {
    try {
      const flightDate = formatDateCT(new Date(booking.start_time));
      const flightTime = formatTimeCT(new Date(booking.start_time));
      const manageUrl = `${APP_URL}/app`;
      const flightType = booking.lesson_type || booking.booking_type || 'Flight';
      const tailNum = booking.tail_number;
      const makeModel = booking.make_model;

      // Send to student
      if (booking.student_email && booking.student_name) {
        const { subject, html, text } = preflightReminderEmailStudent({
          recipientName: booking.student_name,
          flightDate,
          flightTime,
          tailNumber: tailNum,
          makeModel,
          instructorName: booking.instructor_name || null,
          flightType,
          manageUrl,
        });
        await sendEmail(booking.student_email, subject, html, text);
        console.log(`[reminder-email] Student reminder sent: ${booking.student_email} for booking #${booking.id}`);
      } else {
        console.warn(`[reminder-email] No student email for booking #${booking.id} — skipping student email`);
      }

      // Send to instructor (if assigned)
      if (booking.instructor_id && booking.instructor_email && booking.instructor_name) {
        const { subject, html, text } = preflightReminderEmailInstructor({
          recipientName: booking.instructor_name,
          flightDate,
          flightTime,
          tailNumber: tailNum,
          makeModel,
          studentName: booking.student_name || null,
          flightType,
          manageUrl,
        });
        await sendEmail(booking.instructor_email, subject, html, text);
        console.log(`[reminder-email] Instructor reminder sent: ${booking.instructor_email} for booking #${booking.id}`);
      }

      // Mark as sent
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
  await pool.end();
}

runReminderCheck().catch(err => {
  console.error('[reminder-email] Fatal error:', err.message);
  process.exit(1);
});