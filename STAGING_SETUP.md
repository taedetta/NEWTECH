# FlightSlate Staging & Production Data Isolation Setup

## Overview

FlightSlate now supports **complete data isolation between staging and production environments** using source-tag filtering. Both environments share the same PostgreSQL database, but queries are filtered by the `APP_ENV` environment variable to ensure staging data never leaks into production and vice versa.

## Quick Start (TL;DR)

✅ **What's already set up:**
- `staging` branch created in GitHub
- Source column added to all data tables via migration
- `db/source-wrapper.js` handles source-aware queries
- Production app running with `APP_ENV=production`
- Existing data tagged as `source='production'`

⚡ **Next steps to enable staging preview:**
1. Go to Render dashboard: https://dashboard.render.com
2. Create new service from `staging` branch
3. Set `APP_ENV=staging` in environment variables
4. Deploy and test
5. Run `node verify-source-isolation.js` to confirm isolation

📋 **Current Status:**
- **Production**: https://new-tech-aviation.polsia.app (APP_ENV=production)
- **Staging**: Ready to deploy (staging branch exists in GitHub)

## Architecture

### Source-Tag Isolation

- **`source` column**: Added to all data tables (`bookings`, `aircraft`, `users`, `billing_entries`, etc.)
- **APP_ENV variable**: Controls which records each service instance sees
  - `APP_ENV=production` → only sees `source = 'production'` records
  - `APP_ENV=staging` → only sees `source = 'staging'` records
- **New records**: Automatically tagged with the current APP_ENV
- **Existing records**: All tagged as `production` (no data loss, backward compatible)

### Database Layer

- **db/source-wrapper.js**: Helper module for source-aware queries
  - `buildSourceParam()` → get source value for INSERT
  - `addSourceFilter()` → append source filter to SELECT/UPDATE/DELETE
  - `queryWithSourceFilter()` → convenience wrapper
- **db/<entity>.js**: Each module manually wraps queries
  - INSERT: explicitly add source column + value
  - SELECT/UPDATE/DELETE: use `queryWithSourceFilter()` to auto-filter

## Current Setup

### Production Service (LIVE)

- **URL**: https://new-tech-aviation.polsia.app
- **Branch**: `main`
- **APP_ENV**: `production`
- **Database**: Shared Neon PostgreSQL (`flightslate`)
- **Visibility**: Only sees records with `source = 'production'`

### Staging Branch (CREATED)

- **Branch**: `staging` (in GitHub at https://github.com/Polsia-Inc/flightslate)
- **Code**: Identical to main, with source isolation ready
- **Status**: Ready to deploy

## Setting Up a Staging Preview Service

### Option 1: Render Preview Deployments (Recommended)

1. **Create a Render service from staging branch** (manual setup in Render dashboard):
   - Go to https://dashboard.render.com/
   - Create a new service pointing to the `staging` branch
   - Use the same database URL as production
   - Set environment variables:
     ```
     APP_ENV=staging
     DATABASE_URL=<same as production>
     JWT_SECRET=<same secret as production>
     NODE_ENV=production
     ```
   - Deploy and note the preview URL

2. **Test data isolation**:
   - Create a test booking on staging → verify it does NOT appear in production
   - Create a test booking on production → verify it does NOT appear in staging

### Option 2: GitHub Preview Deployments

1. Create a pull request from `staging` → `main`
2. Render automatically creates a preview deployment
3. Set `APP_ENV=staging` on the preview service environment variables
4. Test as above

### Option 3: Temporary Local Testing

```bash
# Terminal 1: Production (main branch)
APP_ENV=production npm start
# Server listens on http://localhost:3000

# Terminal 2: Staging (staging branch)
git checkout staging
APP_ENV=staging npm start
# Server listens on http://localhost:3001 (use a different port)
```

## Workflow

### Development → Staging → Production

1. **Feature development**: Create feature branch from `staging`
   ```bash
   git checkout staging
   git checkout -b feature/new-feature
   # Make changes
   git push origin feature/new-feature
   ```

2. **Test on staging**:
   - Create PR: `feature/new-feature` → `staging`
   - Render creates preview deployment for the PR
   - Test thoroughly (test bookings, users, etc. created on staging are isolated)
   - Merge to `staging` (updates staging preview URL if configured)

3. **Merge to production**:
   - Create PR: `staging` → `main`
   - Code review
   - Merge (auto-deploys to production with `APP_ENV=production`)

### GitHub Branch Setup (Completed)

The `staging` branch has been created in the repository:
- **Branch**: `staging` (available at https://github.com/Polsia-Inc/flightslate/tree/staging)
- **Status**: Ready to deploy
- **Configuration**: All source isolation code in place

### Data Migration from Staging → Production

To promote staging data to production:

```sql
-- Tag all staging records as production (one-way promotion)
UPDATE bookings SET source = 'production' WHERE source = 'staging';
UPDATE users SET source = 'production' WHERE source = 'staging';
UPDATE aircraft SET source = 'production' WHERE source = 'staging';
-- ... repeat for all data tables
```

⚠️ **Warning**: This is destructive. Only use when intentionally promoting staging data to production (e.g., final pre-launch testing).

## Verification

### Confirm Source Isolation is Working

Run the verification script:

```bash
node verify-source-isolation.js
```

This script will:
1. Check that both production and staging branches exist
2. Verify migration files are in place
3. Test source-aware queries on a test table
4. Confirm data isolation between APP_ENV values

### Manual Database Checks

```sql
-- Check that source column exists on all tables
SELECT column_name FROM information_schema.columns
WHERE table_name IN ('bookings', 'aircraft', 'users')
AND column_name = 'source';

-- Count records by source
SELECT source, COUNT(*) as record_count FROM bookings GROUP BY source;
SELECT source, COUNT(*) as record_count FROM users GROUP BY source;
```

## Production Checklist

- [ ] Staging branch created (`git branch -a` shows `staging`)
- [ ] Migration file in place (`migrations/1779395261_add_source_isolation.sql`)
- [ ] `db/source-wrapper.js` module created
- [ ] `APP_ENV=production` set on production service
- [ ] Staging preview service configured with `APP_ENV=staging`
- [ ] Test booking created on staging → does not appear in production
- [ ] Test booking created on production → does not appear in staging
- [ ] CLAUDE.md updated with source isolation info

## Rollback (Emergency)

If source isolation needs to be disabled:

1. **Delete source columns** (all data becomes visible to both environments):
   ```bash
   git revert <commit-hash-of-isolation-commit>
   npm run migrate
   git push
   ```

2. **Set APP_ENV to production** on all services to restore unified view

3. **Note**: Data in `source = 'staging'` will remain in database but be invisible until source column is restored

## Troubleshooting

### "All my production data disappeared"
- Check: `SELECT COUNT(*) FROM bookings WHERE source = 'production';`
- If empty: Records may be tagged as `staging`. Run: `UPDATE bookings SET source = 'production' WHERE source IS NULL OR source = '';`

### "Staging changes appear in production"
- Check: Is production service using `APP_ENV=production`?
  - `echo $APP_ENV` on production service
  - If not set, manually set via Render dashboard environment variables
- Check: Are queries using `queryWithSourceFilter()`?

### "New records appear in both environments"
- Check: Is `source` column being inserted correctly?
- Verify: `SELECT source, COUNT(*) FROM bookings GROUP BY source;`
- All new records should match current APP_ENV

## References

- **Source Wrapper Module**: `db/source-wrapper.js`
- **Migration File**: `migrations/1779395261_add_source_isolation.sql`
- **Example Updated Module**: `db/leads.js`
- **Task**: Task #1760006 — Set up staging branch + Render preview with full data isolation
