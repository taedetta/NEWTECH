-- Incremental schema patches for local/Render DBs created from older bootstrap-schema.sql
-- Safe to re-run (IF NOT EXISTS / idempotent updates).

-- ── Squawks ──
ALTER TABLE squawks ADD COLUMN IF NOT EXISTS reported_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE squawks ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE squawks ADD COLUMN IF NOT EXISTS resolution_notes TEXT;
UPDATE squawks SET reported_at = COALESCE(reported_at, created_at, NOW()) WHERE reported_at IS NULL;

-- ── Aircraft hours history ──
ALTER TABLE aircraft_hours_history ADD COLUMN IF NOT EXISTS changed_by INTEGER REFERENCES users(id);
ALTER TABLE aircraft_hours_history ADD COLUMN IF NOT EXISTS note TEXT;

-- ── Flight logs ──
ALTER TABLE flight_logs ADD COLUMN IF NOT EXISTS aircraft_charge_amount DECIMAL(10,2);
ALTER TABLE flight_logs ADD COLUMN IF NOT EXISTS instruction_charge_amount DECIMAL(10,2);

-- ── Discovery flight leads ──
ALTER TABLE discovery_flight_leads ADD COLUMN IF NOT EXISTS preferred_date DATE;
ALTER TABLE discovery_flight_leads ADD COLUMN IF NOT EXISTS experience_level VARCHAR(50);
ALTER TABLE discovery_flight_leads ADD COLUMN IF NOT EXISTS message TEXT;
UPDATE discovery_flight_leads SET experience_level = experience WHERE experience_level IS NULL AND experience IS NOT NULL;

-- ── At-risk assessments ──
ALTER TABLE at_risk_assessments ADD COLUMN IF NOT EXISTS manual_override_level VARCHAR(20);
ALTER TABLE at_risk_assessments ADD COLUMN IF NOT EXISTS manual_override_notes TEXT;
ALTER TABLE at_risk_assessments ADD COLUMN IF NOT EXISTS manual_override_by INTEGER REFERENCES users(id);
ALTER TABLE at_risk_assessments ADD COLUMN IF NOT EXISTS manual_override_at TIMESTAMPTZ;
UPDATE at_risk_assessments SET manual_override_level = manual_override WHERE manual_override_level IS NULL AND manual_override IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS at_risk_assessments_student_id_unique ON at_risk_assessments(student_id);

-- ── Student interventions ──
ALTER TABLE student_interventions ADD COLUMN IF NOT EXISTS instructor_id INTEGER REFERENCES users(id);
ALTER TABLE student_interventions ADD COLUMN IF NOT EXISTS action_taken TEXT;
ALTER TABLE student_interventions ADD COLUMN IF NOT EXISTS action_date DATE;

-- ── Instructor hours (expanded from legacy period-based table) ──
ALTER TABLE instructor_hours ADD COLUMN IF NOT EXISTS entry_date DATE;
ALTER TABLE instructor_hours ADD COLUMN IF NOT EXISTS aircraft_id INTEGER REFERENCES aircraft(id);
ALTER TABLE instructor_hours ADD COLUMN IF NOT EXISTS aircraft_hours DECIMAL(8,2) DEFAULT 0;
ALTER TABLE instructor_hours ADD COLUMN IF NOT EXISTS instruction_hours DECIMAL(8,2) DEFAULT 0;
ALTER TABLE instructor_hours ADD COLUMN IF NOT EXISTS aircraft_rate DECIMAL(8,2);
ALTER TABLE instructor_hours ADD COLUMN IF NOT EXISTS instructor_rate DECIMAL(8,2);
ALTER TABLE instructor_hours ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE instructor_hours ADD COLUMN IF NOT EXISTS student_name VARCHAR(255);
ALTER TABLE instructor_hours ADD COLUMN IF NOT EXISTS booking_id INTEGER REFERENCES bookings(id);
ALTER TABLE instructor_hours ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- ── Instructor availability overrides ──
ALTER TABLE instructor_availability_overrides ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE instructor_availability_overrides ADD COLUMN IF NOT EXISTS end_date DATE;
ALTER TABLE instructor_availability_overrides ADD COLUMN IF NOT EXISTS override_type VARCHAR(30);
UPDATE instructor_availability_overrides
SET start_date = COALESCE(start_date, override_date),
    end_date = COALESCE(end_date, override_date)
WHERE start_date IS NULL AND override_date IS NOT NULL;

-- ── Seed default at-risk thresholds if missing ──
INSERT INTO school_settings (key, value, updated_at) VALUES
  ('at_risk_low_days', '14', NOW()),
  ('at_risk_medium_days', '21', NOW()),
  ('at_risk_high_days', '30', NOW()),
  ('at_risk_critical_days', '45', NOW())
ON CONFLICT (key) DO NOTHING;

-- ── Flight hobbs readings ──
ALTER TABLE flight_hobbs_readings ADD COLUMN IF NOT EXISTS hobbs_delta DECIMAL(8,2);
ALTER TABLE flight_hobbs_readings ADD COLUMN IF NOT EXISTS entered_at TIMESTAMPTZ DEFAULT NOW();
CREATE UNIQUE INDEX IF NOT EXISTS flight_hobbs_readings_booking_role_unique ON flight_hobbs_readings(booking_id, role);

-- ── Flight discrepancies ──
ALTER TABLE flight_discrepancies ADD COLUMN IF NOT EXISTS flagged_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE flight_discrepancies ADD COLUMN IF NOT EXISTS student_hobbs_start DECIMAL(8,1);
ALTER TABLE flight_discrepancies ADD COLUMN IF NOT EXISTS student_hobbs_end DECIMAL(8,1);
ALTER TABLE flight_discrepancies ADD COLUMN IF NOT EXISTS instructor_hobbs_start DECIMAL(8,1);
ALTER TABLE flight_discrepancies ADD COLUMN IF NOT EXISTS instructor_hobbs_end DECIMAL(8,1);
ALTER TABLE flight_discrepancies ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE flight_discrepancies ADD COLUMN IF NOT EXISTS resolution_reading VARCHAR(20);
ALTER TABLE flight_discrepancies ADD COLUMN IF NOT EXISTS resolution_note TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS flight_discrepancies_booking_id_unique ON flight_discrepancies(booking_id);
