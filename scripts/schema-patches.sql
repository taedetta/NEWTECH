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
ALTER TABLE flight_logs ADD COLUMN IF NOT EXISTS booking_type VARCHAR(20);
ALTER TABLE flight_logs ADD COLUMN IF NOT EXISTS submitted_by INTEGER REFERENCES users(id);
ALTER TABLE flight_logs ADD COLUMN IF NOT EXISTS is_night BOOLEAN DEFAULT false;
ALTER TABLE flight_logs ADD COLUMN IF NOT EXISTS is_xc BOOLEAN DEFAULT false;
ALTER TABLE flight_logs ADD COLUMN IF NOT EXISTS is_instrument BOOLEAN DEFAULT false;
ALTER TABLE flight_logs ADD COLUMN IF NOT EXISTS is_solo BOOLEAN DEFAULT false;
ALTER TABLE flight_logs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- ── Discovery flight leads ──
ALTER TABLE discovery_flight_leads ADD COLUMN IF NOT EXISTS preferred_date VARCHAR(100);
ALTER TABLE discovery_flight_leads ALTER COLUMN preferred_date TYPE VARCHAR(100) USING preferred_date::text;
ALTER TABLE discovery_flight_leads ADD COLUMN IF NOT EXISTS experience_level VARCHAR(50);
ALTER TABLE discovery_flight_leads ADD COLUMN IF NOT EXISTS message TEXT;
UPDATE discovery_flight_leads SET experience_level = experience WHERE experience_level IS NULL AND experience IS NOT NULL;

-- ── At-risk assessments ──
ALTER TABLE at_risk_assessments ADD COLUMN IF NOT EXISTS manual_override_level VARCHAR(20);
ALTER TABLE at_risk_assessments ADD COLUMN IF NOT EXISTS manual_override_notes TEXT;
ALTER TABLE at_risk_assessments ADD COLUMN IF NOT EXISTS manual_override_by INTEGER REFERENCES users(id);
ALTER TABLE at_risk_assessments ADD COLUMN IF NOT EXISTS manual_override_at TIMESTAMPTZ;
UPDATE at_risk_assessments SET manual_override_level = manual_override WHERE manual_override_level IS NULL AND manual_override IS NOT NULL;
-- Dedupe before unique index (clone/migration may insert duplicates)
DELETE FROM at_risk_assessments a
USING at_risk_assessments b
WHERE a.student_id IS NOT NULL AND a.student_id = b.student_id AND a.id > b.id;
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
ALTER TABLE instructor_hours ADD COLUMN IF NOT EXISTS audit_status VARCHAR(20) DEFAULT 'pending';
ALTER TABLE instructor_hours ADD COLUMN IF NOT EXISTS audit_message TEXT;
UPDATE instructor_hours SET audit_status = 'pending' WHERE audit_status IS NULL;
UPDATE bookings SET source = 'production' WHERE source IS NULL;
UPDATE flight_logs SET source = 'production' WHERE source IS NULL;

-- ── Users: terms acceptance audit trail ──
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_version VARCHAR(32);

-- ── Leads: program interest + activity history ──
ALTER TABLE discovery_flight_leads ADD COLUMN IF NOT EXISTS program_interest VARCHAR(100);
ALTER TABLE discovery_flight_leads ADD COLUMN IF NOT EXISTS source_label VARCHAR(100);

CREATE TABLE IF NOT EXISTS lead_activity (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES discovery_flight_leads(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  activity_type VARCHAR(30) NOT NULL,
  body TEXT,
  old_status VARCHAR(20),
  new_status VARCHAR(20),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS lead_activity_lead_id_idx ON lead_activity(lead_id);

-- ── Instructor availability overrides ──
ALTER TABLE instructor_availability_overrides ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE instructor_availability_overrides ADD COLUMN IF NOT EXISTS end_date DATE;
ALTER TABLE instructor_availability_overrides ADD COLUMN IF NOT EXISTS override_type VARCHAR(30);
UPDATE instructor_availability_overrides
SET start_date = COALESCE(start_date, override_date),
    end_date = COALESCE(end_date, override_date)
WHERE start_date IS NULL AND override_date IS NOT NULL;

-- Backfill is_instructor for approved CFIs created before auto-flag fix
UPDATE users
SET is_instructor = TRUE, updated_at = NOW()
WHERE role = 'instructor'
  AND deleted_at IS NULL
  AND COALESCE(approval_status, 'approved') = 'approved'
  AND COALESCE(is_instructor, FALSE) = FALSE;

-- ── Seed default at-risk thresholds if missing ──
INSERT INTO school_settings (key, value, updated_at) VALUES
  ('at_risk_low_days', '14', NOW()),
  ('at_risk_medium_days', '21', NOW()),
  ('at_risk_high_days', '30', NOW()),
  ('at_risk_critical_days', '45', NOW())
ON CONFLICT (key) DO NOTHING;

-- ── User medical certificate tracking ──
ALTER TABLE users ADD COLUMN IF NOT EXISTS medical_certificate_expiry DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS medical_certificate_class VARCHAR(10);

-- ── Default booking policy settings ──
INSERT INTO school_settings (key, value, updated_at) VALUES
  ('booking_min_booking_duration_minutes', '30', NOW()),
  ('booking_min_lead_time_hours', '0', NOW()),
  ('booking_min_cancel_notice_hours', '0', NOW()),
  ('booking_business_hours_start', '0', NOW()),
  ('booking_business_hours_end', '24', NOW()),
  ('booking_max_advance_booking_days', '90', NOW())
ON CONFLICT (key) DO NOTHING;

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

-- ── Endorsements (FAA digital endorsements) ──
ALTER TABLE endorsements ADD COLUMN IF NOT EXISTS template_key VARCHAR(80);
ALTER TABLE endorsements ADD COLUMN IF NOT EXISTS endorsement_date DATE;
ALTER TABLE endorsements ADD COLUMN IF NOT EXISTS expiration_date DATE;
ALTER TABLE endorsements ADD COLUMN IF NOT EXISTS student_name VARCHAR(255);
ALTER TABLE endorsements ADD COLUMN IF NOT EXISTS instructor_name VARCHAR(255);
ALTER TABLE endorsements ADD COLUMN IF NOT EXISTS instructor_cert_number VARCHAR(50);
ALTER TABLE endorsements ADD COLUMN IF NOT EXISTS aircraft_make_model VARCHAR(100);
ALTER TABLE endorsements ADD COLUMN IF NOT EXISTS instructor_signature TEXT;
ALTER TABLE endorsements ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ;
ALTER TABLE endorsements ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45);
ALTER TABLE endorsements ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE endorsements ADD COLUMN IF NOT EXISTS metadata JSONB;

-- ── Airworthiness directives (fleet AD tracking) ──
CREATE TABLE IF NOT EXISTS airworthiness_directives (
  id SERIAL PRIMARY KEY,
  aircraft_id INTEGER REFERENCES aircraft(id) ON DELETE CASCADE,
  ad_number VARCHAR(50),
  description TEXT NOT NULL,
  due_date DATE,
  due_hobbs DECIMAL(8,1),
  status VARCHAR(20) DEFAULT 'open',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS airworthiness_directives_aircraft_id_idx ON airworthiness_directives(aircraft_id);

-- ── Training: stage maneuvers + student progress ──
ALTER TABLE stage_maneuvers ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE stage_maneuvers ADD COLUMN IF NOT EXISTS proficiency_standard TEXT;
ALTER TABLE stage_maneuvers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE stage_maneuvers ADD COLUMN IF NOT EXISTS lesson_type VARCHAR(20);
ALTER TABLE stage_maneuvers ADD COLUMN IF NOT EXISTS module_number INTEGER;
ALTER TABLE stage_maneuvers ADD COLUMN IF NOT EXISTS reading_assignment TEXT;
ALTER TABLE stage_maneuvers ADD COLUMN IF NOT EXISTS lesson_tasks JSONB DEFAULT '[]';
ALTER TABLE student_maneuver_progress ADD COLUMN IF NOT EXISTS notes TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS student_maneuver_progress_student_maneuver_unique ON student_maneuver_progress(student_id, maneuver_id);
CREATE UNIQUE INDEX IF NOT EXISTS student_training_student_program_unique ON student_training(student_id, program_id);

-- ── At-risk interventions ──
ALTER TABLE student_interventions ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ DEFAULT NOW();
UPDATE student_interventions SET occurred_at = COALESCE(occurred_at, created_at, NOW()) WHERE occurred_at IS NULL;

-- ── Ground sessions ──
ALTER TABLE ground_sessions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- ── Backfill hobbs_delta on existing readings ──
UPDATE flight_hobbs_readings
SET hobbs_delta = hobbs_end - hobbs_start
WHERE hobbs_delta IS NULL AND hobbs_start IS NOT NULL AND hobbs_end IS NOT NULL;

-- ── No advance booking or cancellation notice (last-minute OK) ──
INSERT INTO school_settings (key, value, updated_at) VALUES
  ('booking_min_lead_time_hours', '0', NOW()),
  ('booking_min_cancel_notice_hours', '0', NOW()),
  ('booking_business_hours_start', '0', NOW()),
  ('booking_business_hours_end', '24', NOW()),
  ('min_lead_time_hours', '0', NOW()),
  ('min_cancel_notice_hours', '0', NOW())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();

-- ── Multi-location bases ──
CREATE TABLE IF NOT EXISTS locations (
  id SERIAL PRIMARY KEY,
  code VARCHAR(10) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  timezone VARCHAR(64) DEFAULT 'America/New_York',
  weather_station VARCHAR(10),
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO locations (code, name, weather_station, is_default)
VALUES ('KPSK', 'New River Valley (Dublin, VA)', 'KPSK', true)
ON CONFLICT (code) DO NOTHING;
ALTER TABLE aircraft ADD COLUMN IF NOT EXISTS location_id INTEGER REFERENCES locations(id);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS location_id INTEGER REFERENCES locations(id);
UPDATE aircraft SET location_id = (SELECT id FROM locations WHERE is_default = true LIMIT 1)
WHERE location_id IS NULL;

-- ── Student document vault ──
CREATE TABLE IF NOT EXISTS student_documents (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doc_type VARCHAR(50) NOT NULL,
  file_url TEXT,
  file_name VARCHAR(255),
  expiry_date DATE,
  notes TEXT,
  uploaded_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS student_documents_student_id_idx ON student_documents(student_id);

-- ── In-app messaging ──
CREATE TABLE IF NOT EXISTS message_threads (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users(id),
  instructor_id INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(student_id, instructor_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  thread_id INTEGER NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS messages_thread_id_idx ON messages(thread_id);

-- ── Web push + in-app notification log ──
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_id_idx ON push_subscriptions(user_id);

CREATE TABLE IF NOT EXISTS user_notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  body TEXT,
  link VARCHAR(512),
  notification_type VARCHAR(50),
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS user_notifications_user_id_idx ON user_notifications(user_id);

-- ── Lead conversion tracking ──
ALTER TABLE discovery_flight_leads ADD COLUMN IF NOT EXISTS converted_user_id INTEGER REFERENCES users(id);
ALTER TABLE discovery_flight_leads ADD COLUMN IF NOT EXISTS last_follow_up_at TIMESTAMPTZ;
ALTER TABLE discovery_flight_leads ADD COLUMN IF NOT EXISTS follow_up_count INTEGER DEFAULT 0;

-- ── Aircraft document vault (per-tail files in Fleet) ──
CREATE TABLE IF NOT EXISTS aircraft_documents (
  id SERIAL PRIMARY KEY,
  aircraft_id INTEGER NOT NULL REFERENCES aircraft(id) ON DELETE CASCADE,
  doc_type VARCHAR(50) NOT NULL,
  title VARCHAR(255),
  file_url TEXT NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  expiry_date DATE,
  notes TEXT,
  uploaded_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS aircraft_documents_aircraft_id_idx ON aircraft_documents(aircraft_id);

-- user_permissions upsert (some DBs were missing unique on user_id)
CREATE UNIQUE INDEX IF NOT EXISTS user_permissions_user_id_unique ON user_permissions(user_id);
