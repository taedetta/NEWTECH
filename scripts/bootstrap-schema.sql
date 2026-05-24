-- FlightSlate local bootstrap schema (minimal viable for dev/testing)
-- Safe to re-run: uses IF NOT EXISTS throughout.

CREATE TABLE IF NOT EXISTS _migrations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  password_hash VARCHAR(255),
  role VARCHAR(20) DEFAULT 'student',
  phone_number VARCHAR(30),
  is_instructor BOOLEAN DEFAULT FALSE,
  approval_status VARCHAR(20) DEFAULT 'approved',
  total_hobbs_hours DECIMAL(10,2) DEFAULT 0,
  total_tach_hours DECIMAL(10,2) DEFAULT 0,
  instructor_rate DECIMAL(8,2),
  cfi_cert_number VARCHAR(50),
  cfi_expiry DATE,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  stripe_subscription_id VARCHAR(255),
  subscription_status VARCHAR(50),
  subscription_plan VARCHAR(255),
  subscription_expires_at TIMESTAMPTZ,
  subscription_updated_at TIMESTAMPTZ,
  source VARCHAR(20) DEFAULT 'production'
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx ON users (LOWER(email));

CREATE TABLE IF NOT EXISTS user_permissions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  can_manage_aircraft BOOLEAN DEFAULT FALSE,
  can_manage_instructors BOOLEAN DEFAULT FALSE,
  can_manage_permissions BOOLEAN DEFAULT FALSE,
  can_manage_students BOOLEAN DEFAULT FALSE,
  can_edit_website BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS site_content (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS aircraft (
  id SERIAL PRIMARY KEY,
  tail_number VARCHAR(20) UNIQUE NOT NULL,
  make_model VARCHAR(100) NOT NULL,
  type VARCHAR(50) DEFAULT 'single_engine',
  year INTEGER,
  status VARCHAR(20) DEFAULT 'available',
  hourly_rate DECIMAL(8,2),
  total_hobbs_hours DECIMAL(10,2) DEFAULT 0,
  total_tach_hours DECIMAL(10,2) DEFAULT 0,
  current_hobbs DECIMAL(8,1) DEFAULT 0,
  current_tach DECIMAL(8,1) DEFAULT 0,
  maintenance_reason TEXT,
  next_100hr_due DECIMAL(8,1),
  next_annual_due DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  source VARCHAR(20) DEFAULT 'production'
);

CREATE TABLE IF NOT EXISTS bookings (
  id SERIAL PRIMARY KEY,
  student_id INTEGER REFERENCES users(id),
  instructor_id INTEGER REFERENCES users(id),
  aircraft_id INTEGER REFERENCES aircraft(id),
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) DEFAULT 'confirmed',
  booking_type VARCHAR(20),
  lesson_type VARCHAR(50),
  hobbs_start DECIMAL(8,1),
  hobbs_end DECIMAL(8,1),
  tach_start DECIMAL(8,1),
  tach_end DECIMAL(8,1),
  completed_at TIMESTAMPTZ,
  notes TEXT,
  cancellation_reason TEXT,
  billing_voided BOOLEAN DEFAULT FALSE,
  reminder_sent BOOLEAN DEFAULT FALSE,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  source VARCHAR(20) DEFAULT 'production'
);

CREATE TABLE IF NOT EXISTS flight_logs (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER REFERENCES bookings(id),
  student_id INTEGER REFERENCES users(id),
  instructor_id INTEGER REFERENCES users(id),
  aircraft_id INTEGER REFERENCES aircraft(id),
  flight_date DATE,
  hobbs_start DECIMAL(8,1),
  hobbs_end DECIMAL(8,1),
  hobbs_delta DECIMAL(8,2),
  tach_start DECIMAL(8,1),
  tach_end DECIMAL(8,1),
  tach_delta DECIMAL(8,2),
  dual_instruction_hours DECIMAL(8,2),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  source VARCHAR(20) DEFAULT 'production'
);

CREATE TABLE IF NOT EXISTS aircraft_hours_history (
  id SERIAL PRIMARY KEY,
  aircraft_id INTEGER REFERENCES aircraft(id),
  booking_id INTEGER REFERENCES bookings(id),
  field VARCHAR(20),
  old_value DECIMAL(10,2),
  new_value DECIMAL(10,2),
  source VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hour_edit_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  field VARCHAR(50),
  old_value DECIMAL(10,2),
  new_value DECIMAL(10,2),
  reason TEXT,
  edited_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ground_sessions (
  id SERIAL PRIMARY KEY,
  student_id INTEGER REFERENCES users(id),
  instructor_id INTEGER REFERENCES users(id),
  session_date DATE,
  ground_hours DECIMAL(8,2),
  instructor_rate DECIMAL(8,2),
  instruction_charge_amount DECIMAL(10,2),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  source VARCHAR(20) DEFAULT 'production'
);

CREATE TABLE IF NOT EXISTS instructor_hours (
  id SERIAL PRIMARY KEY,
  instructor_id INTEGER REFERENCES users(id),
  period_start DATE,
  period_end DATE,
  total_hours DECIMAL(10,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS squawks (
  id SERIAL PRIMARY KEY,
  aircraft_id INTEGER REFERENCES aircraft(id),
  description TEXT,
  severity VARCHAR(20) DEFAULT 'minor',
  status VARCHAR(20) DEFAULT 'open',
  expected_downtime TEXT,
  reported_by INTEGER REFERENCES users(id),
  reviewed_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  source VARCHAR(20) DEFAULT 'production'
);

CREATE TABLE IF NOT EXISTS billing_entries (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER REFERENCES bookings(id),
  student_id INTEGER REFERENCES users(id),
  amount DECIMAL(10,2),
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  source VARCHAR(20) DEFAULT 'production'
);

CREATE TABLE IF NOT EXISTS endorsements (
  id SERIAL PRIMARY KEY,
  student_id INTEGER REFERENCES users(id),
  instructor_id INTEGER REFERENCES users(id),
  aircraft_id INTEGER REFERENCES aircraft(id),
  endorsement_type VARCHAR(100),
  endorsement_text TEXT,
  student_signature TEXT,
  student_signed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  source VARCHAR(20) DEFAULT 'production'
);

CREATE TABLE IF NOT EXISTS instructor_availability (
  id SERIAL PRIMARY KEY,
  instructor_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS instructor_availability_overrides (
  id SERIAL PRIMARY KEY,
  instructor_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  override_date DATE NOT NULL,
  is_available BOOLEAN DEFAULT TRUE,
  start_time TIME,
  end_time TIME,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS training_programs (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  code VARCHAR(20) UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  source VARCHAR(20) DEFAULT 'production'
);

CREATE TABLE IF NOT EXISTS program_stages (
  id SERIAL PRIMARY KEY,
  program_id INTEGER REFERENCES training_programs(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  order_index INTEGER NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stage_maneuvers (
  id SERIAL PRIMARY KEY,
  stage_id INTEGER REFERENCES program_stages(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  order_index INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS student_training (
  id SERIAL PRIMARY KEY,
  student_id INTEGER REFERENCES users(id),
  program_id INTEGER REFERENCES training_programs(id),
  instructor_id INTEGER REFERENCES users(id),
  current_stage_id INTEGER REFERENCES program_stages(id),
  status VARCHAR(20) DEFAULT 'active',
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  source VARCHAR(20) DEFAULT 'production'
);

CREATE TABLE IF NOT EXISTS student_maneuver_progress (
  id SERIAL PRIMARY KEY,
  student_id INTEGER REFERENCES users(id),
  maneuver_id INTEGER REFERENCES stage_maneuvers(id),
  status VARCHAR(20),
  proficient_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS flight_debriefs (
  id SERIAL PRIMARY KEY,
  student_id INTEGER REFERENCES users(id),
  instructor_id INTEGER REFERENCES users(id),
  booking_id INTEGER REFERENCES bookings(id),
  stage_id INTEGER REFERENCES program_stages(id),
  notes TEXT,
  recommendations TEXT,
  overall_performance INTEGER,
  flight_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS debrief_grades (
  id SERIAL PRIMARY KEY,
  debrief_id INTEGER REFERENCES flight_debriefs(id) ON DELETE CASCADE,
  maneuver_name VARCHAR(100),
  grade INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS milestone_completions (
  id SERIAL PRIMARY KEY,
  student_id INTEGER REFERENCES users(id),
  stage_id INTEGER REFERENCES program_stages(id),
  completed_by INTEGER REFERENCES users(id),
  debrief_id INTEGER REFERENCES flight_debriefs(id),
  notes TEXT,
  completed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS training_progress (
  id SERIAL PRIMARY KEY,
  student_id INTEGER REFERENCES users(id),
  booking_id INTEGER REFERENCES bookings(id),
  stage_id INTEGER REFERENCES program_stages(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id SERIAL PRIMARY KEY,
  action VARCHAR(100),
  performed_by INTEGER REFERENCES users(id),
  details TEXT,
  booking_id INTEGER REFERENCES bookings(id),
  performed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS discovery_flight_leads (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(50),
  experience VARCHAR(50),
  status VARCHAR(20) DEFAULT 'new',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  source VARCHAR(20) DEFAULT 'production'
);

CREATE TABLE IF NOT EXISTS at_risk_assessments (
  id SERIAL PRIMARY KEY,
  student_id INTEGER REFERENCES users(id),
  risk_level VARCHAR(20),
  risk_score INTEGER,
  days_since_last_flight INTEGER,
  last_flight_date DATE,
  manual_override VARCHAR(20),
  assessed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS student_interventions (
  id SERIAL PRIMARY KEY,
  student_id INTEGER REFERENCES users(id),
  logged_by INTEGER REFERENCES users(id),
  intervention_type VARCHAR(50),
  outcome VARCHAR(50),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS school_settings (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS weather_cache (
  station_id VARCHAR(10) PRIMARY KEY,
  metar_json JSONB,
  taf_json JSONB,
  fetched_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS page_views (
  id SERIAL PRIMARY KEY,
  path TEXT,
  referrer TEXT,
  user_agent TEXT,
  ip_hash VARCHAR(64),
  country VARCHAR(10),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS aircraft_downtime (
  id SERIAL PRIMARY KEY,
  aircraft_id INTEGER REFERENCES aircraft(id),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  source VARCHAR(20) DEFAULT 'production'
);

CREATE TABLE IF NOT EXISTS flight_hobbs_readings (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER REFERENCES bookings(id),
  submitted_by INTEGER REFERENCES users(id),
  role VARCHAR(20),
  hobbs_start DECIMAL(8,1),
  hobbs_end DECIMAL(8,1),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS flight_discrepancies (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER REFERENCES bookings(id),
  student_hobbs_delta DECIMAL(8,2),
  instructor_hobbs_delta DECIMAL(8,2),
  delta_hours DECIMAL(8,2),
  status VARCHAR(20) DEFAULT 'pending',
  resolved_by INTEGER REFERENCES users(id),
  resolution_notes TEXT,
  email_sent BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS file_overrides (
  id SERIAL PRIMARY KEY,
  file_path TEXT UNIQUE NOT NULL,
  content TEXT,
  edited_by INTEGER REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  synced_to_github BOOLEAN DEFAULT FALSE,
  synced_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS feedback (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  rating INTEGER,
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
