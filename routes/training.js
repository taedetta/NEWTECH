'use strict';

const express = require('express');
const pool = require('../db/index');
const { authenticateToken, requireRole } = require('../middleware/auth');
const trainingDb = require('../db/training');

const router = express.Router();

router.get('/programs', authenticateToken, async (req, res) => {
  try {
    const programs = await pool.query('SELECT * FROM training_programs ORDER BY id');
    const stages = await pool.query('SELECT * FROM program_stages ORDER BY program_id, order_index');
    let maneuvers = [];
    try {
      const mr = await pool.query('SELECT * FROM stage_maneuvers ORDER BY stage_id, order_index');
      maneuvers = mr.rows;
    } catch (_) { /* table not yet migrated */ }
    const result = programs.rows.map(p => ({
      ...p,
      stages: stages.rows.filter(s => s.program_id === p.id).map(s => ({
        ...s,
        maneuvers: maneuvers.filter(m => m.stage_id === s.id)
      }))
    }));
    res.json(result);
  } catch (err) {
    console.error('Training programs error:', err);
    res.status(500).json({ error: 'Failed to fetch training programs' });
  }
});

// GET /program-enrollments — programs with student enrollment and progress data (instructor+)
router.get('/program-enrollments', authenticateToken, async (req, res) => {
  try {
    // Instructors can view all enrollments; students can't access this endpoint
    if (req.user.role === 'student') {
      return res.status(403).json({ error: 'Access denied' });
    }
    const programs = await pool.query('SELECT * FROM training_programs ORDER BY id');
    const result = [];
    for (const prog of programs.rows) {
      const enrollments = await trainingDb.getProgramEnrollments(prog.id);
      result.push({
        id: prog.id,
        code: prog.code,
        name: prog.name,
        stages_count: (await pool.query('SELECT COUNT(*) FROM program_stages WHERE program_id = $1', [prog.id])).rows[0].count,
        students: enrollments,
      });
    }
    res.json(result);
  } catch (err) {
    console.error('Program enrollments error:', err);
    res.status(500).json({ error: 'Failed to fetch program enrollments' });
  }
});

router.get('/student-progress', authenticateToken, async (req, res) => {
  try {
    const studentId = req.query.student_id ? parseInt(req.query.student_id) : req.user.id;
    const programs = await pool.query('SELECT * FROM training_programs ORDER BY id');
    const stages = await pool.query('SELECT * FROM program_stages ORDER BY program_id, order_index');
    let maneuvers = [];
    try { const mr = await pool.query('SELECT * FROM stage_maneuvers ORDER BY stage_id, order_index'); maneuvers = mr.rows; } catch (_) {}
    const progress = await pool.query(
      `SELECT smp.*, sm.name as maneuver_name, sm.stage_id, sm.order_index as maneuver_order
       FROM student_maneuver_progress smp
       JOIN stage_maneuvers sm ON sm.id = smp.maneuver_id
       WHERE smp.student_id = $1
       ORDER BY sm.stage_id, sm.order_index`,
      [studentId]
    );
    const result = programs.rows.map(p => ({
      ...p,
      stages: stages.rows.filter(s => s.program_id === p.id).map(s => ({
        ...s,
        maneuvers: maneuvers.filter(m => m.stage_id === s.id).map(m => {
          const pRow = progress.rows.find(p => p.maneuver_id === m.id);
          return { ...m, status: pRow?.status || null, notes: pRow?.notes || null, proficient_date: pRow?.proficient_date || null };
        })
      }))
    }));
    res.json(result);
  } catch (err) {
    console.error('Student progress error:', err);
    res.status(500).json({ error: 'Failed to fetch student progress' });
  }
});

router.post('/student-progress', authenticateToken, async (req, res) => {
  try {
    const { student_id, maneuver_id, status, notes } = req.body;
    if (!student_id || !maneuver_id) return res.status(400).json({ error: 'student_id and maneuver_id are required' });
    const validStatuses = ['not_started', 'in_progress', 'needs_review', 'proficient', 'completed'];
    const s = validStatuses.includes(status) ? status : 'in_progress';
    const result = await pool.query(
      `INSERT INTO student_maneuver_progress (student_id, maneuver_id, status, notes, proficient_date)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (student_id, maneuver_id) DO UPDATE SET status = $3, notes = $4, proficient_date = $5
       RETURNING *`,
      [student_id, maneuver_id, s, notes || null, s === 'proficient' || s === 'completed' ? new Date() : null]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Progress update error:', err);
    res.status(500).json({ error: 'Failed to update progress' });
  }
});

// POST /enroll — enroll a student in a training program with optional instructor assignment.
// Validates student/program/instructor existence; returns specific errors (not generic catch-alls).
router.post('/enroll', authenticateToken, requireRole('owner', 'admin', 'instructor'), async (req, res) => {
  try {
    const { student_id, program_id, instructor_id } = req.body;
    if (!student_id) return res.status(400).json({ error: 'student_id is required' });
    if (!program_id) return res.status(400).json({ error: 'program_id is required' });

    const enrollment = await trainingDb.enrollStudent(
      parseInt(student_id),
      parseInt(program_id),
      instructor_id ? parseInt(instructor_id) : null
    );
    res.status(201).json(enrollment);
  } catch (err) {
    // Unique constraint: student already enrolled in this program
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Student is already enrolled in this program' });
    }
    // Foreign key violation
    if (err.code === '23503') {
      return res.status(400).json({ error: 'Invalid student, program, or instructor ID' });
    }
    // Validation errors from db/training.js
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('[training] POST /enroll error:', err.message);
    res.status(500).json({ error: 'Failed to enroll student: ' + err.message });
  }
});

router.put('/enrollment/:id/stage', authenticateToken, async (req, res) => {
  try {
    const { current_stage_id } = req.body;
    const result = await pool.query(
      `UPDATE student_training SET current_stage_id = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [current_stage_id || null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Enrollment not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Enrollment stage update error:', err);
    res.status(500).json({ error: 'Failed to update enrollment stage' });
  }
});

// Admin: training programs management
router.post('/admin/programs', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const { name, code, description } = req.body;
    if (!name || !code) return res.status(400).json({ error: 'name and code are required' });
    const result = await pool.query(
      `INSERT INTO training_programs (name, code, description) VALUES ($1, UPPER($2), $3) RETURNING *`,
      [name, code, description || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A program with this code already exists' });
    console.error('Admin create program error:', err);
    res.status(500).json({ error: 'Failed to create program' });
  }
});

router.put('/admin/programs/:id', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const { name, description } = req.body;
    const result = await pool.query(
      `UPDATE training_programs SET name = COALESCE($1, name), description = COALESCE($2, description) WHERE id = $3 RETURNING *`,
      [name || null, description || null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Program not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Admin update program error:', err);
    res.status(500).json({ error: 'Failed to update program' });
  }
});

router.delete('/admin/programs/:id', requireRole('owner', 'admin'), async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id);
    await client.query('BEGIN');
    // Cascade delete: maneuvers → stages → program
    await client.query(`DELETE FROM stage_maneuvers WHERE stage_id IN (SELECT id FROM program_stages WHERE program_id = $1)`, [id]);
    await client.query(`DELETE FROM program_stages WHERE program_id = $1`, [id]);
    const result = await client.query(`DELETE FROM training_programs WHERE id = $1 RETURNING id`, [id]);
    await client.query('COMMIT');
    if (result.rows.length === 0) return res.status(404).json({ error: 'Program not found' });
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Admin delete program error:', err);
    res.status(500).json({ error: 'Failed to delete program' });
  } finally {
    client.release();
  }
});

router.post('/admin/stages', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const { program_id, name, description, order_index } = req.body;
    if (!program_id || !name) return res.status(400).json({ error: 'program_id and name are required' });
    let idx = order_index;
    if (!idx) {
      const maxR = await pool.query(`SELECT COALESCE(MAX(order_index), 0) + 1 as next_idx FROM program_stages WHERE program_id = $1`, [program_id]);
      idx = maxR.rows[0].next_idx;
    }
    const result = await pool.query(
      `INSERT INTO program_stages (program_id, name, description, order_index) VALUES ($1, $2, $3, $4) RETURNING *`,
      [program_id, name, description || null, idx]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Admin create stage error:', err);
    res.status(500).json({ error: 'Failed to create stage' });
  }
});

router.put('/admin/stages/:id', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const { name, description, order_index } = req.body;
    const result = await pool.query(
      `UPDATE program_stages SET name = COALESCE($1, name), description = COALESCE($2, description), order_index = COALESCE($3, order_index) WHERE id = $4 RETURNING *`,
      [name || null, description || null, order_index || null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Stage not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Admin update stage error:', err);
    res.status(500).json({ error: 'Failed to update stage' });
  }
});

router.delete('/admin/stages/:id', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const inUse = await pool.query(`SELECT COUNT(*) as cnt FROM student_training WHERE current_stage_id = $1`, [req.params.id]);
    if (parseInt(inUse.rows[0].cnt) > 0) {
      return res.status(409).json({ error: 'Cannot delete: students are currently in this stage. Reassign them first.' });
    }
    await pool.query('DELETE FROM program_stages WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Admin delete stage error:', err);
    res.status(500).json({ error: 'Failed to delete stage' });
  }
});

router.post('/admin/maneuvers', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const { stage_id, name, description, proficiency_standard, order_index } = req.body;
    if (!stage_id || !name) return res.status(400).json({ error: 'stage_id and name are required' });
    let idx = order_index;
    if (!idx) {
      const maxR = await pool.query(`SELECT COALESCE(MAX(order_index), 0) + 1 as next_idx FROM stage_maneuvers WHERE stage_id = $1`, [stage_id]);
      idx = maxR.rows[0].next_idx;
    }
    const result = await pool.query(
      `INSERT INTO stage_maneuvers (stage_id, name, description, proficiency_standard, order_index) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [stage_id, name, description || null, proficiency_standard || null, idx]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Admin create maneuver error:', err);
    res.status(500).json({ error: 'Failed to create maneuver' });
  }
});

router.put('/admin/maneuvers/:id', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const { name, description, proficiency_standard, order_index } = req.body;
    const result = await pool.query(
      `UPDATE stage_maneuvers SET name = COALESCE($1, name), description = COALESCE($2, description), proficiency_standard = COALESCE($3, proficiency_standard), order_index = COALESCE($4, order_index), updated_at = NOW() WHERE id = $5 RETURNING *`,
      [name || null, description || null, proficiency_standard || null, order_index || null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Maneuver not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Admin update maneuver error:', err);
    res.status(500).json({ error: 'Failed to update maneuver' });
  }
});

router.delete('/admin/maneuvers/:id', requireRole('owner', 'admin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM stage_maneuvers WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Admin delete maneuver error:', err);
    res.status(500).json({ error: 'Failed to delete maneuver' });
  }
});

router.put('/admin/stages/reorder', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const { stages } = req.body;
    if (!Array.isArray(stages)) return res.status(400).json({ error: 'stages array required' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const s of stages) {
        await client.query('UPDATE program_stages SET order_index = $1 WHERE id = $2', [s.order_index, s.id]);
      }
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Stage reorder error:', err);
    res.status(500).json({ error: 'Failed to reorder stages' });
  }
});

// Checkride readiness
const FAA_PART61_REQUIREMENTS = {
  PPL: [{ label: 'Total Hours', key: 'total', need: 40, weight: 2 }, { label: 'Solo Hours', key: 'solo', need: 10, weight: 1.5 }, { label: 'Solo XC Hours', key: 'xc_solo', need: 5, weight: 1 }, { label: 'Night Hours', key: 'night', need: 3, weight: 1 }, { label: 'Instrument Hours', key: 'instrument', need: 3, weight: 1 }],
  IFR: [{ label: 'XC PIC Hours', key: 'xc', need: 50, weight: 1.5 }, { label: 'Instrument Hours', key: 'instrument', need: 40, weight: 2 }],
  CPL: [{ label: 'Total Hours', key: 'total', need: 250, weight: 2 }, { label: 'Night Hours', key: 'night', need: 10, weight: 1 }, { label: 'XC Hours', key: 'xc', need: 50, weight: 1 }],
  SPL: [{ label: 'Total Hours', key: 'total', need: 20, weight: 2 }, { label: 'Solo Hours', key: 'solo', need: 5, weight: 1.5 }],
};

router.get('/checkride-readiness/:studentId', authenticateToken, async (req, res) => {
  try {
    const studentId = parseInt(req.params.studentId);
    if (isNaN(studentId)) return res.status(400).json({ error: 'Invalid student ID' });
    if (req.user.role === 'student' && req.user.id !== studentId) return res.status(403).json({ error: 'Access denied' });
    const enrollResult = await pool.query(`
      SELECT st.id as enrollment_id, st.program_id, st.student_id, st.instructor_id, st.status, st.started_at,
             tp.name as program_name, tp.code as program_code, u.name as instructor_name, ps.name as current_stage_name
      FROM student_training st
      JOIN training_programs tp ON tp.id = st.program_id
      LEFT JOIN users u ON u.id = st.instructor_id
      LEFT JOIN program_stages ps ON ps.id = st.current_stage_id
      WHERE st.student_id = $1 AND st.status = 'active'
      ORDER BY st.started_at
    `, [studentId]);
    if (enrollResult.rows.length === 0) return res.json({ programs: [] });
    const flightResult = await pool.query(`SELECT hobbs_delta, is_night, is_xc, is_instrument, is_solo, flight_date FROM flight_logs WHERE student_id = $1`, [studentId]);
    const flights = flightResult.rows;
    const toHrs = (f) => parseFloat(f.hobbs_delta) || 0;
    const hoursMap = {
      total: flights.reduce((s, f) => s + toHrs(f), 0),
      solo: flights.filter(f => f.is_solo).reduce((s, f) => s + toHrs(f), 0),
      night: flights.filter(f => f.is_night).reduce((s, f) => s + toHrs(f), 0),
      xc: flights.filter(f => f.is_xc).reduce((s, f) => s + toHrs(f), 0),
      xc_solo: flights.filter(f => f.is_xc && f.is_solo).reduce((s, f) => s + toHrs(f), 0),
      instrument: flights.filter(f => f.is_instrument).reduce((s, f) => s + toHrs(f), 0),
    };
    const endorseResult = await pool.query(`SELECT id, endorsement_type, endorsement_date, expiration_date, instructor_name, instructor_cert_number, signed_at FROM endorsements WHERE student_id = $1 ORDER BY endorsement_date DESC`, [studentId]);
    const debriefsResult = await pool.query(`
      SELECT fd.id, fd.flight_date, fd.notes, fd.overall_performance, fd.recommendations, u.name as instructor_name, ps.name as stage_name
      FROM flight_debriefs fd LEFT JOIN users u ON u.id = fd.instructor_id LEFT JOIN program_stages ps ON ps.id = fd.stage_id
      WHERE fd.student_id = $1 ORDER BY fd.flight_date DESC`, [studentId]);
    const debriefIds = debriefsResult.rows.map(d => d.id);
    let debrief_grades = [];
    if (debriefIds.length > 0) {
      const gradesResult = await pool.query(`SELECT debrief_id, grade, notes, maneuver_name FROM debrief_grades WHERE debrief_id = ANY($1) ORDER BY debrief_id, id`, [debriefIds]);
      debrief_grades = gradesResult.rows;
    }
    const programs = [];
    for (const enroll of enrollResult.rows) {
      const code = enroll.program_code;
      const reqCats = FAA_PART61_REQUIREMENTS[code] || [{ label: 'Total Hours', key: 'total', need: 40, weight: 2 }];
      const stagesResult = await pool.query(`
        SELECT ps.id, ps.name, ps.order_index, COUNT(sm.id) as total_maneuvers,
               COUNT(smp.id) FILTER (WHERE smp.status IN ('proficient','completed')) as proficient_count
        FROM program_stages ps
        LEFT JOIN stage_maneuvers sm ON sm.stage_id = ps.id
        LEFT JOIN student_maneuver_progress smp ON smp.maneuver_id = sm.id AND smp.student_id = $1
        WHERE ps.program_id = $2 GROUP BY ps.id, ps.name, ps.order_index ORDER BY ps.order_index`, [studentId, enroll.program_id]);
      const stages = stagesResult.rows;
      const totalStages = stages.length;
      const completedStages = stages.filter(s => parseInt(s.total_maneuvers) > 0 && parseInt(s.proficient_count) >= parseInt(s.total_maneuvers)).length;
      const totalManeuvers = stages.reduce((s, r) => s + parseInt(r.total_maneuvers), 0);
      const proficientManeuvers = stages.reduce((s, r) => s + parseInt(r.proficient_count), 0);
      let score = 0, maxScore = 0;
      const categories = reqCats.map(c => {
        const got = hoursMap[c.key] || 0;
        const pct = Math.min(100, Math.round((got / c.need) * 100));
        score += Math.min(1, got / c.need) * c.weight;
        maxScore += c.weight;
        return { label: c.label, got: Math.round(got * 10) / 10, need: c.need, pct, weight: c.weight };
      });
      if (totalStages > 0) {
        const pct = Math.round((completedStages / totalStages) * 100);
        score += (completedStages / totalStages) * 2;
        maxScore += 2;
        categories.push({ label: 'Stage Completion', got: completedStages, need: totalStages, pct, weight: 2 });
      }
      if (totalManeuvers > 0) {
        const pct = Math.round((proficientManeuvers / totalManeuvers) * 100);
        score += (proficientManeuvers / totalManeuvers) * 1.5;
        maxScore += 1.5;
        categories.push({ label: 'Maneuver Proficiency', got: proficientManeuvers, need: totalManeuvers, pct, weight: 1.5 });
      }
      const readiness_pct = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
      const recommendations = [];
      for (const c of categories) {
        const remaining = c.need - c.got;
        if (remaining > 0.05 && c.label !== 'Stage Completion' && c.label !== 'Maneuver Proficiency') {
          recommendations.push({ priority: c.pct < 25 ? 'high' : c.pct < 75 ? 'medium' : 'low', text: `Log ${remaining.toFixed(1)} more ${c.label.toLowerCase()} to meet FAA minimums` });
        }
        if (c.label === 'Stage Completion' && c.got < c.need) { const n = c.need - c.got; recommendations.push({ priority: 'medium', text: `Complete ${n} more stage${n > 1 ? 's' : ''} in your syllabus` }); }
        if (c.label === 'Maneuver Proficiency' && c.got < c.need) { const n = c.need - c.got; recommendations.push({ priority: 'low', text: `${n} maneuver${n > 1 ? 's' : ''} still need proficiency sign-off` }); }
      }
      recommendations.sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.priority]) - ({ high: 0, medium: 1, low: 2 }[b.priority]));
      programs.push({
        program_id: enroll.program_id, enrollment_id: enroll.enrollment_id, program_name: enroll.program_name, program_code: code,
        instructor_name: enroll.instructor_name, current_stage_name: enroll.current_stage_name, started_at: enroll.started_at,
        readiness_pct,
        hours: { total: Math.round(hoursMap.total * 10) / 10, solo: Math.round(hoursMap.solo * 10) / 10, night: Math.round(hoursMap.night * 10) / 10, xc: Math.round(hoursMap.xc * 10) / 10, instrument: Math.round(hoursMap.instrument * 10) / 10 },
        stages: { total: totalStages, completed: completedStages, list: stages },
        maneuvers: { total: totalManeuvers, proficient: proficientManeuvers },
        categories, endorsements: endorseResult.rows, recommendations,
        debriefs: debriefsResult.rows.map(d => ({ ...d, grades: debrief_grades.filter(g => g.debrief_id === d.id) })),
      });
    }
    res.json({ programs });
  } catch (err) {
    console.error('Checkride readiness error:', err);
    res.status(500).json({ error: 'Failed to load readiness data' });
  }
});

router.get('/cohort-stats/:programCode', authenticateToken, async (req, res) => {
  try {
    const { programCode } = req.params;
    const progResult = await pool.query('SELECT id FROM training_programs WHERE code = $1', [programCode]);
    if (progResult.rows.length === 0) return res.json({ cohort_size: 0, enough_data: false });
    const programId = progResult.rows[0].id;
    const studentsResult = await pool.query(`
      SELECT st.student_id, COALESCE(SUM(fl.hobbs_delta), 0) as total_hours
      FROM student_training st LEFT JOIN flight_logs fl ON fl.student_id = st.student_id
      WHERE st.program_id = $1 AND st.status = 'active' GROUP BY st.student_id`, [programId]);
    const cohort = studentsResult.rows;
    if (cohort.length < 2) return res.json({ cohort_size: cohort.length, enough_data: false });
    const hours = cohort.map(s => parseFloat(s.total_hours) || 0).sort((a, b) => a - b);
    const avg = hours.reduce((s, h) => s + h, 0) / hours.length;
    let percentile = null;
    if (req.user.role === 'student') {
      const myData = cohort.find(s => s.student_id === req.user.id);
      if (myData) {
        const myHrs = parseFloat(myData.total_hours) || 0;
        const below = hours.filter(h => h < myHrs).length;
        percentile = Math.round((below / hours.length) * 100);
      }
    }
    res.json({ cohort_size: cohort.length, avg_hours: Math.round(avg * 10) / 10, percentile, enough_data: true });
  } catch (err) {
    console.error('Cohort stats error:', err);
    res.status(500).json({ error: 'Failed to load cohort stats' });
  }
});

// GET /my-progress — student self-view of their own training progress
router.get('/my-progress', authenticateToken, async (req, res) => {
  try {
    const studentId = req.user.id;
    const data = await trainingDb.getStudentProgress(studentId);
    res.json(data);
  } catch (err) {
    console.error('[training] GET /my-progress error:', err.message);
    res.status(500).json({ error: 'Failed to load your progress' });
  }
});

// GET /maneuver-progress/:studentId/:enrollmentId — maneuver status per enrollment
router.get('/maneuver-progress/:studentId/:enrollmentId', authenticateToken, async (req, res) => {
  try {
    const studentId = parseInt(req.params.studentId, 10);
    const enrollmentId = parseInt(req.params.enrollmentId, 10);
    if (isNaN(studentId) || isNaN(enrollmentId)) return res.status(400).json({ error: 'Invalid IDs' });
    // Students can only view their own; instructors/admin/owner can view any
    if (req.user.role === 'student' && req.user.id !== studentId) return res.status(403).json({ error: 'Access denied' });
    const rows = await trainingDb.getManeuverProgress(studentId, enrollmentId);
    res.json(rows);
  } catch (err) {
    console.error('[training] GET /maneuver-progress error:', err.message);
    res.status(500).json({ error: 'Failed to load maneuver progress' });
  }
});

// PUT /maneuver-progress — update maneuver status (introduced/practiced/proficient)
router.put('/maneuver-progress', authenticateToken, async (req, res) => {
  try {
    const { student_id, maneuver_id, status } = req.body;
    if (!student_id || !maneuver_id || !status) {
      return res.status(400).json({ error: 'student_id, maneuver_id, and status are required' });
    }
    const canUpdate = ['owner', 'admin', 'instructor'].includes(req.user.role)
      || (req.user.is_instructor && req.user.role !== 'student');
    if (!canUpdate) return res.status(403).json({ error: 'Only instructors can update maneuver progress' });
    const result = await trainingDb.upsertManeuverProgress(student_id, maneuver_id, status);
    res.json(result);
  } catch (err) {
    console.error('[training] PUT /maneuver-progress error:', err.message);
    res.status(500).json({ error: 'Failed to update maneuver progress' });
  }
});

// GET /students — list students with training enrollments (for progress page)
router.get('/students', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        u.id, u.name, u.phone_number,
        (SELECT MAX(flight_date) FROM flight_logs WHERE student_id = u.id) AS last_flight_date,
        COALESCE(json_agg(DISTINCT jsonb_build_object(
          'id', st.id,
          'program_code', tp.code,
          'program_name', tp.name,
          'current_stage_name', ps.name,
          'instructor_name', instructor.name,
          'stages_total', (SELECT COUNT(*) FROM program_stages ps2 WHERE ps2.program_id = st.program_id),
          'stages_completed', (SELECT COUNT(*) FROM program_stages ps3
            JOIN stage_maneuvers sm ON sm.stage_id = ps3.id
            LEFT JOIN student_maneuver_progress smp ON smp.maneuver_id = sm.id AND smp.student_id = u.id
            WHERE ps3.program_id = st.program_id AND smp.status IN ('proficient','completed'))
        )) FILTER (WHERE st.id IS NOT NULL), '[]') AS enrollments
      FROM users u
      JOIN student_training st ON st.student_id = u.id AND st.status = 'active'
      LEFT JOIN training_programs tp ON tp.id = st.program_id
      LEFT JOIN users instructor ON instructor.id = st.instructor_id
      LEFT JOIN program_stages ps ON ps.id = st.current_stage_id
      WHERE u.role = 'student' AND u.deleted_at IS NULL
      GROUP BY u.id, u.name, u.phone_number, last_flight_date
      ORDER BY u.name
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[training] GET /students error:', err.message);
    res.status(500).json({ error: 'Failed to load students' });
  }
});

// GET /students/:studentId — single student detail with enrollments + debriefs
router.get('/students/:studentId', authenticateToken, async (req, res) => {
  try {
    const studentId = parseInt(req.params.studentId, 10);
    if (isNaN(studentId)) return res.status(400).json({ error: 'Invalid student ID' });

    const studentResult = await pool.query(
      'SELECT id, name, email, phone_number FROM users WHERE id = $1 AND deleted_at IS NULL',
      [studentId]
    );
    if (studentResult.rows.length === 0) return res.status(404).json({ error: 'Student not found' });

    const enrollmentsResult = await pool.query(`
      SELECT st.id, st.program_id, st.instructor_id, st.current_stage_id, st.status, st.started_at,
             tp.name AS program_name, tp.code AS program_code,
             instructor.name AS instructor_name,
             ps.name AS current_stage_name,
             (SELECT COUNT(*) FROM program_stages WHERE program_id = tp.id) AS stages_total,
             0 AS stages_completed
      FROM student_training st
      JOIN training_programs tp ON tp.id = st.program_id
      LEFT JOIN users instructor ON instructor.id = st.instructor_id
      LEFT JOIN program_stages ps ON ps.id = st.current_stage_id
      WHERE st.student_id = $1 AND st.status = 'active'
      ORDER BY st.started_at DESC
    `, [studentId]);

    const debriefsResult = await pool.query(`
      SELECT fd.id, fd.flight_date, fd.notes, fd.overall_performance, fd.recommendations,
             u.name AS instructor_name, ps.name AS stage_name, tp.code AS program_code
      FROM flight_debriefs fd
      LEFT JOIN users u ON u.id = fd.instructor_id
      LEFT JOIN program_stages ps ON ps.id = fd.stage_id
      LEFT JOIN training_programs tp ON tp.id = ps.program_id
      WHERE fd.student_id = $1
      ORDER BY fd.flight_date DESC
      LIMIT 20
    `, [studentId]);

    // Build stages + maneuvers with status for each enrollment
    const enrollments = [];
    for (const enroll of enrollmentsResult.rows) {
      const stagesResult = await pool.query(`
        SELECT ps.id, ps.name, ps.order_index,
               (SELECT COUNT(*) FROM stage_maneuvers WHERE stage_id = ps.id) AS maneuver_count
        FROM program_stages ps WHERE ps.program_id = $1 ORDER BY ps.order_index
      `, [enroll.program_id]);

      const stages = [];
      for (const stage of stagesResult.rows) {
        const maneuversResult = await pool.query(`
          SELECT sm.id, sm.name, sm.description, sm.order_index, sm.proficiency_standard,
                 smp.status, smp.notes, smp.proficient_date
          FROM stage_maneuvers sm
          LEFT JOIN student_maneuver_progress smp ON smp.maneuver_id = sm.id AND smp.student_id = $1
          WHERE sm.stage_id = $2
          ORDER BY sm.order_index
        `, [studentId, stage.id]);

        const completionResult = await pool.query(
          `SELECT COUNT(*) as cnt FROM stage_maneuvers sm
           LEFT JOIN student_maneuver_progress smp ON smp.maneuver_id = sm.id AND smp.student_id = $1
           WHERE sm.stage_id = $2 AND smp.status IN ('proficient','completed')`,
          [studentId, stage.id]
        );
        const milestoneResult = await pool.query(
          `SELECT completed_at FROM milestone_completions WHERE student_id = $1 AND stage_id = $2 LIMIT 1`,
          [studentId, stage.id]
        );
        const isCompleteByManeuvers = parseInt(stage.maneuver_count) > 0
          && parseInt(completionResult.rows[0].cnt) >= parseInt(stage.maneuver_count);
        const isComplete = isCompleteByManeuvers || milestoneResult.rows.length > 0;

        stages.push({
          ...stage,
          maneuver_count: parseInt(stage.maneuver_count),
          completion: isComplete
            ? { completed_at: milestoneResult.rows[0]?.completed_at || new Date() }
            : null,
          completed: isComplete,
          maneuvers: maneuversResult.rows.map(m => ({
            ...m,
            status: m.status || 'not_started',
            notes: m.notes || null,
            proficient_date: m.proficient_date || null,
          })),
        });
      }

      const completedCount = stages.filter(s => s.completion && s.completion.completed_at).length;
      enrollments.push({
        ...enroll,
        stages_total: stages.length,
        stages_completed: completedCount,
        stages,
        debriefs: debriefsResult.rows.filter(d => !d.program_code || d.program_code === enroll.program_code).slice(0, 5),
      });
    }

    // Include flight hour totals the frontend expects
    const flightHours = await trainingDb.getStudentFlightHours(studentId);

    res.json({
      student: {
        ...studentResult.rows[0],
        total_hobbs_hours: parseFloat(flightHours.total_hobbs_hours) || 0,
        total_tach_hours: parseFloat(flightHours.total_tach_hours) || 0,
      },
      enrollments,
      debriefs: debriefsResult.rows,
    });
  } catch (err) {
    console.error('[training] GET /students/:studentId error:', err.message);
    res.status(500).json({ error: 'Failed to load student detail' });
  }
});

// GET /students/:studentId/debriefs — debrief history for a student
router.get('/students/:studentId/debriefs', authenticateToken, async (req, res) => {
  try {
    const studentId = parseInt(req.params.studentId, 10);
    if (isNaN(studentId)) return res.status(400).json({ error: 'Invalid student ID' });

    const result = await pool.query(`
      SELECT fd.id, fd.flight_date, fd.notes, fd.overall_performance, fd.recommendations,
             u.name AS instructor_name, ps.name AS stage_name, tp.code AS program_code
      FROM flight_debriefs fd
      LEFT JOIN users u ON u.id = fd.instructor_id
      LEFT JOIN program_stages ps ON ps.id = fd.stage_id
      LEFT JOIN training_programs tp ON tp.id = ps.program_id
      WHERE fd.student_id = $1
      ORDER BY fd.flight_date DESC
      LIMIT 50
    `, [studentId]);

    res.json(result.rows);
  } catch (err) {
    console.error('[training] GET /students/:studentId/debriefs error:', err.message);
    res.status(500).json({ error: 'Failed to load debriefs' });
  }
});

// POST /debriefs — create a flight debrief with optional per-maneuver grades
router.post('/debriefs', authenticateToken, async (req, res) => {
  try {
    // Only instructors/admins/owners can create debriefs
    if (req.user.role === 'student') return res.status(403).json({ error: 'Only instructors can create debriefs' });
    const { student_id, booking_id, stage_id, notes, recommendations, overall_performance, flight_date, grades } = req.body;
    if (!student_id) return res.status(400).json({ error: 'student_id is required' });
    const debrief = await trainingDb.createDebrief({
      studentId: student_id,
      instructorId: req.user.id,
      bookingId: booking_id,
      stageId: stage_id,
      notes,
      recommendations,
      overallPerformance: overall_performance,
      flightDate: flight_date,
      grades,
    });
    res.status(201).json(debrief);
  } catch (err) {
    console.error('[training] POST /debriefs error:', err.message);
    res.status(500).json({ error: 'Failed to save debrief' });
  }
});

// POST /milestones — instructor sign-off on a training stage
router.post('/milestones', authenticateToken, async (req, res) => {
  try {
    if (req.user.role === 'student') return res.status(403).json({ error: 'Only instructors can sign off stages' });
    const { student_id, stage_id, enrollment_id, notes, debrief_id } = req.body;
    if (!student_id || !stage_id || !enrollment_id) {
      return res.status(400).json({ error: 'student_id, stage_id, and enrollment_id are required' });
    }
    const result = await trainingDb.completeStageMilestone({
      studentId: parseInt(student_id, 10),
      stageId: parseInt(stage_id, 10),
      enrollmentId: parseInt(enrollment_id, 10),
      completedBy: req.user.id,
      notes: notes || null,
      debriefId: debrief_id ? parseInt(debrief_id, 10) : null,
    });
    res.status(201).json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[training] POST /milestones error:', err.message);
    res.status(500).json({ error: 'Failed to sign off stage' });
  }
});

// GET /instructors — list instructors with active student count
router.get('/instructors', authenticateToken, async (req, res) => {
  try {
    // LEFT JOIN so instructors with zero active students still appear
    const result = await pool.query(`
      SELECT u.id, u.name, COUNT(DISTINCT st.student_id) AS student_count
      FROM users u
      LEFT JOIN student_training st ON st.instructor_id = u.id AND st.status = 'active'
      WHERE u.is_instructor = true AND u.deleted_at IS NULL
      GROUP BY u.id, u.name
      ORDER BY u.name
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[training] GET /instructors error:', err.message);
    res.status(500).json({ error: 'Failed to load instructors' });
  }
});

// PATCH /enroll/:id — reassign instructor on an existing enrollment
router.patch('/enroll/:id', authenticateToken, requireRole('owner', 'admin', 'instructor'), async (req, res) => {
  try {
    const enrollmentId = parseInt(req.params.id, 10);
    if (isNaN(enrollmentId)) return res.status(400).json({ error: 'Invalid enrollment ID' });

    const { instructor_id } = req.body;
    const updated = await trainingDb.reassignInstructor(
      enrollmentId,
      instructor_id ? parseInt(instructor_id) : null,
      req.user
    );
    res.json(updated);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[training] PATCH /enroll/:id error:', err.message);
    res.status(500).json({ error: 'Failed to reassign instructor' });
  }
});

module.exports = router;