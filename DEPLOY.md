# Deploy to GitHub + Render

GitHub **does not accept account passwords** for git/API (since 2021). Your password works for the website login only. You need a **Personal Access Token (PAT)** or one-time device authorization.

## Step 1 — Push code to GitHub (`taedetta/NEWTECH`)

### Option A: Device login (easiest, ~30 seconds)

In PowerShell:

```powershell
cd "C:\Users\Darth Vader\Desktop\TEST"
& "$env:ProgramFiles\GitHub CLI\gh.exe" auth login --web --git-protocol https --skip-ssh-key
```

1. Copy the one-time code shown (e.g. `ABCD-1234`)
2. Open https://github.com/login/device
3. Paste the code and authorize
4. Then push:

```powershell
git remote remove origin 2>$null
git remote add origin https://github.com/taedetta/NEWTECH.git
git push -u origin main
```

### Option B: Personal Access Token

1. Go to https://github.com/settings/tokens → **Generate new token (classic)**
2. Scope: check **repo**
3. Copy the token (`ghp_...`)
4. Push:

```powershell
cd "C:\Users\Darth Vader\Desktop\TEST"
$env:GITHUB_TOKEN = "ghp_YOUR_TOKEN_HERE"
node scripts/push-to-github-api.js
```

Or with git:

```powershell
git remote add origin https://github.com/taedetta/NEWTECH.git
git push -u origin main
# Username: taedetta
# Password: paste the ghp_ token (not your account password)
```

---

## Step 2 — Connect Render

1. Log into https://dashboard.render.com (email/password or GitHub)
2. **New → Web Service**
3. Connect repository: `taedetta/NEWTECH`, branch `main`
4. Settings:
   - **Build:** `npm install && npm run migrate`
   - **Start:** `npm start`
   - **Health check:** `/health`
5. Environment variables (copy from your existing Polsia/Render service if you have one):

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | Your Neon PostgreSQL URL (`?sslmode=require`) |
| `JWT_SECRET` | Same as production (or generate new) |
| `APP_ENV` | `production` |
| `APP_URL` | `https://www.newtechaviation.com` |
| `NODE_ENV` | `production` |

6. **Create Web Service** — Render builds and deploys automatically on every push.

### Custom domain (GoDaddy DNS)

In Render → your service → **Settings → Custom Domains** → add `www.newtechaviation.com`

In GoDaddy DNS, point to Render:
- **CNAME** `www` → your Render hostname (e.g. `newtech-aviation.onrender.com`)
- **A record** or redirect for apex `@` → Render docs recommend redirecting apex to `www`

---

## Step 3 — Verify

- https://www.newtechaviation.com/health → `{ "ok": true }`
- https://www.newtechaviation.com/ → landing page
- https://www.newtechaviation.com/app → login portal

---

## Already done locally

- Git repo initialized with full codebase committed
- `render.yaml` Blueprint ready for one-click Render deploy
- Local dev running at http://localhost:3000

## Security

**Change your GitHub and Render passwords** — they were shared in chat. Never share passwords in messages; use PATs with limited scope instead.
