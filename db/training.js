/**
 * Training progress DB queries — student self-view, maneuver progress tracking.
 * Does NOT own: training program CRUD, admin endpoints, checkride readiness (those remain in routes/training.js inline).
 */
'use strict';

const pool = require('./index');

/**
 * Get a student's active training enrollments with stages, maneuvers, and debriefs.
 * Used by GET /my-progress (student self-view) and reusable for detail views.
 */
async function getStudentProgress(studentId) {
  const enrollmentsResult = await pool.query(`
    SELECT st.id, st.program_id, st.instructor_id, st.current_stage_id, st.status, st.started_at,
           tp.name AS program_name, tp.code AS program_code,
           instructor.name AS instructor_name,
           ps.name AS current_stage_name,
           (SELECT COUNT(*) FROM program_stages WHERE program_id = tp.id) AS stages_total
    FROM student_training st
    JOIN training_programs tp ON tp.id = st.program_id
    LEFT JOIN users instructor ON instructor.id = st.instructor_id
    LEFT JOIN program_stages ps ON ps.id = st.current_stage_id
    WHERE st.student_id = $1 AND st.status = 'active'
    ORDER BY st.started_at DESC
  `, [studentId]);

  const enrollments = [];
  for (const enroll of enrollmentsResult.rows) {
    const stagesResult = await pool.query(`
      SELECT ps.id, ps.name, ps.order_index,
             (SELECT COUNT(*) FROM stage_maneuvers WHERE stage_id = ps.id) AS maneuver_count
      FROM program_stages ps WHERE ps.program_id = $1 ORDER BY ps.order_index
    `, [enroll.program_id]);

    const stages = [];
    let completedStages = 0;
    for (const stage of stagesResult.rows) {
      const maneuversResult = await pool.query(`
        SELECT sm.id, sm.name, sm.description, sm.order_index, sm.proficiency_standard,
               sm.lesson_type, sm.module_number, sm.reading_assignment, sm.lesson_tasks,
               smp.status, smp.notes, smp.proficient_date
        FROM stage_maneuvers sm
        LEFT JOIN student_maneuver_progress smp ON smp.maneuver_id = sm.id AND smp.student_id = $1
        WHERE sm.stage_id = $2 ORDER BY sm.order_index
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
      const mCount = parseInt(stage.maneuver_count);
      const isCompleteByManeuvers = mCount > 0 && parseInt(completionResult.rows[0].cnt) >= mCount;
      const isComplete = isCompleteByManeuvers || milestoneResult.rows.length > 0;
      if (isComplete) completedStages++;

      stages.push({
        ...stage,
        maneuver_count: mCount,
        completion: isComplete
          ? { completed_at: milestoneResult.rows[0]?.completed_at || new Date() }
          : null,
        completed: isComplete,
        maneuvers: maneuversResult.rows.map(m => ({
          ...m,
          status: m.status || 'not_started',
          notes: m.notes || null,
          proficient_date: m.proficient_date || null,
          lesson_tasks: Array.isArray(m.lesson_tasks) ? m.lesson_tasks : (m.lesson_tasks ? JSON.parse(m.lesson_tasks) : []),
        })),
      });
    }

    enrollments.push({
      ...enroll,
      stages_total: stages.length,
      stages_completed: completedStages,
      stages,
    });
  }

  // Debriefs
  const debriefsResult = await pool.query(`
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

  return { enrollments, debriefs: debriefsResult.rows };
}

/**
 * Get maneuver progress for a student within a specific enrollment.
 * Returns flat array of { maneuver_id, maneuver_name, stage_id, status, notes, proficient_date }.
 */
async function getManeuverProgress(studentId, enrollmentId) {
  // Resolve enrollment to program_id
  const enrollResult = await pool.query(
    'SELECT program_id FROM student_training WHERE id = $1 AND student_id = $2',
    [enrollmentId, studentId]
  );
  if (enrollResult.rows.length === 0) return [];

  const programId = enrollResult.rows[0].program_id;
  const result = await pool.query(`
    SELECT sm.id AS maneuver_id, sm.name AS maneuver_name, sm.stage_id, sm.order_index,
           sm.lesson_type, sm.module_number, sm.description, sm.proficiency_standard,
           sm.reading_assignment, sm.lesson_tasks,
           COALESCE(smp.status, 'not_started') AS status, smp.notes, smp.proficient_date
    FROM stage_maneuvers sm
    JOIN program_stages ps ON ps.id = sm.stage_id AND ps.program_id = $1
    LEFT JOIN student_maneuver_progress smp ON smp.maneuver_id = sm.id AND smp.student_id = $2
    ORDER BY ps.order_index, sm.order_index
  `, [programId, studentId]);

  return result.rows.map(r => ({
    ...r,
    lesson_tasks: Array.isArray(r.lesson_tasks) ? r.lesson_tasks : (r.lesson_tasks ? r.lesson_tasks : []),
  }));
}

/**
 * Upsert maneuver progress status for a student.
 * Maps frontend statuses (introduced/practiced/proficient) to DB values.
 */
async function upsertManeuverProgress(studentId, maneuverId, status) {
  // Map frontend status names to DB enum values
  const statusMap = {
    'introduced': 'in_progress',
    'practiced': 'needs_review',
    'proficient': 'proficient',
    'not_started': 'not_started',
    'in_progress': 'in_progress',
    'needs_review': 'needs_review',
    'completed': 'completed',
  };
  const dbStatus = statusMap[status] || status;
  const profDate = (dbStatus === 'proficient' || dbStatus === 'completed') ? new Date() : null;

  if (dbStatus === 'not_started') {
    await pool.query(
      'DELETE FROM student_maneuver_progress WHERE student_id = $1 AND maneuver_id = $2',
      [studentId, maneuverId]
    );
    return { student_id: studentId, maneuver_id: maneuverId, status: 'not_started' };
  }

  const result = await pool.query(
    `INSERT INTO student_maneuver_progress (student_id, maneuver_id, status, proficient_date)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (student_id, maneuver_id) DO UPDATE SET status = $3, proficient_date = $4
     RETURNING *`,
    [studentId, maneuverId, dbStatus, profDate]
  );
  return result.rows[0];
}

/**
 * Get total Hobbs and Tach hours for a student from flight_logs.
 */
async function getStudentFlightHours(studentId) {
  const result = await pool.query(
    `SELECT COALESCE(SUM(hobbs_delta), 0) AS total_hobbs_hours,
            COALESCE(SUM(tach_delta), 0) AS total_tach_hours
     FROM flight_logs WHERE student_id = $1`,
    [studentId]
  );
  return result.rows[0];
}

/**
 * Create a flight debrief with optional per-maneuver grades.
 * Wraps insert in a transaction so the debrief + grades are atomic.
 */
async function createDebrief({ studentId, instructorId, bookingId, stageId, notes, recommendations, overallPerformance, flightDate, grades }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const debriefResult = await client.query(
      `INSERT INTO flight_debriefs (student_id, instructor_id, booking_id, stage_id, notes, recommendations, overall_performance, flight_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [studentId, instructorId, bookingId || null, stageId || null, notes || null, recommendations || null, overallPerformance || null, flightDate || new Date()]
    );
    const debrief = debriefResult.rows[0];

    // Insert per-maneuver grades if provided
    if (grades && typeof grades === 'object') {
      const entries = Array.isArray(grades) ? grades : Object.entries(grades).map(([name, grade]) => ({ maneuver_name: name, grade }));
      for (const g of entries) {
        const name = g.maneuver_name || g.name;
        const grade = parseInt(g.grade);
        if (name && !isNaN(grade)) {
          await client.query(
            `INSERT INTO debrief_grades (debrief_id, maneuver_name, grade, notes) VALUES ($1, $2, $3, $4)`,
            [debrief.id, name, grade, g.notes || null]
          );
        }
      }
    }

    await client.query('COMMIT');
    return debrief;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Enroll a student in a training program with optional instructor.
 * Auto-sets current_stage_id to the program's first stage.
 */
async function enrollStudent(studentId, programId, instructorId) {
  // Verify program exists
  const progCheck = await pool.query('SELECT id FROM training_programs WHERE id = $1', [programId]);
  if (progCheck.rows.length === 0) {
    const err = new Error('Training program not found');
    err.status = 404;
    throw err;
  }

  // Verify student exists and is a student
  const studentCheck = await pool.query(
    "SELECT id, role FROM users WHERE id = $1 AND deleted_at IS NULL",
    [studentId]
  );
  if (studentCheck.rows.length === 0) {
    const err = new Error('Student not found');
    err.status = 404;
    throw err;
  }
  if (studentCheck.rows[0].role !== 'student') {
    const err = new Error('User is not a student');
    err.status = 400;
    throw err;
  }

  // Verify instructor exists if provided
  if (instructorId) {
    const instrCheck = await pool.query(
      "SELECT id, role FROM users WHERE id = $1 AND deleted_at IS NULL AND role IN ('instructor','admin','owner')",
      [instructorId]
    );
    if (instrCheck.rows.length === 0) {
      const err = new Error('Instructor not found');
      err.status = 404;
      throw err;
    }
  }

  // Get first stage of the program for auto-assignment
  const firstStage = await pool.query(
    'SELECT id FROM program_stages WHERE program_id = $1 ORDER BY order_index ASC LIMIT 1',
    [programId]
  );
  const firstStageId = firstStage.rows.length > 0 ? firstStage.rows[0].id : null;

  const result = await pool.query(
    `INSERT INTO student_training (student_id, program_id, instructor_id, current_stage_id)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [studentId, programId, instructorId || null, firstStageId]
  );
  return result.rows[0];
}

/**
 * Reassign the instructor on an existing enrollment.
 * Validates enrollment exists and new instructor is valid (or null for unassigned).
 */
async function reassignInstructor(enrollmentId, instructorId) {
  // Verify enrollment exists
  const enrollCheck = await pool.query(
    'SELECT id, student_id FROM student_training WHERE id = $1',
    [enrollmentId]
  );
  if (enrollCheck.rows.length === 0) {
    const err = new Error('Enrollment not found');
    err.status = 404;
    throw err;
  }

  // Verify instructor exists if provided
  if (instructorId) {
    const instrCheck = await pool.query(
      "SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL AND role IN ('instructor','admin','owner')",
      [instructorId]
    );
    if (instrCheck.rows.length === 0) {
      const err = new Error('Instructor not found');
      err.status = 404;
      throw err;
    }
  }

  const result = await pool.query(
    'UPDATE student_training SET instructor_id = $1 WHERE id = $2 RETURNING *',
    [instructorId || null, enrollmentId]
  );
  return result.rows[0];
}

/**
 * Get all student enrollments for a program with progress data.
 * Returns for each student: name, enrollment status, current stage,
 * total/completed stages, total/completed maneuvers.
 */
async function getProgramEnrollments(programId) {
  const result = await pool.query(`
    SELECT
      st.id AS enrollment_id,
      st.student_id,
      st.instructor_id,
      st.status,
      st.started_at,
      u.name AS student_name,
      instructor.name AS instructor_name,
      ps.name AS current_stage_name,
      (SELECT COUNT(*) FROM program_stages WHERE program_id = $1) AS stages_total,
      (SELECT COUNT(*) FROM program_stages ps2
       JOIN stage_maneuvers sm ON sm.stage_id = ps2.id
       LEFT JOIN student_maneuver_progress smp ON smp.maneuver_id = sm.id AND smp.student_id = st.student_id
       WHERE ps2.program_id = $1 AND smp.status IN ('proficient','completed')
      ) AS stages_completed,
      (SELECT COUNT(*) FROM stage_maneuvers sm2
       JOIN program_stages ps3 ON ps3.id = sm2.stage_id
       WHERE ps3.program_id = $1
      ) AS maneuvers_total,
      (SELECT COUNT(*) FROM stage_maneuvers sm2
       JOIN program_stages ps3 ON ps3.id = sm2.stage_id
       LEFT JOIN student_maneuver_progress smp ON smp.maneuver_id = sm2.id AND smp.student_id = st.student_id
       WHERE ps3.program_id = $1 AND smp.status IN ('proficient','completed')
      ) AS maneuvers_completed
    FROM student_training st
    JOIN users u ON u.id = st.student_id
    LEFT JOIN users instructor ON instructor.id = st.instructor_id
    LEFT JOIN program_stages ps ON ps.id = st.current_stage_id
    WHERE st.program_id = $1 AND st.status = 'active'
    ORDER BY u.name
  `, [programId]);
  return result.rows;
}

/**
 * Instructor sign-off: record stage milestone and advance enrollment to next stage.
 */
async function completeStageMilestone({ studentId, stageId, enrollmentId, completedBy, notes, debriefId }) {
  const enrollResult = await pool.query(
    'SELECT * FROM student_training WHERE id = $1 AND student_id = $2',
    [enrollmentId, studentId]
  );
  if (enrollResult.rows.length === 0) {
    const err = new Error('Enrollment not found');
    err.status = 404;
    throw err;
  }
  const enroll = enrollResult.rows[0];

  const stageResult = await pool.query(
    'SELECT id, program_id, order_index FROM program_stages WHERE id = $1',
    [stageId]
  );
  if (stageResult.rows.length === 0 || stageResult.rows[0].program_id !== enroll.program_id) {
    const err = new Error('Stage not found in this program');
    err.status = 400;
    throw err;
  }
  const stage = stageResult.rows[0];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO milestone_completions (student_id, stage_id, completed_by, debrief_id, notes)
       VALUES ($1, $2, $3, $4, $5)`,
      [studentId, stageId, completedBy, debriefId || null, notes || null]
    );

    const nextStage = await client.query(
      `SELECT id FROM program_stages
       WHERE program_id = $1 AND order_index > $2
       ORDER BY order_index ASC LIMIT 1`,
      [enroll.program_id, stage.order_index]
    );
    const nextStageId = nextStage.rows.length > 0 ? nextStage.rows[0].id : stageId;
    await client.query(
      `UPDATE student_training SET current_stage_id = $1, updated_at = NOW() WHERE id = $2`,
      [nextStageId, enrollmentId]
    );
    await client.query('COMMIT');
    return { ok: true, next_stage_id: nextStageId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  getStudentProgress,
  getManeuverProgress,
  upsertManeuverProgress,
  getStudentFlightHours,
  createDebrief,
  enrollStudent,
  reassignInstructor,
  getProgramEnrollments,
  completeStageMilestone,
};
