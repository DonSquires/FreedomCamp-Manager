# Getting Started — Web Only (No Local Installs)

> **This guide is for you if your computer is locked down by your company** and you cannot install software.  
> Everything here works from a **web browser**. You need no special software on your computer at all.

---

## ✅ Current Milestone — Where We Are Right Now (25 Feb 2026)

| Step | Status | Notes |
|------|--------|-------|
| DB Migration (vector columns, RPCs) | ✅ **Done** | Ran in Supabase SQL Editor |
| All 46 edge functions deployed | ✅ **Done** | Manually deployed in Supabase dashboard |
| Supabase secrets (Plate Recognizer, ParkPow, ALPR) | ✅ **Done** | All 4 tokens configured |
| Railway inference service | ⏳ **Change branch** | See Step A below — repo is correct, change branch from `main` → `copilot/add-schema-extraction-tooling` |
| ParkPow zone sync | ⏳ **After Railway** | See Step B below |
| Full end-to-end scan test | ⏳ **After ParkPow** | See Step C below |

---

## 🔜 Next 3 Steps

### Step A — Fix Railway Branch + Deploy the Inference Service (3 minutes, web-only)

> ⚠️ **Root cause of the `npm ci` failure: Railway is watching the `main` branch.**  
> The `main` branch has an older version of `inference-service/` without `package-lock.json`.  
> All the fixes (Debian base image, immediate server start, lockfile) are on **branch `copilot/add-schema-extraction-tooling`**.  
>
> **Fix — change Railway branch right now:**  
> 1. Railway → your service (`orc-ai-inference-service`) → **Settings** tab  
> 2. **Source** section → find **"Branch connected to production"** (currently shows `main`)  
> 3. Click the **branch dropdown** → select **`copilot/add-schema-extraction-tooling`**  
> 4. Save — Railway will auto-redeploy within seconds  
>
> ✅ Root directory stays `inference-service` (already correct)  
> ✅ Domain `orc-ai-inference-service-production.up.railway.app` stays the same  
> ✅ After this PR is merged to `main`, switch the branch back to `main`

**Healthcheck timeout is already set to 300s** ✅ (you set this earlier — good, ONNX models take ~60s to load on first boot)

**While it builds (~2 min), check/add these Variables in Railway (Variables tab):**
- `PORT` = `3000`
- `NODE_ENV` = `production`
- `ALLOWED_ORIGINS` = `https://xbfnlzmpumthnjmtqufp.supabase.co`

**Then set the Railway URL in Supabase:**
1. Supabase Dashboard → **Edge Functions** → **Manage secrets**
2. Add: `INFERENCE_SERVICE_URL` = `https://orc-ai-inference-service-production.up.railway.app`

> After the PR is merged, you can optionally add GitHub secrets for auto-deploy:
> - `RAILWAY_TOKEN` (from https://railway.app/account/tokens)
> - `RAILWAY_SERVICE_ID` (from Railway → Service → Settings → Service ID)

---

### Step B — Run ParkPow Zone Sync (2 minutes, web-only)

> ⚠️ **Important — Merge this PR first!**  
> GitHub only shows `workflow_dispatch` workflows (the ones you trigger manually) when they are on the **default branch (main)**.  
> The ParkPow Sync, Deploy Functions, and Deploy Railway workflows are currently on the PR branch and **will not appear in the Actions tab until this PR is merged to main**.  
>
> **To merge:** Go to https://github.com/DonSquires/FreedomCamp-Manager/pulls → open this PR → click **"Merge pull request"** → **"Confirm merge"**.  
> After merging, all the workflows will appear in the Actions tab immediately.

Once the PR is merged and Railway is live, sync your zones to ParkPow lots:

1. Go directly to: **https://github.com/DonSquires/FreedomCamp-Manager/actions/workflows/parkpow-sync.yml**  
   *(or: GitHub → **Actions** tab → look for **"ParkPow Sync"** in the left list)*
2. Click **"Run workflow"** (grey dropdown button, top right)
3. Choose **Action** = `sync-lots` → click the green **"Run workflow"** button

This creates matching lots in ParkPow for each of your zones.  
Then run it again with `sync-watchlist` to push flagged/exempt vehicles.

> **Required GitHub secrets** (add at https://github.com/DonSquires/FreedomCamp-Manager/settings/secrets/actions):
> - `SUPABASE_URL` — your Supabase project URL (e.g. `https://xbfnlzmpumthnjmtqufp.supabase.co`)
> - `SUPABASE_SERVICE_ROLE_KEY` — Supabase → Settings → API → `service_role` key
>
> `PARKPOW_API_TOKEN` is already in Supabase secrets ✅

---

### Step C — Test the Live App End-to-End

1. Open your Lovable app URL
2. Log in as an officer
3. Go to **Scan** → tap **Scan Plate**
4. Take a photo of any number plate
5. Verify the response shows:
   - ✅ Plate number read by Plate Recognizer
   - ✅ Vehicle make/model/colour
   - ✅ Compliance status (breach / clear / exempt)
   - ✅ ParkPow watchlist status

If anything fails, check **Supabase → Edge Functions → Logs** for the `orc-ingest` function.

---

---

## 🚀 QUICK START — Run the Database Migration Right Now

If you've been asked to run the database migration, here's how to do it in 4 steps — no terminal needed.

### Step 1 — Enable the vector extension in Supabase

1. Go to **https://supabase.com/dashboard** → your project
2. Left sidebar → **Database** → **Extensions**
3. Search for **`vector`**
4. Click the toggle to **enable** it (turns green)

### Step 2 — Open the SQL Editor

1. Still in Supabase dashboard, left sidebar → **SQL Editor**
2. Click **"New query"** (the `+` button at the top-left)

### Step 3 — Copy and paste the migration

1. Go to this file in GitHub:  
   **[`supabase/migrations/20260225_run_in_sql_editor.sql`](https://github.com/DonSquires/FreedomCamp-Manager/blob/copilot/add-schema-extraction-tooling/supabase/migrations/20260225_run_in_sql_editor.sql)**
2. Click the **Copy raw contents** button (clipboard icon, top-right of the file)
3. Paste it into the Supabase SQL Editor

### Step 4 — Run it

1. Click **"Run"** (or press `Ctrl+Enter` / `Cmd+Enter`)
2. Scroll to the bottom of the results panel — you should see green ✅ success notices
3. If you see a red error message, copy it and share with the team

That's it! The database is now up to date.

---

### After the migration — deploy the edge functions ✅ Migration done!

You have **3 functions already deployed manually** (`orc-ingest`, `vehicle-ingest`, `alpr-process`).  
There are **43 more** — the GitHub Actions workflow deploys all of them in **one click**.

#### Complete function inventory (46 total)

**✅ Already deployed (3)**
| Function | What it does |
|----------|-------------|
| `orc-ingest` | Main plate scan entry point (Plate Recognizer → Railway → OnSpace AI) |
| `vehicle-ingest` | Alternative scan path, same 3-tier AI pipeline |
| `alpr-process` | Direct ALPR/Plate Recognizer API call |

**🔴 Deploy next — Core operations (run daily, used by the app)**
| Function | What it does |
|----------|-------------|
| `alpr-retry` | Retries failed ALPR jobs automatically |
| `plate-scanner-photo-first` | Plate scanner shim (photo-first flow) |
| `recalculate-compliance` | Compliance engine — recalculates breach status |
| `recalculate-compliance-v2` | Updated compliance engine with new rules |
| `scan-breaches` | Scans zones for new breaches |
| `check-almost-breaches` | Early-warning: vehicles approaching breach threshold |
| `observations-list` | Returns filtered observations list (used by officer app) |
| `observations-in-bounds` | Returns observations in a map bounding box |
| `get-compliance-statistics` | Stats for admin dashboard |
| `send-push-notification` | Sends push alerts to officer phones |
| `parkpow-sync` | Syncs zones/watchlist/violations with ParkPow |

**🟠 Deploy second — Reporting & documents**
| Function | What it does |
|----------|-------------|
| `generate-dashboard-report` | Admin dashboard PDF report |
| `generate-incident-pdf` | Individual incident report PDF |
| `generate-leadership-pack` | Leadership/board summary report |
| `generate-notice-to-vacate` | Formal notice to vacate document |
| `generate-vehicle-report` | Vehicle history report |
| `observations-export` | CSV/Excel export of observations |
| `admin-incident-ops` | Admin incident management operations |
| `hotspot-data` | Hotspot heatmap data for maps |

**🟡 Deploy third — Vehicle enrichment & AI**
| Function | What it does |
|----------|-------------|
| `analyze-vehicle-photo` | AI photo analysis (colour, make, model from photo) |
| `select-best-vehicle-photo` | Picks best photo from a set |
| `enrich-from-motorweb` | Enriches vehicle data from MotorWeb NZ API |
| `check-nzscv-status` | Checks vehicle against NZSCV database |
| `duplicate-detection` | Detects duplicate observations |
| `onspace-ai-chat` | OnSpace AI chat interface |
| `get-weather` | Weather data for a location |
| `stream-webhook` | Stream.io webhook handler (real-time chat) |

**🟢 Deploy last — Admin & setup (run occasionally)**
| Function | What it does |
|----------|-------------|
| `create-user` | Create a new user account |
| `update-user-password` | Reset a user's password |
| `upload-file` | File/photo upload handler |
| `import-data` | Bulk data import |
| `import-historical-data` | Historical data import tool |
| `process-credential-document` | Process credential/ID document |
| `process-homeless-data` | Process welfare/homeless intake data |
| `process-investigation-document` | Process investigation documents |
| `cleanup-and-recalculate` | Full cleanup and recalc sweep |
| `correct-zone-assignments` | Fix zone assignment errors |
| `check-zone-corrections` | Audit zone assignment accuracy |
| `check-data-integrity` | Database integrity check |
| `suggest-new-zone` | AI suggestion for new zones |
| `zone-correction` | Apply zone corrections |
| `update-compliance-policy` | Update compliance rules for a zone |
| `monitor-officer-welfare` | Welfare check-in monitoring |

---

#### 👉 Fastest way to deploy all 43 remaining functions at once

The deploy workflow needs two secrets added to GitHub **once** before it can run.

#### Step A — Add GitHub Secrets (one-time setup)

**Secret 1 — `SUPABASE_ACCESS_TOKEN`**
1. Go to **https://supabase.com/dashboard/account/tokens**
2. Click **"Generate new token"**
3. Give it a name (e.g. *GitHub Deploy*) → click **Generate**
4. **Copy the token immediately** — you can only see it once!

**Secret 2 — `SUPABASE_PROJECT_REF`**
1. Go to **https://supabase.com/dashboard** → your project
2. Click **Project Settings** (bottom of left sidebar) → **General**
3. Copy the **Reference ID** (looks like `abcdefghijklmnop` — 16 characters)

**Add both secrets to GitHub:**
1. Go to **https://github.com/DonSquires/FreedomCamp-Manager/settings/secrets/actions**
2. Click **"New repository secret"**
3. Name: `SUPABASE_ACCESS_TOKEN` → paste the token → **Add secret**
4. Click **"New repository secret"** again
5. Name: `SUPABASE_PROJECT_REF` → paste the reference ID → **Add secret**

#### Step B — Run the deploy workflow

1. Go to **https://github.com/DonSquires/FreedomCamp-Manager/actions**
2. Click **"Deploy Supabase Edge Functions"** in the left list
3. Click the **"Run workflow"** dropdown (right side, grey button)
4. Leave **function name blank** (deploys ALL ~50 functions)
5. Click the green **"Run workflow"** button
6. Watch the progress — green ✅ = success, yellow ⚠️ = one function had a warning (others continue), red ✗ = needs attention

> **Note:** Public functions (`orc-ingest`, `vehicle-ingest`, `alpr-process`, etc.) are automatically deployed without JWT verification — you don't need to change any settings.

---

## What you need

| What | Where to get it |
|------|----------------|
| A web browser | You already have it (Chrome, Edge, Firefox, Safari) |
| A GitHub account | https://github.com — free |
| Access to the FreedomCamp-Manager GitHub repo | Ask the repo owner to add you |
| Access to the Supabase project | https://supabase.com — free |

That's it. Nothing to install.

---

## The three web tools you will use

### 1. GitHub — version control, deployments, scripts

> https://github.com/DonSquires/FreedomCamp-Manager

This is where the code lives. You can:
- Browse and edit files directly in your browser
- Run scripts and deployments using **GitHub Actions** (no terminal needed)
- Open a full browser-based VS Code editor with **GitHub Codespaces**

---

### 2. Supabase — database and edge functions

> https://supabase.com

This is your database and backend. You can:
- Browse live data in the **Table Editor**
- Run SQL queries in the **SQL Editor**
- View and manage **Edge Functions**
- See **logs** and **auth users**
- Configure **secrets** for your edge functions

---

### 3. Railway — AI inference service

> https://railway.app

This hosts the AI vehicle-recognition service. You can:
- See if the inference service is running
- View logs
- Set environment variables (secrets)
- Redeploy with one click

---

## How to edit code in your browser (GitHub Codespaces)

GitHub Codespaces gives you a full VS Code editor running in a cloud computer — accessible entirely from your browser. No installs.

### Step 1 — Open Codespaces

1. Go to: https://github.com/DonSquires/FreedomCamp-Manager
2. Click the green **`< > Code`** button
3. Click the **Codespaces** tab
4. Click **"Create codespace on main"** (or your branch)

> A browser tab opens with a VS Code editor. Wait about 60 seconds for it to finish setting up.

### Step 2 — Use the terminal inside Codespaces

Once the Codespace is ready, open a terminal:
- Press `` Ctrl + ` `` (backtick)  
- Or click **Terminal → New Terminal** in the top menu

The terminal is a full Linux bash shell. You can run any script from here:

```bash
# Example: run the schema extraction script
chmod +x tools/schema-extract/run_extract.sh
./tools/schema-extract/run_extract.sh
```

### Step 3 — Preview the app

When the Codespace is ready, Vite starts automatically. A popup will ask if you want to open the preview — click **Open in Browser**. The app runs in a browser tab.

### Step 4 — Save your work

Changes you make in the Codespace can be committed and pushed just like normal:

1. Click the **Source Control** icon (branch icon) in the left sidebar
2. Type a message in the box (e.g. "Fix compliance page")
3. Click **Commit & Push**

---

## How to run scripts / deployments without any terminal

Everything can be triggered from the **GitHub Actions** web UI.

### Step 1 — Go to Actions

1. Go to: https://github.com/DonSquires/FreedomCamp-Manager/actions
2. You'll see a list of available workflows on the left

### Step 2 — Run a workflow

Click on the workflow you want to run:

| Workflow | What it does |
|----------|-------------|
| **Extract Database Schema** | Pulls DB structure from Supabase and saves it as files |
| **Deploy Supabase Edge Functions** | Deploys edge functions (plate scanner, orc-ingest, etc.) |
| **Run Database Migrations** | Applies new database changes |
| **[ParkPow Sync](https://github.com/DonSquires/FreedomCamp-Manager/actions/workflows/parkpow-sync.yml)** | Syncs zones and violations with ParkPow enforcement |

Then:
1. Click **"Run workflow"** (top right of the workflow page)
2. Fill in any options shown
3. Click the green **"Run workflow"** button

The workflow runs in the cloud. Watch the progress in your browser. You'll see green ticks or red crosses for each step.

---

## How to run database queries (no terminal needed)

1. Go to: https://supabase.com/dashboard
2. Select your project
3. Click **SQL Editor** in the left menu
4. Type or paste any SQL query
5. Click **Run** (or press Ctrl+Enter)

### Useful queries to get started

**See all live observations:**
```sql
SELECT * FROM observations ORDER BY created_at DESC LIMIT 50;
```

**Count observations per zone:**
```sql
SELECT z.name, COUNT(o.id) as total
FROM observations o
JOIN zones z ON z.id = o.zone_id
GROUP BY z.name
ORDER BY total DESC;
```

**See breaches in the last 7 days:**
```sql
SELECT plate_number, zone_id, created_at, compliance_status
FROM observations
WHERE compliance_status = 'breach'
  AND created_at > NOW() - INTERVAL '7 days'
ORDER BY created_at DESC;
```

**See canonical vehicles:**
```sql
SELECT plate_number, make, model, colour, is_flagged, is_exempt
FROM canonical_vehicles
ORDER BY updated_at DESC LIMIT 50;
```

---

## How to apply a database migration (no terminal)

### Option A — GitHub Actions (recommended)

1. Go to: Actions → **Run Database Migrations** → Run workflow
2. Choose `dry_run: true` first to see what it will do
3. Then choose `dry_run: false` to apply

### Option B — Supabase SQL Editor

1. Go to Supabase → **SQL Editor**
2. Open the migration file from GitHub (e.g. `supabase/migrations/20260225_orc_ai_observations.sql`)
3. Copy the contents
4. Paste into the SQL Editor
5. Click **Run**

---

## How to deploy an edge function (no terminal)

### Option A — GitHub Actions (recommended)

1. Go to: Actions → **Deploy Supabase Edge Functions** → Run workflow
2. Leave `function_name` blank to deploy all, or type a specific name (e.g. `orc-ingest`)
3. Click **Run workflow**

### Option B — Supabase Dashboard

1. Go to Supabase → **Edge Functions**
2. Click the function you want to update
3. Click **Edit** and paste the new code
4. Click **Save**

---

## How to add or update secrets

### Supabase secrets (used by edge functions)

1. Go to Supabase → **Settings** → **Edge Functions** → **Secrets**
2. Click **Add secret**
3. Name: e.g. `PLATERECOGNIZER_TOKEN`
4. Value: your token
5. Click **Save**

The following secrets should already be configured:
- `PLATERECOGNIZER_TOKEN` — Plate Recognizer API
- `ALPR_API_TOKEN` — same token (legacy name)
- `ALPR_API_URL` — Plate Recognizer endpoint URL
- `PARKPOW_API_TOKEN` — ParkPow enforcement API

### GitHub Actions secrets (used by workflows)

1. Go to: https://github.com/DonSquires/FreedomCamp-Manager/settings/secrets/actions
2. Click **New repository secret**
3. Add:

| Secret name | Where to find it |
|-------------|-----------------|
| `SUPABASE_ACCESS_TOKEN` | Supabase → Account → Access Tokens (top-right menu) |
| `SUPABASE_PROJECT_REF` | Supabase → Settings → General → Reference ID |
| `SUPABASE_DB_PASSWORD` | Supabase → Settings → Database → Password |
| `SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → service_role key |

### Railway secrets (used by inference service)

1. Go to: https://railway.app → your project
2. Click on the **inference-service** service
3. Click **Variables** tab
4. Click **New Variable** and add:
   - `PORT` = `8080`
   - `ALLOWED_ORIGINS` = your Supabase project URL

---

## How to view live logs

### Supabase Edge Function logs

1. Supabase → **Edge Functions**
2. Click on a function (e.g. `orc-ingest`)
3. Click **Logs** tab
4. You'll see every request and any errors in real time

### Railway inference service logs

1. Railway → your project → inference-service
2. Click **Deployments**
3. Click the latest deployment → **View Logs**

### GitHub Actions logs

1. GitHub → **Actions** tab
2. Click on any workflow run
3. Click on a job to see step-by-step output

---

## Summary — the most common tasks

| Task | How to do it |
|------|-------------|
| Edit code | GitHub Codespaces (browser VS Code) |
| Run a script | GitHub Actions → Run workflow |
| Check the database | Supabase → Table Editor |
| Run a SQL query | Supabase → SQL Editor |
| Apply a migration | GitHub Actions → Run Database Migrations |
| Deploy edge functions | GitHub Actions → Deploy Supabase Edge Functions |
| Check logs | Supabase → Edge Functions → Logs |
| Add a secret | Supabase → Settings → Secrets (or GitHub → Settings → Secrets) |
| Sync ParkPow | GitHub → Actions → **[ParkPow Sync](https://github.com/DonSquires/FreedomCamp-Manager/actions/workflows/parkpow-sync.yml)** → Run workflow |
| Redeploy AI service | Railway → inference-service → Redeploy |

---

## Need help?

If something goes wrong:

1. Take a **screenshot** of the error
2. Note which page/tool you were using (Supabase, GitHub Actions, Railway)
3. Share in the project chat or open a GitHub issue

You do **not** need to install anything on your computer to fix it.
