# Deploy FlightSlate on Railway

No Polsia dependencies — email via Brevo, files via Cloudflare R2, database on Neon.

## 1. Create the Railway service

1. Log into [Railway](https://railway.com) and open project **cooperative-joy**.
2. Production web service is **`flightslate-web`** — this is the only service that should be connected to GitHub (`taedetta/NEWTECH`, branch `main`).
3. Do **not** connect a second duplicate service to the same repo (e.g. an old `NEWTECH` service without `DATABASE_URL` will show failed builds).
4. Railway detects Node and uses `railway.toml` (build + start + health check).

## 2. Environment variables

Copy these into Railway → your service → **Variables**:

| Variable | Required | Notes |
|----------|----------|-------|
| `DATABASE_URL` | Yes | Neon PostgreSQL connection string (`?sslmode=require`) |
| `JWT_SECRET` | Yes | Same value as production (or generate new) |
| `NODE_ENV` | Yes | `production` |
| `APP_ENV` | Yes | `production` |
| `APP_URL` | Yes | `https://www.newtechaviation.com` |
| `BREVO_API_KEY` | Yes | Transactional email |
| `SMTP_FROM` | Yes | e.g. `aviationnewtech@gmail.com` |
| `DATA_BACKUP_EMAIL` | Yes | CSV backup recipient |
| `R2_ACCOUNT_ID` | Yes | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | Yes | R2 API token access key |
| `R2_SECRET_ACCESS_KEY` | Yes | R2 API token secret |
| `R2_BUCKET` | Yes | Bucket name |
| `R2_PUBLIC_URL` | Yes | Public bucket URL, e.g. `https://pub-xxx.r2.dev` |
| `OPENAI_API_KEY` | No | Only if using logo generation |
| `LOGO_API_SECRET` | No | Protects `POST /api/admin/generate-logo` |

Railway sets `PORT` automatically. Optional: `RAILWAY_PUBLIC_DOMAIN` is used for email links if `APP_URL` is unset.

## 3. Cloudflare R2 setup

1. Cloudflare dashboard → **R2** → create or reuse a bucket.
2. Enable **public access** (or custom domain) and note the public URL.
3. **Manage R2 API Tokens** → create token with Object Read & Write on that bucket.
4. Set the five `R2_*` env vars above.

Existing CMS images already on `pub-*.r2.dev` keep working — point `R2_PUBLIC_URL` at that bucket.

## 4. Custom domain

1. Railway → service → **Settings → Networking → Custom Domain** → add `www.newtechaviation.com`.
2. In Namecheap DNS:
   - **CNAME** `www` → Railway-provided hostname
   - **A** `@` → Railway apex IP (or redirect apex → www)
3. Remove the domain from any old Render/Polsia service first.

## 5. Cron jobs (in-process)

All scheduled tasks run inside the web process — no external cron platform needed:

| Task | Schedule |
|------|----------|
| Pre-flight email reminders | Hourly |
| PDF backups | Daily 2 AM CT (+ weekly/monthly/yearly) |
| CSV exports | Nightly 11 PM CT |
| Endorsement expiry alerts | Daily |

Set `DISABLE_IN_PROCESS_CRONS=true` only if you run jobs elsewhere.

## 6. Cutover from Render

1. Deploy on Railway and test on the `*.up.railway.app` URL.
2. Log in, create a booking, confirm emails send.
3. Update DNS to Railway.
4. Pause or delete the Render service once verified.

## 7. Staging

Create a second Railway service from branch `staging` with `APP_ENV=staging`. Same Neon DB — data is isolated by the `source` column.
