'use strict';

// routes/instructor-hours.js
// Owns: instructor hours log entries (aircraft_hours, instruction_hours).
// Does NOT own: flight_logs, bookings, billing — those stay in their own modules.

const express = require('express');
const pool = require('../db/index');
const { authenticateToken } = require('../middleware/auth');
const { recordHobbsReading } = require('../db/discrepancies');
const { auditInstructorHoursEntry } = require('../lib/hours-audit');
const { syncFlightRecordFromInstructorHours } = require('../lib/sync-flight-record');

const router = express.Router();

router.post('/', authenticateToken, async (req, res) => {
  try {
    const { role, id: userId } = req.user;
    if (role === 'student') return res.status(403).json({ error: 'Students cannot submit instructor hours' });
    const { aircraft_id, entry_date, aircraft_hours, instruction_hours, aircraft_rate, instructor_rate, notes, student_name, booking_id, hobbs_start, hobbs_end } = req.body;
    if (instruction_hours === undefined || instruction_hours === null) return res.status(400).json({ error: 'instruction_hours is required' });
    // Input sanitization: reject NaN, negative, impossibly large hour values
    const parsedInstrHours = parseFloat(instruction_hours);
    if (isNaN(parsedInstrHours) || parsedInstrHours < 0 || parsedInstrHours > 99999) {
      return res.status(400).json({ error: 'instruction_hours must be a valid non-negative number' });
    }
    if (aircraft_hours != null) {
      const parsedAcHours = parseFloat(aircraft_hours);
      if (isNaN(parsedAcHours) || parsedAcHours < 0 || parsedAcHours > 99999) {
        return res.status(400).json({ error: 'aircraft_hours must be a valid non-negative number' });
      }
    }
    // Re-verify role from DB — don't trust JWT alone for write operations
    const dbUserCheck = await pool.query('SELECT role FROM users WHERE id = $1 AND deleted_at IS NULL', [userId]);
    if (dbUserCheck.rows.length === 0) return res.status(401).json({ error: 'User account not found' });
    const verifiedRole = dbUserCheck.rows[0].role;
    if (verifiedRole === 'student') return res.status(403).json({ error: 'Students cannot submit instructor hours' });
    let instructorId = userId;
    if ((verifiedRole === 'owner' || verifiedRole === 'admin') && req.body.instructor_id) instructorId = parseInt(req.body.instructor_id);
    const parsedAircraftId = aircraft_id ? parseInt(aircraft_id) : null;
    if (parsedAircraftId && !isNaN(parsedAircraftId)) {
      const aircraftCheck = await pool.query('SELECT id FROM aircraft WHERE id = $1', [parsedAircraftId]);
      if (aircraftCheck.rows.length === 0) return res.status(404).json({ error: 'Aircraft not found' });
    }
    // Validate submitted Hobbs readings against aircraft's current reading
    if (parsedAircraftId && hobbs_start != null && hobbs_end != null) {
      const hS = parseFloat(hobbs_start);
      const hE = parseFloat(hobbs_end);
      if (isNaN(hS) || isNaN(hE) || hS < 0 || hE < 0 || hS > 99999 || hE > 99999) {
        return res.status(400).json({ error: 'Hobbs values must be valid non-negative numbers' });
      }
      if (hE <= hS) return res.status(400).json({ error: 'hobbs_end must be greater than hobbs_start' });
      const acHobbsCheck = await pool.query('SELECT current_hobbs FROM aircraft WHERE id = $1', [parsedAircraftId]);
      if (acHobbsCheck.rows.length > 0 && acHobbsCheck.rows[0].current_hobbs != null) {
        const currentHobbs = parseFloat(acHobbsCheck.rows[0].current_hobbs);
        if (Math.abs(hS - currentHobbs) > 0.5) {
          console.warn(`[security] Instructor hours Hobbs mismatch: user=${userId} submitted=${hS} aircraft_current=${currentHobbs}`);
          return res.status(400).json({ error: 'Hobbs reading does not match aircraft current hours' });
        }
      }
    }
    const instructorCheck = await pool.query(`SELECT id, is_instructor, instructor_rate FROM users WHERE id = $1 AND deleted_at IS NULL`, [instructorId]);
    if (instructorCheck.rows.length === 0) return res.status(404).json({ error: 'Instructor not found' });
    if (!instructorCheck.rows[0].is_instructor) return res.status(400).json({ error: 'User is not an instructor' });
    const entryDate = entry_date || new Date().toISOString().slice(0, 10);
    const dup = await pool.query(
      `SELECT id FROM instructor_hours WHERE instructor_id = $1 AND entry_date = $2
       AND aircraft_id IS NOT DISTINCT FROM $3 AND ABS(instruction_hours - $4) < 0.01 LIMIT 1`,
      [instructorId, entryDate, (parsedAircraftId && !isNaN(parsedAircraftId)) ? parsedAircraftId : null, parseFloat(instruction_hours) || 0]
    );
    if (dup.rows.length > 0) {
      return res.status(409).json({ error: 'Duplicate instructor hours entry for this date and aircraft' });
    }
    const parsedBookingId = booking_id ? parseInt(booking_id, 10) : null;
    const acHrsVal = parseFloat(aircraft_hours) || 0;
    const instrHrsVal = parseFloat(instruction_hours) || 0;
    const audit = await auditInstructorHoursEntry({
      instructorId,
      entryDate,
      aircraftId: (parsedAircraftId && !isNaN(parsedAircraftId)) ? parsedAircraftId : null,
      aircraftHours: acHrsVal,
      instructionHours: instrHrsVal,
      studentName: student_name || null,
      bookingId: parsedBookingId && !isNaN(parsedBookingId) ? parsedBookingId : null,
    });

    const result = await pool.query(`
      INSERT INTO instructor_hours (instructor_id, aircraft_id, entry_date, aircraft_hours, instruction_hours, aircraft_rate, instructor_rate, notes, student_name, booking_id, audit_status, audit_message)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [instructorId, (parsedAircraftId && !isNaN(parsedAircraftId)) ? parsedAircraftId : null,
       entryDate, acHrsVal, instrHrsVal,
       aircraft_rate !== undefined ? parseFloat(aircraft_rate) : null,
       instructor_rate !== undefined ? parseFloat(instructor_rate) : null,
       notes || null, student_name || null,
       parsedBookingId && !isNaN(parsedBookingId) ? parsedBookingId : null,
       audit.status, audit.message]
    );
    const entry = { ...result.rows[0], audit_ok: audit.ok, audit_details: audit.details };

    // If booking_id + hobbs readings provided, record for discrepancy tracking (fire-and-forget)
    if (booking_id && hobbs_start != null && hobbs_end != null) {
      const hS = parseFloat(hobbs_start);
      const hE = parseFloat(hobbs_end);
      if (!isNaN(hS) && !isNaN(hE) && hE > hS) {
        recordHobbsReading(parseInt(booking_id), instructorId, 'instructor', hS, hE)
          .catch(e => console.error('[instructor-hours] hobbs reading error:', e.message));
      }
    }

    res.status(201).json(entry);
    if (!audit.ok && audit.status === 'flagged') {
      console.warn(`[instructor-hours] Flagged entry id=${entry.id}: ${audit.message}`);
    }
  } catch (err) {
    console.error('Instructor hours create error:', err);
    res.status(500).json({ error: 'Failed to create instructor hours entry' });
  }
});

router.get('/', authenticateToken, async (req, res) => {
  try {
    const { role, id: userId } = req.user;
    if (role === 'student') return res.status(403).json({ error: 'Students cannot access instructor hours' });
    const { start_date, end_date, aircraft_id, instructor_id } = req.query;
    const conditions = [];
    const params = [];
    let pi = 1;
    if (role === 'instructor') { conditions.push(`ih.instructor_id = $${pi++}`); params.push(userId); }
    else if (instructor_id) { conditions.push(`ih.instructor_id = $${pi++}`); params.push(parseInt(instructor_id)); }
    if (aircraft_id) { conditions.push(`ih.aircraft_id = $${pi++}`); params.push(parseInt(aircraft_id)); }
    if (start_date) { conditions.push(`ih.entry_date >= $${pi++}`); params.push(start_date); }
    if (end_date) { conditions.push(`ih.entry_date <= $${pi++}`); params.push(end_date); }
    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    const result = await pool.query(`
      SELECT ih.id, ih.entry_date, ih.aircraft_hours, ih.instruction_hours,
             ih.aircraft_rate, ih.instructor_rate, ih.notes, ih.created_at, ih.student_name,
             ih.audit_status, ih.audit_message, ih.booking_id,
             u.id as instructor_id, u.name as instructor_name,
             a.id as aircraft_id_val, a.tail_number, a.make_model,
             ROUND((ih.aircraft_hours * COALESCE(ih.aircraft_rate, 0)) + (ih.instruction_hours * COALESCE(ih.instructor_rate, 0)), 2) as total_billed
      FROM instructor_hours ih
      JOIN users u ON u.id = ih.instructor_id
      LEFT JOIN aircraft a ON a.id = ih.aircraft_id
      ${where}
      ORDER BY ih.entry_date DESC, ih.created_at DESC
    `, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Instructor hours list error:', err);
    res.status(500).json({ error: 'Failed to fetch instructor hours' });
  }
});

router.delete('/clear', authenticateToken, async (req, res) => {
  try {
    const { role } = req.user;
    if (!['owner', 'admin'].includes(role)) return res.status(403).json({ error: 'Only admins and owners can clear instructor hours' });
    const { instructor_id } = req.query;
    if (!instructor_id) return res.status(400).json({ error: 'instructor_id is required' });
    const result = await pool.query('DELETE FROM instructor_hours WHERE instructor_id = $1 RETURNING id', [parseInt(instructor_id)]);
    res.json({ ok: true, deleted: result.rowCount });
  } catch (err) {
    console.error('Instructor hours clear error:', err);
    res.status(500).json({ error: 'Failed to clear instructor hours' });
  }
});

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { role, id: userId } = req.user;
    if (role === 'student') return res.status(403).json({ error: 'Access denied' });
    const entryId = parseInt(req.params.id);
    const existing = await pool.query('SELECT instructor_id FROM instructor_hours WHERE id = $1', [entryId]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Entry not found' });
    if (role === 'instructor' && existing.rows[0].instructor_id !== userId) return res.status(403).json({ error: "Cannot delete another instructor's entry" });
    await pool.query('DELETE FROM instructor_hours WHERE id = $1', [entryId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Instructor hours delete error:', err);
    res.status(500).json({ error: 'Failed to delete entry' });
  }
});

router.put('/:id', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const { role, id: userId } = req.user;
    const entryId = parseInt(req.params.id);
    const existing = await client.query('SELECT * FROM instructor_hours WHERE id = $1', [entryId]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Entry not found' });
    if (role === 'student') return res.status(403).json({ error: 'Access denied' });
    if (role === 'instructor' && existing.rows[0].instructor_id !== userId) {
      return res.status(403).json({ error: "Cannot edit another instructor's entry" });
    }
    if (!['owner', 'admin', 'instructor'].includes(role)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const { entry_date, aircraft_hours, instruction_hours, aircraft_rate, instructor_rate, notes, student_name } = req.body;
    if (instruction_hours === undefined || instruction_hours === null) return res.status(400).json({ error: 'instruction_hours is required' });
    const row = existing.rows[0];
    const acHrsVal = parseFloat(aircraft_hours) || 0;
    const instrHrsVal = parseFloat(instruction_hours) || 0;
    const newDate = entry_date || row.entry_date;
    const audit = await auditInstructorHoursEntry({
      instructorId: row.instructor_id,
      entryDate: newDate,
      aircraftId: row.aircraft_id,
      aircraftHours: acHrsVal,
      instructionHours: instrHrsVal,
      studentName: student_name ?? row.student_name,
      bookingId: row.booking_id,
    });

    await client.query('BEGIN');
    const result = await client.query(`
      UPDATE instructor_hours SET entry_date = COALESCE($1, entry_date), aircraft_hours = $2, instruction_hours = $3,
        aircraft_rate = $4, instructor_rate = $5, notes = $6, student_name = $7,
        audit_status = $8, audit_message = $9, updated_at = NOW()
      WHERE id = $10 RETURNING *`,
      [entry_date || null, acHrsVal, instrHrsVal,
       aircraft_rate !== undefined ? parseFloat(aircraft_rate) : null,
       instructor_rate !== undefined ? parseFloat(instructor_rate) : null,
       notes || null, student_name || null,
       audit.status, audit.message, entryId]
    );

    if (result.rows[0].booking_id) {
      await syncFlightRecordFromInstructorHours(client, result.rows[0]);
    }

    await client.query('COMMIT');
    res.json({ ...result.rows[0], audit_ok: audit.ok, audit_details: audit.details });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Instructor hours update error:', err);
    res.status(500).json({ error: err.message || 'Failed to update entry' });
  } finally {
    client.release();
  }
});

router.post('/reaudit', authenticateToken, async (req, res) => {
  try {
    const { role, id: userId } = req.user;
    if (role === 'student') return res.status(403).json({ error: 'Access denied' });
    const { start_date, end_date, instructor_id } = req.body || {};
    const conditions = [];
    const params = [];
    let pi = 1;
    if (role === 'instructor') {
      conditions.push(`ih.instructor_id = $${pi++}`);
      params.push(userId);
    } else if (instructor_id) {
      conditions.push(`ih.instructor_id = $${pi++}`);
      params.push(parseInt(instructor_id, 10));
    }
    if (start_date) { conditions.push(`ih.entry_date >= $${pi++}`); params.push(start_date); }
    if (end_date) { conditions.push(`ih.entry_date <= $${pi++}`); params.push(end_date); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const rows = await pool.query(`SELECT * FROM instructor_hours ih ${where} ORDER BY ih.entry_date DESC`, params);
    let flagged = 0;
    for (const row of rows.rows) {
      const audit = await auditInstructorHoursEntry({
        instructorId: row.instructor_id,
        entryDate: row.entry_date,
        aircraftId: row.aircraft_id,
        aircraftHours: row.aircraft_hours,
        instructionHours: row.instruction_hours,
        studentName: row.student_name,
        bookingId: row.booking_id,
      });
      await pool.query(
        'UPDATE instructor_hours SET audit_status = $1, audit_message = $2, updated_at = NOW() WHERE id = $3',
        [audit.status, audit.message, row.id]
      );
      if (audit.status === 'flagged') flagged++;
    }
    res.json({ ok: true, reviewed: rows.rows.length, flagged });
  } catch (err) {
    console.error('Instructor hours reaudit error:', err);
    res.status(500).json({ error: 'Failed to re-audit instructor hours' });
  }
});

router.get('/prefill', authenticateToken, async (req, res) => {
  try {
    const { role, id: userId } = req.user;
    if (role === 'student') return res.status(403).json({ error: 'Access denied' });
    let instructorId = userId;
    if ((role === 'owner' || role === 'admin') && req.query.instructor_id) instructorId = parseInt(req.query.instructor_id);
    const instrResult = await pool.query('SELECT instructor_rate FROM users WHERE id = $1', [instructorId]);
    const aircraftResult = await pool.query('SELECT id, tail_number, make_model, hourly_rate FROM aircraft ORDER BY tail_number');
    let aircraft = aircraftResult.rows;
    if (aircraft.length === 0) {
      try {
        const cmsResult = await pool.query("SELECT key, value FROM site_content WHERE key LIKE 'fleet_%'");
        const cms = {};
        cmsResult.rows.forEach(r => { cms[r.key] = r.value; });
        const fleetCount = parseInt(cms.fleet_count || '0', 10);
        for (let i = 1; i <= fleetCount; i++) {
          const title = cms['fleet_' + i + '_title'] || '';
          const subtitle = cms['fleet_' + i + '_subtitle'] || '';
          if (!title && !subtitle) continue;
          const tailMatch = subtitle.match(/^([A-Z0-9-]+)/);
          const tailNumber = tailMatch ? tailMatch[1] : subtitle.split('·')[0].trim();
          aircraft.push({ id: null, tail_number: tailNumber || ('Aircraft ' + i), make_model: title, hourly_rate: null, _cms_source: true });
        }
      } catch (_) { /* CMS fallback failed */ }
    }
    const studentsResult = await pool.query("SELECT id, name FROM users WHERE role = 'student' AND deleted_at IS NULL ORDER BY name");
    res.json({ instructor_rate: instrResult.rows[0]?.instructor_rate || null, aircraft, students: studentsResult.rows });
  } catch (err) {
    console.error('Instructor hours prefill error:', err);
    res.status(500).json({ error: 'Failed to fetch prefill data' });
  }
});

module.exports = router;