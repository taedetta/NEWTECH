'use strict';

const pool = require('../db/index');
const { getAppUrl } = require('./app-url');
const { sendEmail } = require('../email-templates');
const { sendPushToUser } = require('./push-notifications');
const { formatDateLongCT, formatBookingTimeRangeCT, CT_TZ } = require('./timezone-ct');

function instructorBriefingEmail({ instructorName, dateLabel, flights, atRiskStudents, squawks, weatherSummary }) {
  const subject = `Daily briefing — ${dateLabel}`;
  const flightLines = flights.length
    ? flights.map((f) => {
        const when = formatBookingTimeRangeCT(f.start_time, f.end_time);
        const withWho = f.student_name
          ? ` with ${f.student_name}`
          : (f.instructor_name && !f.student_name ? ' (solo)' : '');
        return `<li><strong>${when}</strong> — ${f.tail_number}${withWho}${f.lesson_type ? ` (${f.lesson_type})` : ''}</li>`;
      }).join('')
    : '<li>No flights scheduled today.</li>';

  const riskLines = atRiskStudents.length
    ? atRiskStudents.map((s) => `<li>${s.name} — ${s.risk_level || 'at-risk'} (${s.days_since_last_flight ?? '?'} days since last flight)</li>`).join('')
    : '<li>No at-risk students assigned to you.</li>';

  const squawkLines = squawks.length
    ? squawks.map((s) => `<li>${s.tail_number}: ${s.description} (${s.severity})</li>`).join('')
    : '<li>No open squawks on your aircraft today.</li>';

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;color:#1e293b">
      <h2 style="color:#0ea5e9;margin:0 0 0.5rem">Good morning, ${instructorName}</h2>
      <p style="color:#64748b;margin:0 0 1rem">${dateLabel} — your daily flight school briefing (all times Eastern)</p>
      ${weatherSummary ? `<p style="background:#f1f5f9;padding:0.75rem;border-radius:8px;font-size:0.9rem"><strong>Weather (KPSK):</strong> ${weatherSummary}</p>` : ''}
      <h3 style="font-size:1rem;margin:1.25rem 0 0.5rem">Today's flights</h3>
      <ul style="padding-left:1.25rem;line-height:1.7">${flightLines}</ul>
      <h3 style="font-size:1rem;margin:1.25rem 0 0.5rem">Your at-risk students</h3>
      <ul style="padding-left:1.25rem;line-height:1.7">${riskLines}</ul>
      <h3 style="font-size:1rem;margin:1.25rem 0 0.5rem">Fleet squawks</h3>
      <ul style="padding-left:1.25rem;line-height:1.7">${squawkLines}</ul>
      <p style="margin-top:1.5rem"><a href="${getAppUrl()}/app" style="color:#0ea5e9">Open FlightSlate →</a></p>
    </div>`;

  const text = `Daily briefing for ${instructorName} — ${dateLabel}. ${flights.length} flight(s) scheduled today (Eastern Time). Open ${getAppUrl()}/app`;

  return { subject, html, text };
}

async function buildInstructorBriefing(instructorId) {
  const flights = await pool.query(
    `SELECT b.*, s.name AS student_name, a.tail_number
     FROM bookings b
     LEFT JOIN users s ON s.id = b.student_id
     JOIN aircraft a ON a.id = b.aircraft_id
     WHERE b.instructor_id = $1 AND b.status = 'confirmed'
       AND (b.start_time AT TIME ZONE $2)::date = (CURRENT_TIMESTAMP AT TIME ZONE $2)::date
     ORDER BY b.start_time`,
    [instructorId, CT_TZ]
  );

  const atRisk = await pool.query(
    `SELECT u.name, ar.risk_level, ar.days_since_last_flight
     FROM student_training st
     JOIN users u ON u.id = st.student_id
     LEFT JOIN at_risk_assessments ar ON ar.student_id = st.student_id
     WHERE st.instructor_id = $1 AND st.status = 'active'
       AND (ar.risk_level IN ('high', 'medium') OR ar.days_since_last_flight > 14)
     ORDER BY ar.risk_score DESC NULLS LAST
     LIMIT 10`,
    [instructorId]
  );

  const squawks = await pool.query(
    `SELECT s.description, s.severity, a.tail_number
     FROM squawks s
     JOIN aircraft a ON a.id = s.aircraft_id
     WHERE s.status = 'open'
     ORDER BY CASE s.severity WHEN 'grounding' THEN 0 WHEN 'major' THEN 1 ELSE 2 END
     LIMIT 8`
  );

  let weatherSummary = '';
  try {
    const wx = await pool.query(
      `SELECT metar_raw FROM weather_cache WHERE station = 'KPSK' ORDER BY updated_at DESC LIMIT 1`
    );
    if (wx.rows[0]?.metar_raw) {
      weatherSummary = wx.rows[0].metar_raw.slice(0, 120);
    }
  } catch (_) { /* optional */ }

  return {
    flights: flights.rows,
    atRiskStudents: atRisk.rows,
    squawks: squawks.rows,
    weatherSummary,
  };
}

async function runInstructorDailyBriefings(pool) {
  console.log('[briefing] Starting instructor daily briefing emails...');
  const instructors = await pool.query(
    `SELECT id, name, email FROM users
     WHERE deleted_at IS NULL AND approval_status = 'approved'
       AND (role = 'instructor' OR is_instructor = TRUE)
       AND email IS NOT NULL`
  );

  const dateLabel = formatDateLongCT(new Date());

  let sent = 0;
  for (const instr of instructors.rows) {
    try {
      const data = await buildInstructorBriefing(instr.id);
      const tpl = instructorBriefingEmail({
        instructorName: instr.name,
        dateLabel,
        flights: data.flights,
        atRiskStudents: data.atRiskStudents,
        squawks: data.squawks,
        weatherSummary: data.weatherSummary,
      });
      await sendEmail(instr.email, tpl.subject, tpl.html, tpl.text);
      await sendPushToUser(instr.id, {
        title: 'Daily briefing ready',
        body: `${data.flights.length} flight(s) scheduled today`,
        link: '/app/schedule',
        notification_type: 'daily_briefing',
      });
      sent++;
    } catch (err) {
      console.error(`[briefing] failed for instructor ${instr.id}:`, err.message);
    }
  }
  console.log(`[briefing] Sent ${sent} briefing(s)`);
  return { sent };
}

function startInstructorBriefingScheduler(pool) {
  const { isStaging } = require('./app-env');
  if (isStaging()) {
    console.log('[briefing] Staging — instructor briefing scheduler disabled');
    return;
  }

  const HOUR_CT = 6;
  function scheduleNext() {
    const nowCt = new Date(new Date().toLocaleString('en-US', { timeZone: CT_TZ }));
    const next = new Date(nowCt);
    next.setHours(HOUR_CT, 0, 0, 0);
    if (nowCt.getHours() >= HOUR_CT) next.setDate(next.getDate() + 1);
    const ms = next.getTime() - nowCt.getTime();
    setTimeout(async () => {
      try {
        await runInstructorDailyBriefings(pool);
      } catch (err) {
        console.error('[briefing] scheduler error:', err.message);
      }
      scheduleNext();
    }, ms);
  }
  scheduleNext();
  console.log('[briefing] Daily instructor briefing scheduler started (6:00 AM ET)');
}

module.exports = {
  runInstructorDailyBriefings,
  startInstructorBriefingScheduler,
  buildInstructorBriefing,
};
