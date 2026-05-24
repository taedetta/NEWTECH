#!/usr/bin/env node
'use strict';

/**
 * Seed ASA PM-S-P9-PD Private Pilot syllabus into training_programs / program_stages / stage_maneuvers.
 * Safe to re-run: replaces PPL structure while preserving enrollments (progress is cleared on re-seed).
 */
const pool = require('../db/index');
const syllabus = require('../data/ppl-pm-syllabus');

const SYLLABUS_REF = syllabus.program.syllabus_ref || 'PM-S-P9-PD';

async function seedPplPmSyllabus() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Ensure program exists / update description
    let progResult = await client.query(
      `INSERT INTO training_programs (name, code, description)
       VALUES ($1, $2, $3)
       ON CONFLICT (code) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description
       RETURNING id`,
      [syllabus.program.name, syllabus.program.code, syllabus.program.description]
    );
    const programId = progResult.rows[0].id;

    // Skip if already seeded with expected lesson count
    const existing = await client.query(
      `SELECT COUNT(*) AS cnt FROM stage_maneuvers sm
       JOIN program_stages ps ON ps.id = sm.stage_id
       WHERE ps.program_id = $1 AND sm.lesson_type IS NOT NULL`,
      [programId]
    );
    const existingCount = parseInt(existing.rows[0].cnt, 10);
    if (existingCount >= syllabus.lessons.length - 5) {
      console.log(`[ppl-syllabus] Already seeded (${existingCount} lessons) — skipping`);
      await client.query('ROLLBACK');
      return;
    }

    console.log(`[ppl-syllabus] Replacing PPL syllabus with ${syllabus.lessons.length} ASA lessons (${SYLLABUS_REF})`);

    // Clear maneuver progress for this program's maneuvers
    await client.query(
      `DELETE FROM student_maneuver_progress
       WHERE maneuver_id IN (
         SELECT sm.id FROM stage_maneuvers sm
         JOIN program_stages ps ON ps.id = sm.stage_id
         WHERE ps.program_id = $1
       )`,
      [programId]
    );

    await client.query(
      `DELETE FROM milestone_completions
       WHERE stage_id IN (SELECT id FROM program_stages WHERE program_id = $1)`,
      [programId]
    );

    await client.query(
      `DELETE FROM stage_maneuvers
       WHERE stage_id IN (SELECT id FROM program_stages WHERE program_id = $1)`,
      [programId]
    );

    await client.query(`DELETE FROM program_stages WHERE program_id = $1`, [programId]);

    // Unique stage names in order
    const stageNames = [];
    for (const les of syllabus.lessons) {
      if (!stageNames.includes(les.stage)) stageNames.push(les.stage);
    }

    const stageIdByName = {};
    for (let i = 0; i < stageNames.length; i++) {
      const r = await client.query(
        `INSERT INTO program_stages (program_id, name, order_index, description)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [programId, stageNames[i], i + 1, `ASA PM-S-P9-PD — ${stageNames[i]}`]
      );
      stageIdByName[stageNames[i]] = r.rows[0].id;
    }

    for (const les of syllabus.lessons) {
      const stageId = stageIdByName[les.stage];
      if (!stageId) continue;
      await client.query(
        `INSERT INTO stage_maneuvers
           (stage_id, name, description, proficiency_standard, order_index,
            lesson_type, module_number, reading_assignment, lesson_tasks)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          stageId,
          les.name,
          les.objective || null,
          les.completion_standard || null,
          les.order_index,
          les.lesson_type || 'flight',
          les.module || null,
          les.reading_assignment || null,
          JSON.stringify(les.tasks || []),
        ]
      );
    }

    // Reset enrollments to first stage
    const firstStageId = stageIdByName[stageNames[0]];
    if (firstStageId) {
      await client.query(
        `UPDATE student_training SET current_stage_id = $1, updated_at = NOW()
         WHERE program_id = $2 AND status = 'active'`,
        [firstStageId, programId]
      );
    }

    await client.query('COMMIT');
    console.log(`[ppl-syllabus] Seeded ${syllabus.lessons.length} lessons across ${stageNames.length} stages`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  seedPplPmSyllabus()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[ppl-syllabus] Failed:', err.message);
      process.exit(1);
    });
}

module.exports = { seedPplPmSyllabus };
