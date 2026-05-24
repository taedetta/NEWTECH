# FlightSlate Developer & Editor Documentation

**App URL:** https://flightslate.polsia.app
**Repository:** https://github.com/Polsia-Inc/flightslate
**Company:** New Tech Aviation — flight school at KPSK airport, Dublin, Virginia
**Stack:** Express.js + PostgreSQL (Neon) + Vanilla HTML/CSS/JS + Render deployment

---

## Table of Contents

1. [Project Structure](#1-project-structure)
2. [How the CMS Works](#2-how-the-cms-works)
3. [Editing the Website (Visual)](#3-editing-the-website-visual)
4. [Editing the Code](#4-editing-the-code)
5. [Database Schema](#5-database-schema)
6. [API Endpoints](#6-api-endpoints)
7. [Deployment](#7-deployment)
8. [Adding New Features](#8-adding-new-features)
9. [Common Tasks](#9-common-tasks)

---

## 1. Project Structure

```
flightslate/
├── server.js              # Main Express app (~2,900 lines). All API routes, auth, CMS, static file serving
├── migrate.js             # Migration runner. Runs on every deploy via `npm run build`
├── package.json           # Node dependencies and scripts
├── render.yaml            # Render deployment config (web service definition)
├── .env                   # Local environment variables (NOT committed to git)
├── public/
│   ├── index.html         # Public landing page (the marketing/website homepage)
│   └── app.html           # Student portal / CMS editor interface (authenticated app)
├── migrations/            # Database schema migrations (timestamp-ordered JS files)
│   ├── 001_add_roles_and_aircraft.js
│   ├── 002_permissions.js
│   ├── 002_add_permissions.js
│   ├── 003_consolidate_permissions_table.js
│   ├── 004_add_user_soft_delete.js
│   ├── 004_flight_completion.js
│   ├── 004_maintenance_system.js
│   ├── 004_site_content.js
│   ├── 004_training_progress.js
│   ├── 005_billing.js
│   ├── 005_flexible_bookings.js
│   ├── 005_hours_log.js
│   ├── 005_instructor_availability.js
│   ├── 005_sync_hours.js
│   ├── 006_audit_log_source.js
│   ├── 007_add_can_edit_website.js
│   ├── 008_flight_log_and_current_tach.js
│   ├── 008_maneuver_syllabus.js
│   ├── 009_instructor_hours.js
│   └── 010_instructor_hours_student.js
├── scripts/
│   └── generate-logo.js   # One-time logo generation utility
├── test-fixtures/
├── shell-snapshots/
├── session-env/
├── todos/
├── debug/
├── projects/
└── .claude/               # Polsia agent instructions (not part of the app)
```

### What Each Key File Does

| File | Purpose |
|------|---------|
| `server.js` | The entire backend: Express routes, authentication, database queries, CMS management, static file serving, and HTML server-side rendering |
| `migrate.js` | Creates core tables (`users`, `_migrations`) and runs migrations from the `migrations/` folder. Runs on every deploy via `npm run build` |
| `public/index.html` | The public landing page. Server-rendered with CMS content injected by `server.js`. Displays the flight school's marketing site |
| `public/app.html` | The authenticated app. Contains both the student portal UI AND the CMS website editor. Loaded as a Single Page App (SPA) |
| `migrations/*.js` | Database schema changes. Each file runs once, tracked in the `_migrations` table |

### Frontend vs Backend Split

There is **no React/Vue framework**. The frontend is plain HTML, CSS, and vanilla JavaScript:

- **`public/index.html`** — Marketing/public site. Server-rendered with CMS data baked into the HTML at request time. Pure static HTML with inline `<style>` and `<script>` blocks.
- **`public/app.html`** — Authenticated web app. A large single-file SPA that handles: login, dashboard, booking calendar, aircraft management, student progress, training programs, CMS editor, and billing.

Both frontend files load CMS data either:
1. From server-side rendered injection (`window.__CMS_DATA__`) — for the public site
2. From client-side API calls (`GET /api/site-content`) — for the app editor

---

## 2. How the CMS Works

### Overview

Content is stored as **key-value pairs** in the `site_content` table. The table has no schema — any key can store any value. This makes it flexible but means you need to know which keys control what.

### Key Tables

#### `site_content`

| Column | Type | Description |
|--------|------|-------------|
| `key` | VARCHAR(100) | The content identifier (e.g., `hero_headline`, `about_text`) |
| `value` | TEXT | The content value — can be plain text or a base64 data URI for images |
| `updated_at` | TIMESTAMPTZ | When the content was last changed |

### How the Public Site Fetches and Renders Content

1. `GET /` route in `server.js` reads all rows from `site_content`
2. It replaces placeholder strings in `public/index.html` with actual values
3. Image URLs are injected as `<img>` src attributes
4. CMS data is also injected as `window.__CMS_DATA__` for client-side JavaScript

```
Browser requests /
→ server.js reads site_content table
→ server.js replaces __CMS_HERO_BG__, __CMS_ABOUT_IMAGE__, etc. in index.html
→ server.js injects window.__CMS_DATA__ with all CMS values
→ Full HTML page sent to browser (no API calls needed for public site)
```

### CMS Content Keys (What Each Key Controls)

The `site_content` table uses these keys (found by searching `server.js` and `index.html` for placeholder strings):

| Key | Controls | Example Value |
|-----|----------|---------------|
| `hero_headline` | Main headline on hero section | `Professional Flight Training` |
| `hero_subheadline` | Subtext under the headline | `At New River Valley Airport (KPSK)` |
| `hero_bg_image` | Hero background image URL | `https://images.unsplash.com/...` or base64 data URI |
| `about_text` | About section body text | `New Tech Aviation has been...` |
| `about_image` | About section image | `https://...` or base64 |
| `fleet_1_image` | Fleet aircraft image 1 | Image URL or base64 |
| `fleet_2_image` | Fleet aircraft image 2 | Image URL or base64 |
| `instructors_section_title` | Instructors heading text | `Meet Your Instructors` |
| `instructor_1_name` | First instructor name | `John Smith` |
| `instructor_1_bio` | First instructor bio | `CFI with 2,000 hours...` |
| `instructor_2_name`, `instructor_2_bio`, etc. | Additional instructors | Same pattern |
| `contact_email` | Contact email address | `info@newtechaviation.com` |
| `contact_phone` | Contact phone number | `(540) 555-1234` |
| `contact_address` | Physical address | `123 Airport Road, Dublin, VA` |
| `heading_color`, `body_color`, `accent_color`, `primary_color` | CMS theme colors | `#0F1D2F`, `#2563EB`, etc. |

> **Note:** The exact keys depend on what has been saved to the database. Run `SELECT key FROM site_content ORDER BY key` in the database to see all active keys.

### How Images Are Stored and Served

**Option A: R2 Cloudflare (Preferred)**
When you upload an image through the CMS editor in the app, it tries to upload to R2 Cloudflare first. If successful, the `site_content` value stores a public R2 URL like `https://pub-...r2.dev/company_96457/images/...`.

**Option B: Base64 Data URI (Fallback)**
If R2 is not configured, images are stored directly in the `site_content` table as base64 data URIs like `data:image/jpeg;base64,/9j/4AAQ...`. This is slower and has an 8MB base64 limit (~6MB actual image).

The CMS editor endpoint (`POST /api/site-content/upload-image`) first attempts R2 upload, then falls back to base64.

### How to Manually Edit Content in the Database

Connect to the Neon PostgreSQL database and run SQL directly:

```sql
-- See all CMS content
SELECT key, LEFT(value, 100) as value_preview FROM site_content ORDER BY key;

-- Update a text field
UPDATE site_content SET value = 'New headline text', updated_at = NOW()
WHERE key = 'hero_headline';

-- Update an image (base64 data URI)
UPDATE site_content SET value = 'data:image/png;base64,iVBORw0KG...', updated_at = NOW()
WHERE key = 'fleet_1_image';

-- Add a new key (insert)
INSERT INTO site_content (key, value, updated_at)
VALUES ('contact_phone', '(540) 555-9999', NOW())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- Delete a content key
DELETE FROM site_content WHERE key = 'hero_bg_image';
```

---

## 3. Editing the Website (Visual)

### The CMS Editor in the App

The website content editor is part of the authenticated app at `/app`. You access it after logging in, then navigate to the Website/CMS section in the sidebar.

**Required permission:** `can_edit_website` (granted to owner/admin, or manually set for instructors)

### What Each Section Controls

The app has a CMS editor section (accessible via the sidebar) with sections like:

| App Section | Controls |
|-------------|----------|
| **Hero** | Main headline, sub-headline, and background image |
| **About** | About section text and image |
| **Fleet** | Fleet section images (aircraft photos) |
| **Instructors** | Instructor names, bios, and photos |
| **Contact** | Email, phone, address |
| **Colors & Fonts** | Theme colors and font choices |

### How to Save and Publish

1. Log into `/app` with your credentials
2. Navigate to the CMS/Website Editor section
3. Edit the content in the form fields
4. Click **Save** — content is saved to the `site_content` table via `PUT /api/site-content`
5. The public site at `/` immediately reflects the changes (no separate publish step)

> **Publishing is immediate** — there is no draft/unpublish workflow. Changes go live instantly when saved.

### How Images Work

1. In the CMS editor, click the image upload area
2. Select a file from your computer
3. The app encodes it as base64 and sends it to `POST /api/site-content/upload-image`
4. The backend attempts R2 Cloudflare upload; if R2 is unavailable, stores as base64
5. The resulting URL (R2 URL or data URI) is saved to `site_content`
6. The public site renders it on next page load

---

## 4. Editing the Code

### How to Find Any Component or Page

#### Public Site (`public/index.html`)

This is a single large HTML file. Sections are identified by CSS class names and HTML structure:

| CSS Class | Section |
|-----------|---------|
| `.nav` | Top navigation bar |
| `.hero` | Hero section with background image and headline |
| `.about` | About section |
| `.fleet` | Aircraft fleet display |
| `.instructors` | Instructor profiles |
| `.contact` | Contact information footer |
| `.programs` | Training programs overview |

Search the file for `<!--` comments to find section boundaries.

#### App Portal (`public/app.html`)

The app is also a single large HTML file (~2,000+ lines). Key sections:

| Element/Class | Purpose |
|--------------|---------|
| `.sidebar` | Left navigation sidebar |
| `.dashboard-view` | Main dashboard (today's schedule, stats) |
| `.bookings-view` | Booking calendar and scheduling |
| `.aircraft-view` | Aircraft list and management |
| `.students-view` | Student list and profiles |
| `.training-view` | Training program management |
| `.cms-editor` | CMS/website editor |
| `.billing-view` | Billing summary and invoices |
| `.maintenance-view` | Maintenance status and squawks |
| `.settings-view` | User settings and permissions |

The app uses JavaScript state management to toggle between views. All views are in the same file and shown/hidden via CSS classes.

### Key JavaScript Functions in app.html

```javascript
// Authentication
login(email, password)         // POST /api/auth/login
register(email, password, name) // POST /api/auth/register
logout()                        // POST /api/auth/logout

// Bookings
loadBookings(filters)          // GET /api/bookings
createBooking(data)             // POST /api/bookings
completeBooking(id, data)       // PATCH /api/bookings/:id/complete

// Aircraft
loadAircraft()                  // GET /api/aircraft
createAircraft(data)            // POST /api/aircraft
updateAircraft(id, data)        // PUT /api/aircraft/:id

// CMS
loadSiteContent()               // GET /api/site-content?full=1
saveSiteContent(content)        // PUT /api/site-content
uploadImage(file)               // POST /api/site-content/upload-image

// Users & Permissions
loadUsers()                     // GET /api/users
inviteUser(data)                // POST /api/users/invite
updatePermissions(userId, data)  // PUT /api/permissions/:userId

// Training
loadTrainingPrograms()          // GET /api/training-programs
loadStudentProgress(studentId)   // GET /api/student-progress/:id
```

### CSS Organization

CSS is inline within each HTML file (no external stylesheet files):

**`public/index.html`** — CSS variables at the top:
```css
:root {
  --navy: #0F1D2F;
  --blue: #2563EB;
  --sky: #0EA5E9;
  --amber: #D97706;
  --white: #FFFFFF;
  --gray-100: #E2E8F0;
  --font: 'Inter', -apple-system, sans-serif;
  --font-serif: 'Playfair Display', Georgia, serif;
}
/* CMS color overrides via CSS custom properties */
html[style*='--cms-heading-color'] h1 { color: var(--cms-heading-color) !important; }
```

**`public/app.html`** — Dark theme CSS variables:
```css
:root {
  --navy: #080E1A;
  --dark-blue: #0D1525;
  --sky: #38BDF8;
  --amber: #F59E0B;
  --green: #22C55E;
}
```

### Environment Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `DATABASE_URL` | **Yes** | Neon PostgreSQL connection string | `REDACTED/db?sslmode=require` |
| `PORT` | No | Server port (default: 3000) | `3000` |
| `NODE_ENV` | No | Set to `production` for production | `production` |
| `JWT_SECRET` | No | Secret for signing JWT tokens (has safe default) | `your-secret-here` |
| `POLSIA_R2_BASE_URL` | No | R2 Cloudflare upload endpoint | `https://...r2.dev` |
| `POLSIA_API_KEY` | No | API key for R2 uploads | `company_xxxxx_key` |
| `OPENAI_API_KEY` | No | For AI features (logo generation) | `sk-...` |
| `OPENAI_BASE_URL` | No | OpenAI-compatible API endpoint | `https://polsia.com/ai/openai/v1` |

### How to Test Changes Locally

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set environment variables:**
   ```bash
   export DATABASE_URL='REDACTED/neondb?sslmode=require'
   export NODE_ENV=development
   ```

3. **Run the server:**
   ```bash
   npm run dev
   # Or: node server.js
   ```

4. **Open in browser:**
   - Public site: http://localhost:3000/
   - App portal: http://localhost:3000/app

5. **Test specific features:** Use the browser console or Postman to test API endpoints.

### Safe Code Change Guidelines

- **Don't edit `server.js` between section markers** — sections are clearly marked (e.g., `// ─── AIRCRAFT ROUTES ─────`)
- **Test in development before pushing** — use `npm run dev` to test locally
- **Never commit secrets** — `.env` is in `.gitignore`
- **Migrations are one-way (mostly)** — most migrations don't have `down()` functions. Only `002_permissions.js` and `007_add_can_edit_website.js` have rollback functions
- **Push changes after every file change** — use `push_to_remote` to deploy

---

## 5. Database Schema

### Core Tables

#### `users`

The primary user table. All roles: owner, admin, instructor, student.

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PRIMARY KEY | Auto-increment |
| `email` | VARCHAR(255) NOT NULL | Case-insensitive unique |
| `name` | VARCHAR(255) | Full name |
| `password_hash` | VARCHAR(255) | BCrypt hash |
| `role` | VARCHAR(20) DEFAULT 'student' | `owner`, `admin`, `instructor`, or `student` |
| `total_hobbs_hours` | DECIMAL | Accumulated flight hours |
| `total_tach_hours` | DECIMAL | Accumulated tach hours |
| `instructor_rate` | DECIMAL(8,2) | Hourly rate for dual instruction billing |
| `deleted_at` | TIMESTAMPTZ | Soft delete — NULL = active |
| `created_at` | TIMESTAMPTZ | Account creation time |
| `updated_at` | TIMESTAMPTZ | Last update time |
| `stripe_subscription_id` | VARCHAR(255) | Polsia subscription tracking |
| `subscription_status` | VARCHAR(50) | Polsia subscription status |
| `subscription_plan` | VARCHAR(255) | Polsia subscription plan |

**Indexes:**
- `idx_users_deleted_at` — for fast filtering of active users
- `users_email_unique_idx` — case-insensitive unique on email

#### `aircraft`

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PRIMARY KEY | |
| `tail_number` | VARCHAR(20) UNIQUE NOT NULL | N-numbers (e.g., `N12345`) |
| `make_model` | VARCHAR(100) NOT NULL | e.g., `Cessna 172S` |
| `type` | VARCHAR(50) DEFAULT 'single_engine' | `single_engine`, `multi_engine`, `complex` |
| `year` | INTEGER | Year manufactured |
| `status` | VARCHAR(20) DEFAULT 'available' | `available` or `maintenance` |
| `hourly_rate` | DECIMAL(8,2) | Hobbs rental rate |
| `total_hobbs_hours` | DECIMAL | Lifetime Hobbs accumulated |
| `total_tach_hours` | DECIMAL | Lifetime Tach accumulated |
| `current_hobbs` | DECIMAL(8,1) | Current Hobbs reading |
| `current_tach` | DECIMAL(8,1) | Current Tach reading |
| `maintenance_reason` | TEXT | Why aircraft is in maintenance |
| `next_100hr_due` | DECIMAL(8,1) | Hobbs at next 100-hour inspection |
| `next_annual_due` | DATE | Calendar date of next annual |
| `notes` | TEXT | General notes |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

#### `bookings`

The core scheduling table. Represents a scheduled flight lesson.

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PRIMARY KEY | |
| `student_id` | INTEGER REFERENCES users(id) | Student on the flight (nullable for solo instructor bookings) |
| `instructor_id` | INTEGER REFERENCES users(id) | Instructor on the flight (nullable for student solo bookings) |
| `aircraft_id` | INTEGER REFERENCES aircraft(id) | Assigned aircraft |
| `start_time` | TIMESTAMPTZ NOT NULL | Scheduled start |
| `end_time` | TIMESTAMPTZ NOT NULL | Scheduled end |
| `status` | VARCHAR(20) DEFAULT 'confirmed' | `confirmed`, `completed`, `cancelled` |
| `booking_type` | VARCHAR(20) | `dual` (student+instructor), `student_solo`, `instructor_solo` |
| `lesson_type` | VARCHAR(50) | e.g., `pre-solo`, `cross-country`, `instrument` |
| `hobbs_start` | DECIMAL | Hobbs meter at flight start |
| `hobbs_end` | DECIMAL | Hobbs meter at flight end |
| `tach_start` | DECIMAL | Tach meter at flight start |
| `tach_end` | DECIMAL | Tach meter at flight end |
| `completed_at` | TIMESTAMPTZ | When flight was marked complete |
| `notes` | TEXT | Lesson notes |
| `created_by` | INTEGER REFERENCES users(id) | Who created the booking |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

**Indexes:**
- `idx_bookings_aircraft_time` — for conflict detection on aircraft
- `idx_bookings_instructor_time` — for conflict detection on instructor
- `idx_bookings_student_time` — for conflict detection on student
- `idx_bookings_start_time` — for scheduling queries
- `idx_bookings_aircraft_completed` — partial index for completed bookings by aircraft

#### `user_permissions`

Granular permissions for instructors and admins (owners bypass all permission checks).

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PRIMARY KEY | |
| `user_id` | INTEGER UNIQUE REFERENCES users(id) | One row per user |
| `can_manage_aircraft` | BOOLEAN DEFAULT false | Add/edit/delete aircraft, set maintenance |
| `can_manage_instructors` | BOOLEAN DEFAULT false | Promote users to instructor, invite instructors |
| `can_manage_permissions` | BOOLEAN DEFAULT false | Modify other users' permissions |
| `can_manage_students` | BOOLEAN DEFAULT false | Manage student accounts |
| `can_edit_website` | BOOLEAN DEFAULT false | Edit CMS content |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |
| `updated_by` | INTEGER REFERENCES users(id) | Who last changed permissions |

#### `site_content`

CMS key-value store.

| Column | Type | Notes |
|--------|------|-------|
| `key` | VARCHAR(100) PRIMARY KEY | Content identifier |
| `value` | TEXT | Content value (text or base64 image) |
| `updated_at` | TIMESTAMPTZ | |

#### `training_programs`

FAA certification programs (seeded automatically on startup).

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PRIMARY KEY | |
| `name` | VARCHAR(100) NOT NULL | e.g., `Private Pilot License` |
| `code` | VARCHAR(20) UNIQUE | e.g., `PPL`, `IFR`, `CPL` |
| `description` | TEXT | Program description |
| `created_at` | TIMESTAMPTZ | |

#### `program_stages`

Training stages within each program. Seeded for PPL, IFR, CPL on first run.

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PRIMARY KEY | |
| `program_id` | INTEGER REFERENCES training_programs(id) | |
| `name` | VARCHAR(100) NOT NULL | e.g., `First Solo`, `Checkride` |
| `order_index` | INTEGER NOT NULL | Stage order within program |
| `description` | TEXT | Stage description |
| `created_at` | TIMESTAMPTZ | |

#### `student_training`

Student enrollment in a program.

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PRIMARY KEY | |
| `student_id` | INTEGER REFERENCES users(id) | |
| `program_id` | INTEGER REFERENCES training_programs(id) | |
| `instructor_id` | INTEGER REFERENCES users(id) | Assigned instructor |
| `current_stage_id` | INTEGER REFERENCES program_stages(id) | Current stage |
| `status` | VARCHAR(20) DEFAULT 'active' | `active`, `completed`, `paused` |
| `started_at` | TIMESTAMPTZ | Enrollment date |
| `completed_at` | TIMESTAMPTZ | Completion date |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

#### `flight_debriefs`

Instructor debrief logs after flights.

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PRIMARY KEY | |
| `student_id` | INTEGER REFERENCES users(id) | |
| `instructor_id` | INTEGER REFERENCES users(id) | |
| `booking_id` | INTEGER REFERENCES bookings(id) | |
| `stage_id` | INTEGER REFERENCES program_stages(id) | Training stage |
| `notes` | TEXT | Overall debrief notes |
| `overall_performance` | INTEGER (1-5) | 1=needs work, 5=excellent |
| `flight_date` | DATE | Date of the flight |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

#### `debrief_grades`

Individual maneuver grades within a debrief.

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PRIMARY KEY | |
| `debrief_id` | INTEGER REFERENCES flight_debriefs(id) | |
| `maneuver_name` | VARCHAR(100) NOT NULL | e.g., `Traffic Pattern`, `Soft Field Landing` |
| `grade` | INTEGER NOT NULL (1-5) | 1=needs work, 5=excellent |
| `notes` | TEXT | Instructor notes on this maneuver |
| `created_at` | TIMESTAMPTZ | |

#### `milestone_completions`

Tracks when a student completes a training stage.

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PRIMARY KEY | |
| `student_id` | INTEGER REFERENCES users(id) | |
| `stage_id` | INTEGER REFERENCES program_stages(id) | |
| `completed_by` | INTEGER REFERENCES users(id) | Instructor who signed off |
| `debrief_id` | INTEGER REFERENCES flight_debriefs(id) | Debrief associated with sign-off |
| `notes` | TEXT | Sign-off notes |
| `completed_at` | TIMESTAMPTZ | |

#### `instructor_availability`

Recurring weekly availability slots for instructors.

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PRIMARY KEY | |
| `instructor_id` | INTEGER REFERENCES users(id) | |
| `day_of_week` | INTEGER (0-6) | 0=Sunday, 6=Saturday |
| `start_time` | TIME NOT NULL | |
| `end_time` | TIME NOT NULL | |

#### `instructor_hours`

Manually-tracked instruction hours separate from flight logs.

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PRIMARY KEY | |
| `instructor_id` | INTEGER REFERENCES users(id) | |
| `aircraft_id` | INTEGER REFERENCES aircraft(id) | |
| `entry_date` | DATE DEFAULT CURRENT_DATE | |
| `aircraft_hours` | DECIMAL(8,2) DEFAULT 0 | Aircraft hours this entry |
| `instruction_hours` | DECIMAL(8,2) NOT NULL | Instruction hours this entry |
| `aircraft_rate` | DECIMAL(8,2) | Rate at time of entry |
| `instructor_rate` | DECIMAL(8,2) | Rate at time of entry |
| `notes` | TEXT | |
| `student_name` | TEXT | Student worked with |
| `created_at` | TIMESTAMP | |
| `updated_at` | TIMESTAMP | |

#### `squawks`

Maintenance discrepancy log.

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PRIMARY KEY | |
| `aircraft_id` | INTEGER REFERENCES aircraft(id) | |
| `reported_by` | INTEGER REFERENCES users(id) | |
| `reported_at` | TIMESTAMPTZ | |
| `description` | TEXT NOT NULL | What was found |
| `severity` | VARCHAR(20) DEFAULT 'minor' | `minor`, `major`, `grounding` |
| `status` | VARCHAR(20) DEFAULT 'open' | `open`, `reviewed`, `deferred`, `resolved` |
| `reviewed_by` | INTEGER REFERENCES users(id) | |
| `reviewed_at` | TIMESTAMPTZ | |
| `resolution_notes` | TEXT | |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

#### `airworthiness_directives`

FAA AD tracking per aircraft.

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PRIMARY KEY | |
| `aircraft_id` | INTEGER REFERENCES aircraft(id) | |
| `ad_number` | VARCHAR(100) | e.g., `2019-12-01` |
| `description` | TEXT NOT NULL | |
| `due_date` | DATE | Calendar deadline |
| `due_hobbs` | DECIMAL(8,1) | Hobbs-based deadline |
| `status` | VARCHAR(20) DEFAULT 'open' | `open`, `complied` |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

#### `flight_logs`

Immutable flight log entries created when a booking is completed.

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PRIMARY KEY | |
| `booking_id` | INTEGER REFERENCES bookings(id) | |
| `aircraft_id` | INTEGER REFERENCES aircraft(id) | |
| `student_id` | INTEGER REFERENCES users(id) | |
| `instructor_id` | INTEGER REFERENCES users(id) | |
| `booking_type` | VARCHAR(20) | `dual`, `student_solo`, `instructor_solo` |
| `flight_date` | DATE | |
| `hobbs_start`, `hobbs_end`, `hobbs_delta` | DECIMAL | |
| `tach_start`, `tach_end`, `tach_delta` | DECIMAL | |
| `submitted_by` | INTEGER REFERENCES users(id) | Who completed the booking |
| `lesson_type` | VARCHAR(50) | |
| `notes` | TEXT | |

#### Supporting Tables

| Table | Purpose |
|-------|---------|
| `_migrations` | Tracks which migrations have been applied |
| `aircraft_hours_history` | Audit log of every Hobbs/Tach change |
| `hour_edit_logs` | Tracks edits to completed flight hours |

### How Data Flows Between Tables

```
User registers → users table (role: student/instructor)
                → user_permissions table (all permissions false by default)
                → (instructors only) instructor_availability table

User books a lesson → bookings table (student_id, instructor_id, aircraft_id, times)
                   → Conflict check against existing bookings

Flight completes → PATCH /api/bookings/:id/complete
                 → bookings.status = 'completed' (updated in place)
                 → flight_logs created (immutable record)
                 → users.total_hobbs_hours updated (accumulated)
                 → aircraft.total_hobbs_hours updated (accumulated)
                 → aircraft.current_hobbs updated (snapshot)
                 → aircraft_hours_history entries (audit trail)

Instructor logs instruction time → instructor_hours table
                                 → used for billing calculations

Student progresses → student_training table (enrollment)
                  → flight_debriefs table (after each flight)
                  → debrief_grades table (maneuver-level grades)
                  → milestone_completions table (stage sign-offs)
```

### Example SQL Queries for Common Tasks

```sql
-- Find all active students
SELECT id, name, email, total_hobbs_hours FROM users
WHERE role = 'student' AND deleted_at IS NULL
ORDER BY name;

-- Find upcoming bookings for a student
SELECT b.*, a.tail_number, a.make_model, i.name as instructor_name
FROM bookings b
JOIN aircraft a ON b.aircraft_id = a.id
LEFT JOIN users i ON b.instructor_id = i.id
WHERE b.student_id = 5 AND b.end_time > NOW() AND b.status != 'cancelled'
ORDER BY b.start_time;

-- Get aircraft utilization (total hours per aircraft)
SELECT tail_number, make_model, total_hobbs_hours, status
FROM aircraft ORDER BY tail_number;

-- Find all open maintenance squawks
SELECT s.*, a.tail_number, a.make_model, u.name as reported_by_name
FROM squawks s
JOIN aircraft a ON s.aircraft_id = a.id
JOIN users u ON s.reported_by = u.id
WHERE s.status = 'open'
ORDER BY s.reported_at DESC;

-- Get billing summary for a student
SELECT u.name, COUNT(b.id) as flights,
  COALESCE(SUM(b.hobbs_end - b.hobbs_start), 0) as total_hours,
  COALESCE(SUM((b.hobbs_end - b.hobbs_start) * COALESCE(ac.hourly_rate, 0)), 0) as total_rental
FROM users u
JOIN bookings b ON b.student_id = u.id
JOIN aircraft ac ON b.aircraft_id = ac.id
WHERE u.id = 5 AND b.status = 'completed'
GROUP BY u.id, u.name;

-- Get training progress for a student
SELECT tp.name as program, ps.name as stage, st.status, st.current_stage_id
FROM student_training st
JOIN training_programs tp ON st.program_id = tp.id
LEFT JOIN program_stages ps ON st.current_stage_id = ps.id
WHERE st.student_id = 5;

-- Find instructor availability for scheduling
SELECT u.name, ia.day_of_week, ia.start_time, ia.end_time
FROM instructor_availability ia
JOIN users u ON ia.instructor_id = u.id
WHERE u.role = 'instructor' AND u.deleted_at IS NULL
ORDER BY ia.day_of_week, ia.start_time;
```

---

## 6. API Endpoints

### Authentication

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/auth/register` | None | Register new student/instructor account |
| `POST` | `/api/auth/login` | None | Login — returns JWT in cookie + JSON |
| `POST` | `/api/auth/logout` | None | Clear auth cookie |
| `GET` | `/api/auth/me` | JWT | Get current user with fresh permissions |

**Login response:**
```json
{
  user: {
    id: 1,
    email: 'john@example.com',
    name: 'John Smith',
    role: 'instructor',
    permissions: {
      can_manage_aircraft: true,
      can_manage_instructors: false,
      can_manage_permissions: false,
      can_manage_students: true,
      can_edit_website: false
    },
    total_hobbs_hours: 1247.3,
    total_tach_hours: 1189.5
  },
  hasOwner: true,
  token: 'eyJhbG...'
}
```

### Users

| Method | Endpoint | Auth | Role | Description |
|--------|----------|------|------|-------------|
| `GET` | `/api/users` | JWT | Any | List all users. Query: `?role=instructor` |
| `POST` | `/api/users/invite` | JWT | Owner or instructor with `can_manage_instructors` or `can_manage_students` | Create account + send credentials |
| `POST` | `/api/users/claim-owner` | JWT | Any authenticated user (first claimer wins) | Claim owner role |
| `DELETE` | `/api/users/:id` | JWT | Owner only | Soft-delete user (sets `deleted_at`) |
| `PUT` | `/api/users/:id/rate` | JWT | Owner/Admin | Set instructor hourly rate |
| `PUT` | `/api/users/:id/role` | JWT | Owner only | Change user role |

### Permissions

| Method | Endpoint | Auth | Role | Description |
|--------|----------|------|------|-------------|
| `GET` | `/api/permissions/:userId` | JWT | Owner or `can_manage_permissions` | Get user permissions |
| `PUT` | `/api/permissions/:userId` | JWT | Owner or `can_manage_permissions` | Update user permissions |

**Update permissions body:**
```json
{
  can_manage_aircraft: true,
  can_manage_instructors: false,
  can_manage_permissions: false,
  can_manage_students: true,
  can_edit_website: true
}
```

### Aircraft

| Method | Endpoint | Auth | Role | Description |
|--------|----------|------|------|-------------|
| `GET` | `/api/aircraft` | JWT | Any | List all aircraft |
| `POST` | `/api/aircraft` | JWT | Owner or `can_manage_aircraft` | Add new aircraft |
| `PUT` | `/api/aircraft/:id` | JWT | Owner or `can_manage_aircraft` | Update aircraft |
| `DELETE` | `/api/aircraft/:id` | JWT | Owner or `can_manage_aircraft` | Delete aircraft (must have no upcoming bookings) |
| `PATCH` | `/api/aircraft/:id/maintenance` | JWT | Owner or `can_manage_aircraft` | Set aircraft `available` or `maintenance` |
| `PATCH` | `/api/aircraft/:id/hobbs` | JWT | Instructor or above | Manually update Hobbs/Tach meters |
| `GET` | `/api/aircraft/:id/hours-history` | JWT | Any | Get Hobbs/Tach change log |
| `GET` | `/api/hours-audit` | JWT | Owner/Admin only | Global hours audit log |

### Bookings

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/bookings` | JWT | List bookings. Query params: `start`, `end`, `instructor_id`, `student_id`, `aircraft_id`. Students see only their own bookings. |
| `POST` | `/api/bookings` | JWT | Create booking with conflict detection |
| `PATCH` | `/api/bookings/:id/complete` | JWT | Mark flight completed, log Hobbs/Tach, update user and aircraft totals |
| `PATCH` | `/api/bookings/:id/hours` | JWT | Edit Hobbs/Tach on completed booking (owner/admin only) |
| `DELETE` | `/api/bookings/:id` | JWT | Cancel a booking |

**Create booking body:**
```json
{
  student_id: 5,
  instructor_id: 2,
  aircraft_id: 1,
  start_time: '2026-05-10T09:00:00Z',
  end_time: '2026-05-10T11:00:00Z',
  lesson_type: 'instrument',
  notes: 'IPC training'
}
```

**Complete booking body:**
```json
{
  hobbs_start: 1234.5,
  hobbs_end: 1236.1,
  tach_start: 987.2,
  tach_end: 988.5
}
```

### Squawks

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/squawks` | JWT | List squawks. Query: `?aircraft_id=1&status=open` |
| `POST` | `/api/squawks` | JWT | Report a squawk |
| `PATCH` | `/api/squawks/:id` | JWT | Update squawk status/notes |

**Report squawk body:**
```json
{
  aircraft_id: 1,
  description: 'Left brake squeaks on landing',
  severity: 'minor'
}
```

### Airworthiness Directives

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/aircraft/:id/ads` | JWT | List ADs for an aircraft |
| `POST` | `/api/aircraft/:id/ads` | JWT | Add AD to an aircraft |
| `PATCH` | `/api/ads/:id` | JWT | Update AD status |

### Training Progress

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/training-programs` | JWT | List all programs with stages |
| `GET` | `/api/student-progress/:studentId` | JWT | Get student's progress across all programs |
| `POST` | `/api/student-progress` | JWT | Enroll student in a program |
| `PATCH` | `/api/student-progress/:id` | JWT | Update enrollment (current stage, status) |
| `POST` | `/api/debriefs` | JWT | Create flight debrief |
| `GET` | `/api/debriefs/:studentId` | JWT | Get debriefs for a student |
| `POST` | `/api/milestones` | JWT | Mark a stage as completed |

### Billing

| Method | Endpoint | Auth | Role | Description |
|--------|----------|------|------|-------------|
| `GET` | `/api/billing/summary` | JWT | Instructor or above | All students with flight counts, hours, rental totals, instruction totals |
| `GET` | `/api/billing/:studentId` | JWT | Student (own) or Instructor+ | Detailed flight billing for one student |

### Instructor Hours

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/instructor-hours` | JWT | Instructors see own; admins/owners see all. Query: `?start_date=2026-01-01&end_date=2026-01-31&instructor_id=2` |
| `POST` | `/api/instructor-hours` | JWT | Submit instructor hours entry |

**Submit instructor hours body:**
```json
{
  aircraft_id: 1,
  entry_date: '2026-05-01',
  aircraft_hours: 1.5,
  instruction_hours: 1.0,
  aircraft_rate: 165.00,
  instructor_rate: 45.00,
  student_name: 'Jane Smith',
  notes: 'Ground instruction + flight'
}
```

### CMS / Website Content

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/site-content` | None | Public — get all CMS content as key-value map. `?full=1` returns full base64 images |
| `GET` | `/api/site-content/image/:key` | None | Serve image from base64 site_content value |
| `PUT` | `/api/site-content` | JWT + `can_edit_website` or owner | Save CMS content (batch update) |
| `POST` | `/api/site-content/upload-image` | JWT + `can_edit_website` or owner | Upload image to R2 (falls back to base64) |

**Save CMS content body (key-value object):**
```json
{
  hero_headline: 'Professional Flight Training',
  hero_subheadline: 'At New River Valley Airport',
  about_text: 'New Tech Aviation has been serving the New River Valley...'
}
```

### Internal / Startup

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/health` | None | Health check (Render health check endpoint) |
| `GET` | `/` | None | Serve `public/index.html` (public landing page) with server-side CMS injection |
| `GET` | `/app` | None | Serve `public/app.html` (authenticated SPA) |
| `GET` | `/app/*` | None | SPA catch-all — serves `app.html` |

---

## 7. Deployment

### How Render Deployment Works

1. Push code to GitHub repository
2. Render automatically detects the push (auto-deploy on main branch)
3. Render runs `npm install` (buildCommand from `render.yaml`)
4. Render starts the service with `npm start` (startCommand from `render.yaml`)
5. On startup, `npm start` runs `node server.js` which first runs `npm run migrate` (via the build script in package.json)
6. Migrations apply, then the Express server starts on port 3000
7. Health check at `/health` confirms the service is up

### render.yaml (Current Configuration)

```yaml
services:
  - type: web
    runtime: node
    name: app
    buildCommand: npm install
    startCommand: npm start
    healthCheckPath: /health
    envVars:
      - key: NODE_ENV
        value: production
```

### Environment Variables for Production

These are set in the Render dashboard (not in the repo):

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | Neon PostgreSQL connection string (set automatically by Polsia) |
| `NODE_ENV` | `production` |
| `JWT_SECRET` | A strong random string (generate with: `openssl rand -hex 32`) |
| `PORT` | Render sets this automatically |
| `POLSIA_R2_BASE_URL` | R2 Cloudflare endpoint (for image uploads) |
| `POLSIA_API_KEY` | Polsia R2 API key |
| `OPENAI_API_KEY` | OpenAI key (for AI logo generation) |
| `OPENAI_BASE_URL` | `https://polsia.com/ai/openai/v1` |

### Database (Neon) Connection String Format

```
REDACTED/<database>?sslmode=require
```

Example:
```
REDACTED/neondb?sslmode=require
```

The `?sslmode=require` is critical for Neon — connections without SSL will fail.

### R2 Cloudflare Setup for Image Storage

1. Create a Cloudflare R2 bucket
2. Get the R2 bucket URL and API token from Cloudflare dashboard
3. Set `POLSIA_R2_BASE_URL` to the R2 bucket URL (e.g., `https://pub-xxx.r2.dev`)
4. Set `POLSIA_API_KEY` to the Cloudflare API token

When R2 is configured, image uploads go to R2 and return a public URL. When R2 is not configured, images are stored as base64 data URIs in the `site_content` table.

### How Auto-Deploy from GitHub Works

1. Connect your GitHub repo to Render via the Render dashboard
2. Set the branch to `main` for auto-deploy
3. Every push to `main` triggers a new deploy
4. Render webhook automatically notifies the service to pull the new code

### Setting Up a New CI/CD Pipeline

1. **Connect GitHub repo** in Render dashboard → New → Connect a repository
2. **Configure branch** — set to `main` for auto-deploys
3. **Set environment variables** in Render → Environment tab
4. **Set build command** to `npm install`
5. **Set start command** to `npm start`
6. **Set health check path** to `/health`
7. **Deploy** — Render pulls the repo, installs deps, runs migrations, starts the server

---

## 8. Adding New Features

### Where to Add New Pages

#### Public Website (index.html)
Add content directly in the HTML. For new sections:
1. Add HTML markup at the appropriate location
2. Add CSS styles for the section
3. Optionally add a `site_content` key for CMS-controlled content
4. Update server-side rendering in `server.js` `GET /` route to inject the new CMS key

#### App Portal (app.html)
1. Add the new navigation link to the sidebar
2. Add a new view `<div>` with a unique ID
3. Add CSS for the view
4. Add JavaScript to load data and handle interactions
5. Add view-toggle logic in the navigation handler

### Where to Add New API Routes

Add new routes directly in `server.js`:

1. Find the appropriate section (or create a new `// ─── NEW SECTION ─────` block)
2. Add the route handler:

```javascript
// ─── MY NEW FEATURE ──────────────────────────────────────
app.get('/api/my-feature', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM my_table');
    res.json(result.rows);
  } catch (err) {
    console.error('My feature error:', err);
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});
```

### Database Migration Basics

1. Create a new file in `migrations/` with a timestamp prefix:
   ```
   migrations/011_add_new_table.js
   ```

2. Follow this format:

```javascript
module.exports = {
  name: 'add_new_table',
  up: async (client) => {
    await client.query(`
      CREATE TABLE my_new_table (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_my_new_table_name ON my_new_table(name)`);
  },
  // Optional: add down() for rollback
  down: async (client) => {
    await client.query('DROP TABLE IF EXISTS my_new_table');
  }
};
```

3. The migration runs automatically on the next deploy (via `npm run build` which runs `node migrate.js`)
4. Check `_migrations` table to see which migrations have been applied

### How the Permissions System Works

**Three-tier permission model:**

1. **Owner** — bypasses all permission checks. Can do anything.
2. **Admin** — same as owner but managed via `user_permissions` table
3. **Instructor/Student** — role-based with granular permissions in `user_permissions`

**Permission flags (in `user_permissions` table):**

| Permission | What it allows |
|------------|----------------|
| `can_manage_aircraft` | Add/edit/delete aircraft, set maintenance status, update Hobbs readings |
| `can_manage_instructors` | Invite instructors, manage instructor accounts |
| `can_manage_permissions` | Modify other users' permissions |
| `can_manage_students` | Manage student accounts, view student progress |
| `can_edit_website` | Edit CMS content and upload images |

**How to add a new permission flag:**

1. Create a migration to add the column:
```javascript
// migrations/011_add_new_permission.js
module.exports = {
  name: 'add_new_permission',
  up: async (client) => {
    await client.query(`
      ALTER TABLE user_permissions
      ADD COLUMN IF NOT EXISTS can_do_new_thing BOOLEAN NOT NULL DEFAULT false
    `);
  }
};
```

2. Update the `getUserPermissions()` function in `server.js` (around line 55):
```javascript
return {
  can_manage_aircraft: true,
  can_manage_instructors: true,
  can_manage_permissions: true,
  can_manage_students: true,
  can_edit_website: true,
  can_do_new_thing: true,  // Add this
};
```

3. Use it in route handlers:
```javascript
app.post('/api/new-endpoint', authenticateToken, requirePermission('can_do_new_thing'), async (req, res) => {
  // Only users with can_do_new_thing can access this
});
```

---

## 9. Common Tasks

### How to Add a New Instructor

1. **Log into the app** as an owner or someone with `can_manage_instructors`
2. **Go to Users** section in the sidebar
3. **Click Invite User** or Register a new account
4. **Set the role to `instructor`**
5. **Grant permissions** via the Permissions panel:
   - `can_manage_aircraft` — if they should manage aircraft
   - `can_manage_students` — if they should manage students
   - `can_edit_website` — if they should edit the website content

Or via database directly:
```sql
INSERT INTO users (email, name, password_hash, role)
VALUES ('instructor@example.com', 'Jane Instructor', '$2a$12$...', 'instructor');

INSERT INTO user_permissions (user_id, can_manage_aircraft, can_manage_students)
VALUES (5, true, true);
```

### How to Add a New Aircraft

1. **Log into the app** as owner or someone with `can_manage_aircraft`
2. **Go to Aircraft** section
3. **Click Add Aircraft**
4. Fill in:
   - **Tail Number** — N-number (e.g., `N12345`)
   - **Make/Model** — e.g., `Cessna 172S`
   - **Type** — `single_engine`, `multi_engine`, `complex`
   - **Year** — e.g., `2018`
   - **Hourly Rate** — Hobbs rental rate in dollars

Or via API:
```bash
curl -X POST https://flightslate.polsia.app/api/aircraft
  -H 'Content-Type: application/json'
  -H 'Authorization: Bearer <token>'
  -d '{
    tail_number: N12345,
    make_model: Cessna 172S,
    type: single_engine,
    year: 2018,
    hourly_rate: 165.00
  }'
```

### How to Change the Site Logo or Colors

**In the app CMS editor:**
1. Go to `/app` → CMS/Website Editor section
2. Find the logo upload field
3. Upload a new image file
4. Save — changes are immediate

**Via database:**
```sql
-- Find the logo key
SELECT key, LEFT(value, 50) FROM site_content WHERE key LIKE '%logo%' OR key LIKE '%color%';

-- Update a color
UPDATE site_content SET value = '#1E40AF', updated_at = NOW()
WHERE key = 'primary_color';
```

**Via code edit** (`public/index.html`):
- Logo: Find `.nav-brand-logo` CSS and update the `href` or add an `<img>` tag
- Colors: Update CSS variables in the `:root` block at the top of the file
- CMS-controlled colors: Update the `site_content` table values

### How to Add a New Page to the Public Site

1. **Edit `public/index.html`** — add a new `<section>` element with unique class
2. **Add CSS** — add styles for the new section in the inline `<style>` block
3. **Add navigation link** — add a link in the `.nav-links` `<ul>`
4. **Optionally make it CMS-controlled** — save content keys in `site_content` and inject from `server.js`

### How to Change Font Sizes or Styling

**For the public site** (`public/index.html`):
1. Find the `:root` CSS variables block at the top of the file
2. Update font family, colors, spacing, or typography variables
3. Changes apply site-wide

**For the app** (`public/app.html`):
1. Find the `:root` CSS variables block at the top
2. Update dark theme colors, border styles, font sizes
3. Component-specific styles are in the same file below the variables

**Common CSS changes:**
```css
/* Change body font */
body { font-family: 'Inter', sans-serif; }

/* Change heading size */
h1 { font-size: 3rem; line-height: 1.1; }

/* Change primary button color */
.btn-primary { background: #2563EB; }
```

### How to Export Data

**From the app** (if UI is available):
1. Navigate to the section with the data (students, bookings, billing)
2. Use any export buttons if present

**From the database directly:**
```sql
-- Export all students with hours
COPY (SELECT name, email, total_hobbs_hours, total_tach_hours, created_at
      FROM users WHERE role = 'student' AND deleted_at IS NULL)
TO '/tmp/students_export.csv' WITH (FORMAT csv, HEADER true);

-- Export flight logs for a date range
COPY (SELECT b.id, s.name as student, i.name as instructor, a.tail_number,
              b.hobbs_end - b.hobbs_start as hours, b.start_time
       FROM bookings b
       JOIN users s ON b.student_id = s.id
       LEFT JOIN users i ON b.instructor_id = i.id
       JOIN aircraft a ON b.aircraft_id = a.id
       WHERE b.status = 'completed'
         AND b.start_time >= '2026-01-01' AND b.start_time < '2026-04-01')
TO '/tmp/flights_q1_2026.csv' WITH (FORMAT csv, HEADER true);
```

### How to Add a New User Role

1. **Database** — Roles are free-form strings. Just set `users.role = 'your_new_role'`
2. **Server** — If you need special behavior for the role, update `server.js`:
   - Update `getUserPermissions()` (line 55) to handle the new role
   - Update `requireRole()` middleware (line 45) to include the role
   - Update route handlers that check `req.user.role`
3. **Example:** Adding a `billing_admin` role that can see all billing:
```javascript
// In requireRole middleware:
if (role === 'billing_admin') {
  // Give access to billing endpoints only, not other admin functions
}
```

---

## Quick Reference Card

| I want to... | Go to... |
|--------------|----------|
| Edit website text/images | `/app` → CMS Editor |
| Add/edit aircraft | `/app` → Aircraft section |
| Create a booking | `/app` → Bookings section |
| View student progress | `/app` → Training section |
| Log flight hours | `/app` → Bookings → Complete button |
| Manage users/permissions | `/app` → Users section |
| View billing | `/app` → Billing section |
| Report maintenance issue | `/app` → Maintenance section |
| Edit landing page HTML/CSS | `public/index.html` |
| Edit app UI | `public/app.html` |
| Add a database table | Create file in `migrations/` |
| Add a new API route | Add to `server.js` |
| Deploy changes | Push to GitHub → Render auto-deploys |

---

*Document version: 1.0 — Generated May 2026*