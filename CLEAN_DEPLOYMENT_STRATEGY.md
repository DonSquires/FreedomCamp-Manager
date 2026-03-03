# Clean Deployment Strategy — New Build

> **Context:** This branch (`copilot/create-new-build-plan-again`) is a fully rebuilt codebase
> — 0 TypeScript errors, clean Vite build. The question is how to go live with this build
> **without inheriting contamination** from the old project's database, config, or history.

---

## TL;DR Decision

| Layer | Action | Why |
|---|---|---|
| **GitHub repo** | Keep — merge this PR with a squash | Code is already clean; no need for a new repo |
| **Supabase project** | **New project** | Old project may have schema drift, manual changes, or dirty data from dev iterations |
| **Railway services** | Keep or recreate (5 min) | Stateless — just update env vars to point at new Supabase |
| **Vercel deployment** | New deployment or update env vars | Just change `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` |
| **Mobile app** | Rebuild with new Supabase env vars | Same code, new backend |

**Shortest path to clean production:** Merge PR → new Supabase project → run `supabase db push` → update env vars everywhere → done.

---

## Why Not a New GitHub Repo?

The code on this branch is already clean:
- Only 2 commits of net new work on this branch (it was grafted clean from the start)
- 0 TypeScript errors, clean production build
- All 106 migrations and 51 edge functions are self-contained

A new repo would **add** work (re-clone, re-configure CI, re-connect Vercel, etc.) for no benefit.
Simply **squash-merging this PR into `main`** gives you a clean, authoritative main branch.

---

## Step 1 — Merge This PR Cleanly

On GitHub:
1. Open this PR → **Squash and merge**
2. This lands the entire new build as a **single clean commit** on `main`
3. The old build history stays in git history (read-only, not executed)

If you want the old history completely gone (optional):
```bash
# Option: orphan branch → becomes new main (destructive, requires force push)
git checkout --orphan fresh-main
git add .
git commit -m "feat: clean rebuild — 0 TS errors, complete Phase 1-8"
# Then on GitHub: Settings → Branches → change default branch to fresh-main
```

---

## Step 2 — New Supabase Project (Required)

This is the most important step. The old project (`xbfnlzmpumthnjmtqufp`) has accumulated:
- Schema changes applied manually via the dashboard
- RLS policies edited in place
- Dev/test data mixed with any trial data
- Potentially conflicting migration state

### 2.1 Create the new project

1. [supabase.com](https://supabase.com) → **New Project**
2. Name: `freedomcamp-prod` (or `freedomcamp-v2` for staging first)
3. Region: **ap-southeast-2** (Sydney — lowest latency to NZ)
4. Save the new credentials from **Project Settings → API**

### 2.2 Enable required PostgreSQL extensions first

Before running migrations, ensure the required extensions are available.
`postgis` and `pg_trgm` must be enabled **before** running `supabase db push`
because the initial schema migration activates them immediately.
`pg_cron` and `vector` are enabled automatically by later migrations.

In the **Supabase Dashboard → SQL Editor**, run:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

> **Note:** PostGIS requires the **Pro plan** or above. Contact Supabase support
> if it is not available. `pg_cron` is available on Pro and above; on the Free
> plan the cron-schedule migrations will skip gracefully.

### 2.3 Apply all 107 migrations from scratch

```bash
cd /path/to/FreedomCamp-Manager

# Link to the NEW project ref
supabase link --project-ref YOUR_NEW_PROJECT_REF

# Apply all migrations in one command
supabase db push
```

This creates a perfectly clean schema with all tables, triggers, RLS policies,
pg_cron schedules, pgvector, and PostGIS — exactly as designed.

### 2.4 Enable remaining extensions (auto-enabled by migrations — verify only)

The migrations automatically run `CREATE EXTENSION IF NOT EXISTS pg_cron` and
`CREATE EXTENSION IF NOT EXISTS vector`. After `supabase db push`, confirm they
are installed:

```sql
SELECT extname FROM pg_extension WHERE extname IN ('postgis', 'pg_trgm', 'pg_cron', 'vector');
```

### 2.5 Create Storage buckets

Storage bucket RLS policies are applied during `supabase db push`. The buckets
themselves must be created manually — you can do this **before or after** running
`db push`; the policies activate as soon as the bucket exists.

In **Supabase Dashboard → Storage → New bucket**:

| Bucket | Public | Purpose |
|---|---|---|
| `scans` | ✅ Yes | Vehicle scan photos |
| `evidence` | ❌ No | Incident evidence |
| `incident-evidence` | ❌ No | Incident PDF attachments |
| `credentials` | ❌ No | Officer credential documents |

### 2.6 Seed the first master user + organisation

```sql
-- After creating auth user in Supabase Dashboard → Auth → Users → Add user
INSERT INTO user_profiles (id, email, role, first_name, last_name, organization_id)
SELECT id, email, 'master', 'System', 'Admin', NULL
FROM auth.users
WHERE email = 'YOUR_ADMIN_EMAIL';

-- Create first organisation
INSERT INTO organizations (name, organization_type, organization_level, enforcement_workflow, is_active)
VALUES ('Iron Eagle Security', 'operator', 1, 'admin_first', true)
RETURNING id;  -- save this UUID
```

---

## Step 3 — Deploy All 51 Edge Functions

### 3.1 Set secrets on the NEW project

```bash
supabase secrets set \
  PLATERECOGNIZER_TOKEN="YOUR_TOKEN" \
  NZSCV_PROXY_URL="https://YOUR_RAILWAY_PROXY_URL" \
  NZSCV_PROXY_SECRET="YOUR_SHARED_SECRET" \
  RAILWAY_PROXY_URL="https://YOUR_RAILWAY_PROXY_URL" \
  INFERENCE_SERVICE_URL="https://YOUR_RAILWAY_INFERENCE_URL" \
  PARKPOW_API_TOKEN="YOUR_TOKEN" \
  OPENWEATHER_API_KEY="YOUR_KEY" \
  EXPO_ACCESS_TOKEN="YOUR_TOKEN"
```

### 3.2 Deploy all functions

```bash
supabase functions deploy
```

All 51 functions deploy in a single command. Verify in Dashboard → Edge Functions.

---

## Step 4 — Update Railway (5 minutes)

Railway services are **stateless** — they don't store data. No new Railway project is needed.

Simply update environment variables on the existing services to point at the new Supabase project
if any of your edge functions URL or service role key changed. In practice, the Railway proxy-server
does not talk directly to Supabase, so no Railway changes may be needed at all.

If you want a clean Railway project too:
1. Railway → New Project → Deploy from GitHub → select `proxy-server/` subdirectory
2. Copy all env vars from the old service
3. Enable Static IP → provide new IP to NZSCV for whitelisting
4. Update `NZSCV_PROXY_URL` secret in new Supabase project

---

## Step 5 — Update Web Admin Portal

### Option A: Vercel (existing deployment)

1. Vercel Dashboard → Your project → **Settings → Environment Variables**
2. Update:
   ```
   VITE_SUPABASE_URL      = https://YOUR_NEW_REF.supabase.co
   VITE_SUPABASE_ANON_KEY = eyJhbGci...NEW_ANON_KEY
   ```
3. Vercel → **Deployments → Redeploy** (picks up new env vars)

### Option B: Fresh Vercel deployment (fully clean)

```bash
git checkout main   # after merging the PR
vercel             # creates a new project
vercel --prod
```

Set the same two env vars when prompted.

---

## Step 6 — Update Mobile App

Edit `mobile-app/.env`:
```env
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_NEW_REF.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...NEW_ANON_KEY
```

Then rebuild:
```bash
cd mobile-app
eas build --platform android --profile production
eas build --platform ios --profile production
```

---

## About the Old Supabase Project

You have three options:

| Option | When to choose |
|---|---|
| **Archive it** | You have live trial data you may need to reference |
| **Delete it** | Clean break, no data worth keeping, saves ~$25/mo |
| **Keep as staging** | Useful as a non-production test environment |

> ⚠️ If the old project has any **real client data** (names, plate numbers, enforcement records),
> check your NZ Privacy Act 2020 obligations before deleting. Export first if in doubt:
> ```bash
> supabase db dump --project-ref OLD_REF > old_project_backup.sql
> ```

---

## Summary Checklist

```
Code:
[ ] Squash-merge this PR into main
[ ] Tag the release: git tag v2.0.0

New Supabase project:
[ ] Create project (ap-southeast-2)
[ ] Enable extensions in SQL Editor: CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS pg_trgm;
[ ] supabase link --project-ref NEW_REF
[ ] supabase db push   (107 migrations — includes new 20250101_initial_schema.sql)
[ ] Create storage buckets (scans, evidence, incident-evidence, credentials)
[ ] Create master user + first organisation
[ ] supabase secrets set (all 8 secrets)
[ ] supabase functions deploy   (51 functions)

Update env vars:
[ ] Vercel: VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
[ ] mobile-app/.env: EXPO_PUBLIC_SUPABASE_URL + EXPO_PUBLIC_SUPABASE_ANON_KEY
[ ] supabase/config.toml: project_id = "NEW_REF"
[ ] .env: VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY

Railway (if needed):
[ ] Verify proxy-server health: GET /health → {"status":"ok"}
[ ] Verify inference-service health: GET /health → {"status":"ok"}

Smoke test:
[ ] Master login works
[ ] Officer login works
[ ] Scan from mobile app → observation appears in web portal
[ ] Non-compliant vehicle → breach alert created
[ ] Push notification received on breach
```

---

## What About OnSpace AI?

If "OnSpace" refers to a separate hosted platform or tenant (not just the branding on this app):
- The web admin portal is fully self-contained in this repo — no OnSpace backend dependency
- Update any OnSpace webhook URLs or API keys to point to the new Supabase project URL
- Contact your OnSpace account manager if they need to update their records

If OnSpace = this application (FreedomCamp Manager / Iron Eagle Security product):
- No action needed beyond the steps above

---

## See Also

- [`NEW_PROJECT_SETUP.md`](./NEW_PROJECT_SETUP.md) — full step-by-step provisioning guide
- [`DEPLOYMENT_GUIDE.md`](./docs/DEPLOYMENT_GUIDE.md) — deployment guide
- [`DATABASE_ARCHITECTURE.md`](./DATABASE_ARCHITECTURE.md) — schema reference
- [`EDGE_FUNCTION_DEPLOYMENT_CHECKLIST.md`](./EDGE_FUNCTION_DEPLOYMENT_CHECKLIST.md) — edge function reference
