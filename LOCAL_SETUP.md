# FlightSlate — Local Development

## Quick start

```powershell
cd "C:\Users\Darth Vader\Desktop\TEST"
npm install
node scripts/fetch-live-cms.js   # sync CMS/images from live site
node scripts/setup-local.js      # create DB + admin user
npm run dev
```

Open:
- **Public website:** http://localhost:3000/
- **Student/instructor portal:** http://localhost:3000/app

Default local login (created by setup):
- Email: `evaughntaemw@gmail.com`
- Password: `NewTech2026!`

## Using production database (optional)

To use your real Render/Neon data (same users, bookings, etc.):

1. Log into [Render Dashboard](https://dashboard.render.com)
2. Open your FlightSlate web service → **Environment**
3. Copy `DATABASE_URL`
4. Create `.env` with:
   ```
   DATABASE_URL=postgresql://...your-neon-url...
   JWT_SECRET=...same as production...
   APP_ENV=production
   PORT=3000
   NODE_ENV=development
   APP_URL=http://localhost:3000
   ```

## GoDaddy migration notes

This app is a **Node.js server** (not static HTML). GoDaddy shared hosting cannot run it directly. Options:

1. **Keep backend on Render/Railway/Fly.io** — point `www.newtechaviation.com` DNS to that host
2. **GoDaddy VPS/cPanel Node.js** — upload this folder, set env vars, run `npm start`
3. **Split setup** — static marketing pages on GoDaddy, `/app` and `/api` on a Node host

Images are served from Cloudflare R2 URLs (already in CMS data) — they work from any host.

## Refresh CMS from live site

```powershell
node scripts/fetch-live-cms.js
node scripts/setup-local.js
```
