# FlightSlate / New Tech Aviation

Flight school management platform — scheduling, booking, instructor availability, student tracking, aircraft management, and billing.

## Stack

Express.js + PostgreSQL + vanilla JS frontend

## Local development

```powershell
npm install
npm run setup    # create local DB + sync CMS from live site
npm run dev      # http://localhost:3000
```

See [LOCAL_SETUP.md](LOCAL_SETUP.md) for details.

## Deploy (Render)

1. Connect this repo to Render as a **Web Service**
2. Set environment variables: `DATABASE_URL`, `JWT_SECRET`, `APP_ENV=production`, `APP_URL=https://www.newtechaviation.com`
3. Build: `npm install` | Start: `npm start` | Health: `/health`

## Live site

- https://www.newtechaviation.com
