# New Project Setup Guide

Step-by-step guide to provision a **brand-new deployment** of FreedomCamp Manager from zero —
new Supabase project, all migrations, all edge functions, Railway services, and both
the web admin portal and the native officer mobile app.

---

## Overview

```
What you will have at the end:
  ✅ Supabase project (PostgreSQL + Auth + Storage + Edge Functions)
  ✅ Web admin portal (Vercel / any static host)
  ✅ proxy-server on Railway (static IP for NZSCV + MotorWeb)
  ✅ inference-service on Railway (ONNX AI for plate reading)
  ✅ iOS + Android officer app (Expo / EAS)
  ✅ Push notifications via Expo
  ✅ (Optional) ParkPow integration
```

Estimated setup time: **2–3 hours** for someone familiar with these tools.

---

## Part 1 — Supabase Project

### 1.1 Create the project

1. Go to [https://supabase.com](https://supabase.com) → **New Project**
2. Choose organisation (create one if needed)
3. Project name: e.g. `freedomcamp-prod`
4. Database password: generate a strong one and **save it securely**
5. Region: **ap-southeast-2** (Sydney) — closest to NZ with lowest latency
6. Click **Create new project** — takes ~2 minutes

### 1.2 Save your credentials

From **Project Settings → API**:

```
SUPABASE_URL        = https://YOUR_REF.supabase.co
SUPABASE_ANON_KEY   = eyJhbGci...   (safe to expose in browser)
SERVICE_ROLE_KEY    = eyJhbGci...   (KEEP SECRET — server-side only)
```

From **Project Settings → Database**:
```
DB_PASSWORD         = (the one you set in step 1.4)
DB_HOST             = db.YOUR_REF.supabase.co
```

### 1.3 Apply all database migrations

Install the Supabase CLI:
```bash
npm install -g supabase
supabase login
```

#### Step A — Enable required extensions first

The initial schema migration enables PostGIS and pg_trgm immediately.
They must be available **before** running `supabase db push`.
In the **Supabase Dashboard → SQL Editor**, run:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

> **Note:** PostGIS requires the **Pro plan** or above. Contact Supabase support
> if it is unavailable. `pg_cron` and `vector` (pgvector) are enabled
> automatically by later migrations.

#### Step B — Link and push

Link to your new project:
```bash
cd /path/to/FreedomCamp-Manager
supabase link --project-ref YOUR_REF
```

Apply all 107 migrations:
```bash
supabase db push
```

This creates all tables, functions, triggers, RLS policies, indexes, and pg_cron schedules.

**Verify** — in the Supabase Dashboard → Table Editor, you should see: `observations`, `breach_alerts`, `zones`, `organizations`, `user_profiles`, `enforcement_actions`, `canonical_vehicles`, etc.

### 1.4 Create Storage buckets

In **Supabase Dashboard → Storage → New bucket**:

| Bucket name | Public? | Purpose |
|---|---|---|
| `scans` | ✅ Yes | Vehicle scan photos (ALPR evidence) |
| `evidence` | ❌ No | Incident evidence files |
| `incident-evidence` | ❌ No | Incident PDF attachments |
| `credentials` | ❌ No | Officer credential documents |

For the `scans` bucket, set the following storage policy (RLS):
```sql
-- Allow authenticated officers to upload to their own folder
CREATE POLICY "Officers upload own scans"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'scans' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Allow authenticated users to read all scans in their org
CREATE POLICY "Authenticated read scans"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'scans');
```

### 1.5 Create the first master user

In **Authentication → Users → Add user**:
- Email: your admin email
- Password: strong password
- Click **Create user**

Then in **SQL Editor**, assign the master role:
```sql
INSERT INTO user_profiles (id, email, role, first_name, last_name, organization_id)
SELECT
  id,
  email,
  'master',
  'System',
  'Admin',
  NULL
FROM auth.users
WHERE email = 'YOUR_ADMIN_EMAIL@example.com';
```

### 1.6 Create the first organization

```sql
INSERT INTO organizations (name, organization_type, organization_level, enforcement_workflow, is_active)
VALUES ('Your Council Name', 'client', 3, 'admin_first', true);
```

Copy the generated UUID — you'll need it when creating officer accounts.

---

## Part 2 — Deploy Edge Functions

### 2.1 Set Supabase secrets

These secrets are used by edge functions. Set them all before deploying:

```bash
supabase secrets set \
  PLATERECOGNIZER_TOKEN="YOUR_PLATE_RECOGNIZER_API_KEY" \
  NZSCV_PROXY_URL="https://YOUR_RAILWAY_PROXY_URL" \
  NZSCV_PROXY_SECRET="YOUR_SHARED_SECRET" \
  RAILWAY_PROXY_URL="https://YOUR_RAILWAY_PROXY_URL" \
  INFERENCE_SERVICE_URL="https://YOUR_RAILWAY_INFERENCE_URL" \
  PARKPOW_API_TOKEN="YOUR_PARKPOW_TOKEN" \
  OPENWEATHER_API_KEY="YOUR_OPENWEATHER_KEY" \
  EXPO_ACCESS_TOKEN="YOUR_EXPO_ACCESS_TOKEN"
```

To get API keys:
- **Plate Recognizer**: https://platerecognizer.com — free tier includes 2,500 lookups/month
- **OpenWeather**: https://openweathermap.org/api — free tier sufficient
- **ParkPow**: https://parkpow.com — optional, for parking enforcement platform sync
- **Expo**: https://expo.dev/accounts/YOUR_USERNAME/settings/access-tokens

### 2.2 Deploy all 47 edge functions

```bash
supabase functions deploy
```

This deploys all functions in `supabase/functions/` in one command.

Verify by checking **Supabase Dashboard → Edge Functions** — all 47 should show as "Active".

### 2.3 Test the key functions

```bash
# Test ALPR pipeline connectivity
supabase functions invoke alpr-process --body '{"test": true}'

# Test weather
supabase functions invoke get-weather --body '{"latitude": -36.848, "longitude": 174.763}'

# Test NZSCV proxy connectivity
supabase functions invoke check-nzscv-status --body '{"plate_number": "TEST123"}'
```

---

## Part 3 — Railway Services

### 3.1 proxy-server (NZSCV static IP)

The NZSCV API requires a whitelisted static IP. Railway provides this.

1. Go to [https://railway.app](https://railway.app) → **New Project → Deploy from GitHub repo**
2. Select your fork/repo → choose the `proxy-server/` service directory
   - Or: create a new Railway project and push the `proxy-server/` folder

Configure environment variables in Railway → proxy-server service:
```
PORT=3001
NZSCV_API_URL=https://api.nzscv.govt.nz   (confirm with NZSCV)
NZSCV_API_KEY=YOUR_NZSCV_KEY
MOTORWEB_API_URL=https://api.motorweb.co.nz
MOTORWEB_USERNAME=YOUR_MOTORWEB_USERNAME
MOTORWEB_PASSWORD=YOUR_MOTORWEB_PASSWORD
PROXY_SECRET=YOUR_SHARED_SECRET            (must match NZSCV_PROXY_SECRET above)
```

3. Under Railway → proxy-server → **Settings → Networking**:
   - Enable **Static IP** (costs ~$5/month extra)
   - Note the static IP address → provide this to NZSCV for whitelisting
   - Note the Railway public URL (e.g. `https://freedomcamp-proxy.up.railway.app`)
     → set this as `NZSCV_PROXY_URL` in Supabase secrets

### 3.2 inference-service (ONNX AI)

1. In the same Railway project → **New Service → GitHub repo**
2. Root directory: `inference-service/`
3. Environment variables:
```
PORT=3002
NODE_ENV=production
```
4. Note the Railway public URL → set as `INFERENCE_SERVICE_URL` in Supabase secrets

Verify both services are healthy:
```bash
curl https://YOUR_PROXY_URL/health        # should return {"status":"ok"}
curl https://YOUR_INFERENCE_URL/health    # should return {"status":"ok","models":["yolo","mobilenet"]}
```

---

## Part 4 — Web Admin Portal

### 4.1 Create environment file

```bash
cp .env.example .env
```

Edit `.env`:
```env
VITE_SUPABASE_URL=https://YOUR_REF.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci...YOUR_ANON_KEY
```

### 4.2 Test locally

```bash
bun install
bun run dev
```

Open http://localhost:5173 → login with the master user credentials from Part 1.

### 4.3 Deploy to Vercel

The repo includes a `vercel.json` that configures Vercel automatically:

- **Build command**: `npm run build` (runs `tsc -b && vite build` from `package.json`)
- **Output directory**: `dist`
- **SPA rewrite**: all routes rewrite to `/index.html` for client-side routing

When Vercel imports from the `main` branch it will pick up `vercel.json` with no
further prompts needed. If deploying manually via the CLI:

```bash
npm install -g vercel
vercel login
vercel --prod
```

Accept the detected settings — do **not** override the build command; `vercel.json`
already provides the correct value.

Set environment variables in **Vercel Dashboard → Project → Settings → Environment Variables**:
```
VITE_SUPABASE_URL      = https://YOUR_REF.supabase.co
VITE_SUPABASE_ANON_KEY = eyJhbGci...
```

**Verify the build** — after deploying, open the Vercel deployment log and confirm
the build step shows:

```
Running build command: npm run build
```

If you see `node_modules/.bin/vite build` or any other command, the `vercel.json`
may not be committed or may have been overridden in the Vercel project settings.
Check **Vercel Dashboard → Project → Settings → General → Build & Output Settings**
and ensure "Override" is disabled so `vercel.json` is respected.

Your admin portal is now live at `https://YOUR_PROJECT.vercel.app`.

### 4.4 Alternative: Netlify

```bash
npm install -g netlify-cli
netlify login
netlify init
netlify build
netlify deploy --prod
```

Set the same `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Netlify → Site settings → Environment variables.

---

## Part 5 — Mobile Officer App

### 5.1 Install Expo tools

```bash
npm install -g expo-cli eas-cli
eas login   # create a free Expo account at expo.dev if needed
```

### 5.2 Configure environment

```bash
cd mobile-app
cp .env.example .env   # or create manually
```

`.env` contents:
```env
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_REF.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...YOUR_ANON_KEY
```

### 5.3 Update app.json

Edit `mobile-app/app.json`:
- Replace bundle IDs with your own (reverse domain format):
  ```json
  "bundleIdentifier": "co.nz.YOUR_COMPANY.freedomcamp.officer"  // iOS
  "package": "co.nz.YOUR_COMPANY.freedomcamp.officer"            // Android
  ```
- Replace `YOUR_EAS_PROJECT_ID` after running `eas init`

### 5.4 Test on a physical device (fastest path)

```bash
cd mobile-app
npm install
npx expo start
```

Scan the QR code with the **Expo Go** app (free, available on App Store and Google Play).

The app will load immediately — no build required for development testing.

> **Note:** The `mobile-app/` sub-project uses its own `package.json` and is independent of the
> root Bun workspace. Use `npm install` inside `mobile-app/` as shown above.

### 5.5 Build for distribution

```bash
# One-time: set up EAS project
eas init

# Build for iOS (requires Apple Developer account - $99/year)
eas build --platform ios --profile production

# Build for Android (requires Google Play account - $25 one-time)
eas build --platform android --profile production
```

### 5.6 Internal distribution (no app store needed for field trials)

```bash
# Android APK — can be installed directly via USB or email
eas build --platform android --profile preview

# iOS IPA — install via TestFlight (requires Apple Developer account)
eas build --platform ios --profile preview
eas submit --platform ios   # submits to TestFlight
```

---

## Part 6 — Create Officer Accounts

In the **web admin portal** (logged in as master):

1. Go to **User Management → Add User**
2. Fill in: First name, Last name, Email, Role = `officer`
3. Select the organization
4. A temporary password link is sent by email

Or via SQL:
```sql
-- First create auth user (use Supabase Dashboard → Auth → Users → Add user)
-- Then create the profile:
INSERT INTO user_profiles (id, email, role, first_name, last_name, organization_id)
VALUES (
  'AUTH_USER_UUID_HERE',
  'officer@example.com',
  'officer',
  'John',
  'Smith',
  'ORGANIZATION_UUID_HERE'
);
```

---

## Part 7 — Verify End-to-End

Run through this checklist:

### Database
- [ ] All tables exist (observations, breach_alerts, zones, organizations, etc.)
- [ ] Compliance trigger fires: insert a test observation, check compliance_results is populated
- [ ] Breach trigger fires: insert non-compliant observation, check breach_alerts is created

### Web Portal
- [ ] Master login works
- [ ] Officer login works
- [ ] Admin portal loads without errors
- [ ] Organization management accessible to master

### Edge Functions
- [ ] `get-weather` returns weather data
- [ ] `check-nzscv-status` reaches proxy (even if NZSCV returns error for test plate)
- [ ] `alpr-process` processes a test image

### Mobile App
- [ ] Officer can log in
- [ ] Camera scan creates an observation in Supabase
- [ ] Recent scans appear within 15 seconds
- [ ] Breach alerts display if any exist
- [ ] Push notification arrives on breach detection

### Enforcement Workflow
- [ ] Set org to `officer_direct`: scan a non-compliant vehicle → Warning + Notice buttons appear
- [ ] Set org to `hybrid`: only Warning button appears
- [ ] Set org to `admin_first`: "Reported to admin" badge appears

---

## Part 8 — Production Checklist

Before going live with paying clients:

```
Security:
[ ] Rotate all API keys (they were set during dev)
[ ] Enable Supabase Pro plan (for backups, increased rate limits)
[ ] Verify RLS is enabled on ALL tables
[ ] Test that an officer cannot read another org's data
[ ] Set up Supabase email SMTP for password reset emails

Monitoring:
[ ] Set up Railway alerts for service downtime
[ ] Enable Supabase Database → Performance Advisor
[ ] Set up uptime monitoring (e.g. UptimeRobot, free)

Backups:
[ ] Enable Supabase Point-in-Time Recovery (Pro plan)
[ ] Export initial migration baseline: supabase db dump > baseline.sql

Compliance (NZ Privacy Act 2020):
[ ] Enable privacy_curtain_settings for client organisations
[ ] Set data retention periods in organisation settings
[ ] Brief officers on what data is collected and why
```

---

## Quick Reference — Environment Variables

| Variable | Where it goes | Required |
|---|---|---|
| `VITE_SUPABASE_URL` | Web app `.env` + Vercel | ✅ |
| `VITE_SUPABASE_ANON_KEY` | Web app `.env` + Vercel | ✅ |
| `EXPO_PUBLIC_SUPABASE_URL` | Mobile app `.env` | ✅ |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Mobile app `.env` | ✅ |
| `PLATERECOGNIZER_TOKEN` | Supabase secrets | ✅ |
| `NZSCV_PROXY_URL` | Supabase secrets | ✅ |
| `NZSCV_PROXY_SECRET` | Supabase secrets + Railway proxy | ✅ |
| `INFERENCE_SERVICE_URL` | Supabase secrets | ✅ |
| `OPENWEATHER_API_KEY` | Supabase secrets | ✅ |
| `PARKPOW_API_TOKEN` | Supabase secrets | Optional |
| `EXPO_ACCESS_TOKEN` | Supabase secrets | For push notif |
| `NZSCV_API_KEY` | Railway proxy env | ✅ |
| `MOTORWEB_USERNAME` | Railway proxy env | Optional |
| `MOTORWEB_PASSWORD` | Railway proxy env | Optional |

---

## Estimated Monthly Costs

| Service | Plan | Est. Cost (NZD) |
|---|---|---|
| Supabase | Pro | ~$45/mo |
| Vercel | Hobby (free) or Pro | $0–$40/mo |
| Railway proxy-server | Starter + Static IP | ~$15/mo |
| Railway inference-service | Starter | ~$10/mo |
| Plate Recognizer | Standard | ~$80/mo (2500 lookups) |
| OpenWeather | Free | $0 |
| Apple Developer | Annual | ~$175/yr |
| Google Play | One-time | ~$40 |
| **Total** | | **~$150–200/mo** |

---

## Getting Help

- **Supabase docs**: https://supabase.com/docs
- **Expo docs**: https://docs.expo.dev
- **Railway docs**: https://docs.railway.app
- **Plate Recognizer API**: https://guides.platerecognizer.com
- **This repo's pipeline diagrams**: [docs/PIPELINE_DIAGRAM.md](./PIPELINE_DIAGRAM.md)
