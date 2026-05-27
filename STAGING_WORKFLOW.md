# Staging & Preview Workflow

Use a **separate staging site** to try new features, logins, bookings, and UI changes **without touching your live production data or customers**.

## How it works

| | **Production (live)** | **Staging (test)** |
|---|----------------------|-------------------|
| **URL** | https://www.newtechaviation.com | https://staging.newtechaviation.com *(after setup)* |
| **Git branch** | `main` | `staging` |
| **Railway service** | `flightslate-web` | `flightslate-staging` |
| **Database** | `flightslate-db` (real data) | `flightslate-staging-db` (test data only) |
| **Env var** | `APP_ENV=production` | `APP_ENV=staging` |

Staging uses its **own PostgreSQL database**. Nothing you create on staging (users, bookings, aircraft hours, messages) appears on the live site.

A bright **“STAGING — test environment”** banner shows on staging so you never confuse the two.

---

## Your workflow

### 1. Try changes on staging first

```bash
git checkout staging
git pull origin staging
# make changes locally OR tell Cursor to implement on staging branch
git add .
git commit -m "Try new feature X"
git push origin staging
```

Railway auto-deploys **`flightslate-staging`** from the `staging` branch (not production).

### 2. Test on the staging link

Open **https://staging.newtechaviation.com/app** (or the Railway URL until DNS is set).

Test logins with QA accounts (seeded on staging DB):

| Role | Email | Password |
|------|-------|----------|
| Admin | `qa-admin@test.local` | `TestPass123!` |
| Instructor | `qa-instructor@test.local` | `TestPass123!` |
| Student | `qa-student@test.local` | `TestPass123!` |

Create bookings, test new tabs, break things — production is unaffected.

### 3. When ready, deploy to production

Come back to Cursor and say **“deploy to production”**, or:

```bash
git checkout main
git pull origin main
git merge staging
git push origin main
```

That deploys **`flightslate-web`** (live site only).

---

## Data isolation (staging cannot affect production)

Staging is isolated at **four layers**:

| Layer | How |
|-------|-----|
| **Database** | Separate Postgres (`flightslate-staging-db`). All writes stay in staging only. |
| **Deploy** | `staging` branch → `flightslate-staging` only. Production deploys from `main` only. |
| **Emails** | Staging never emails real users — messages go to `STAGING_EMAIL_SINK` (admin) with `[STAGING]` prefix. |
| **Background jobs** | Backups, CSV exports, pre-flight reminders, instructor briefings, and device push are **disabled** on staging. |
| **File uploads (R2)** | Staging uploads use a `staging/` prefix so they don't overwrite production files. |

Refresh staging data from production (optional):

```bash
RAILWAY_API_TOKEN=... node scripts/clone-prod-to-staging.js
```

---

## One-time Railway setup

Run once (requires `RAILWAY_API_TOKEN`):

```bash
node scripts/railway-setup-staging.js
```

This creates:

1. **`flightslate-staging-db`** — empty Postgres for test data  
2. **`flightslate-staging`** — web app from GitHub branch `staging`  
3. Env vars: `APP_ENV=staging`, separate `DATABASE_URL`, copy of email/R2 settings  

Then in **Namecheap Advanced DNS** add:

| Type | Host | Value |
|------|------|-------|
| CNAME | `staging` | *(Railway target shown by setup script)* |

Seed test users on staging DB after first deploy:

```bash
DATABASE_URL=<staging-db-url> node scripts/seed-test-users.js
```

---

## Local testing (optional)

Two terminals, two ports, two env files:

```bash
# Terminal 1 — production-like (uses local DB)
APP_ENV=production PORT=3000 npm start

# Terminal 2 — staging-like (use a second local DB or Docker Postgres on 5433)
APP_ENV=staging PORT=3001 DATABASE_URL=postgresql://postgres:postgres@localhost:5433/flightslate_staging npm start
```

---

## What staging does **not** change

- Live customer accounts on www.newtechaviation.com  
- Real bookings, billing, or aircraft Hobbs on production  
- Emails still send via Brevo (use test emails on staging; consider `DATA_BACKUP_EMAIL` override on staging service)

---

## Quick checks

```bash
# Production
curl https://www.newtechaviation.com/api/config
# → {"appEnv":"production","isStaging":false,...}

# Staging (after setup)
curl https://staging.newtechaviation.com/api/config
# → {"appEnv":"staging","isStaging":true,...}
```

---

## Need help?

Tell Cursor: *“Deploy my staging changes to production”* or *“Set up the staging environment on Railway”*.
