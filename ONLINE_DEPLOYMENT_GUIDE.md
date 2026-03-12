# Online Deployment Guide — Browser Only

> **For users who cannot run commands locally** (locked-down / managed computer).
> Everything in this guide is done via a web browser — no local software installation needed.

Canonical baseline for full provisioning is [docs/NEW_PROJECT_SETUP.md](docs/NEW_PROJECT_SETUP.md).
This document is the browser-only execution variant of that plan.

---

## What you need (browser tabs)

| Tab | URL |
|---|---|
| Supabase dashboard | https://supabase.com |
| This GitHub repo | https://github.com/DonSquires/FreedomCamp-Manager |
| Vercel (web app hosting) | https://vercel.com |
| Railway (proxy + AI services) | https://railway.app |

---

## Step 1 — Create a new Supabase project

1. Go to **https://supabase.com** → sign in
2. Click **New Project**
3. Fill in:
   - **Name:** `freedomcamp-prod` (or any name you like)
   - **Database Password:** generate a strong password and **copy it somewhere safe**
   - **Region:** `Southeast Asia (Singapore)` or `Australia (Sydney)` — pick whichever is closer to New Zealand
4. Click **Create new project** — it takes about 2 minutes

### Save your project credentials

Once the project is created, go to **Settings → API** and save:

```
Project URL:   https://YOUR_REF.supabase.co
anon key:      eyJhbGci...  (safe to put in browser apps)
service_role:  eyJhbGci...  (KEEP SECRET — never expose publicly)
```

From **Settings → General**, save your:
```
Reference ID:  abcdefghijklmnop  (this is YOUR_REF used everywhere)
```

---

## Step 2 — Add secrets to GitHub

> These secrets let the GitHub Actions workflows talk to your Supabase project.

1. Go to your GitHub repo → **Settings** (top menu)
2. Left sidebar → **Secrets and variables → Actions**
3. Click **New repository secret** and add each of the following:

| Secret name | Where to get it |
|---|---|
| `SUPABASE_PROJECT_REF` | Supabase → Settings → General → **Reference ID** |
| `SUPABASE_DB_PASSWORD` | The database password you saved in Step 1 |
| `SUPABASE_ACCESS_TOKEN` | https://supabase.com/dashboard/account/tokens → **Generate new token** (name it `github-actions`) |

> **Tip:** The SUPABASE_ACCESS_TOKEN is a personal token tied to your Supabase account —
> it's different from the project's anon/service_role keys.

---

## Step 3 — (Pro plan only) Enable extensions in SQL Editor

> **Skip this step if you are on the Free plan** — the migrations handle this automatically
> with a graceful warning.

If your project is on the **Pro plan**, run this in **Supabase → SQL Editor** before
running migrations:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

Click **Run** (the ▶ button) to execute.

---

## Step 4 — Run the database migrations

This is the main step. It applies all 107 database migrations to your new project.

1. Go to your GitHub repo → **Actions** (top menu)
2. In the left sidebar, click **"Apply Supabase migrations (db push)"**
3. Click **Run workflow** (top right of the workflow list)
4. In the dropdown that appears:
   - **fresh_install:** set to `true` (you are doing a fresh install)
   - **dry_run:** leave as `false`
5. Click the green **Run workflow** button
6. Watch the progress — click on the running job to see live logs

✅ The workflow finishes in about 2–3 minutes. Green checkmark = success.

### If the workflow fails

Click on the failed step to see the error log. Common issues:

| Error | Fix |
|---|---|
| `Missing secrets` | Go back to Step 2 and add the missing secret |
| `project not found` | Check SUPABASE_PROJECT_REF matches exactly what's in Supabase → Settings → General |
| `password authentication failed` | Check SUPABASE_DB_PASSWORD is correct |
| `token is invalid` | Re-generate SUPABASE_ACCESS_TOKEN at supabase.com/dashboard/account/tokens |

---

## Step 5 — Create storage buckets

> The migration policies are ready — you just need to create the actual buckets.

In **Supabase → Storage → New bucket**, create these 4 buckets:

| Bucket name | Public? | Used for |
|---|---|---|
| `scans` | ✅ **Yes** | Vehicle scan photos (displayed in browser) |
| `evidence` | ❌ No | Incident evidence files |
| `incident-evidence` | ❌ No | PDF attachments for incidents |
| `credentials` | ❌ No | Officer credential documents |

---

## Step 6 — Create your first master user

1. **Supabase → Auth → Users → Add user**
   - Enter the master admin's email and a strong password
   - Click **Create user**
   - **Note the user's UUID** (shown in the user list)

2. **Supabase → SQL Editor**, run:

```sql
-- Replace the email with the one you just created
INSERT INTO user_profiles (id, email, role, first_name, last_name)
SELECT id, email, 'master', 'Your', 'Name'
FROM auth.users
WHERE email = 'YOUR_ADMIN_EMAIL_HERE';
```

3. Create the first organisation:

```sql
INSERT INTO organizations (name, organization_type, organization_level, enforcement_workflow, is_active)
VALUES ('Iron Eagle Security', 'owner', 1, 'admin_first', true)
RETURNING id;
```

Copy the returned `id` (UUID) — you'll need it when adding other users.

---

## Step 7 — Deploy the 51 Edge Functions

1. GitHub repo → **Actions → "Deploy Supabase Edge Functions"**
2. **Run workflow** → leave function_name blank (deploys all)
3. Click **Run workflow**

This takes 3–5 minutes. Any individual function failures show as warnings (the rest still deploy).

### Set Edge Function secrets

In **Supabase → Edge Functions → Manage secrets**, add:

| Secret | Value |
|---|---|
| `PLATERECOGNIZER_TOKEN` | From your PlateRecognizer account |
| `NZSCV_PROXY_URL` | Your Railway proxy-server URL (e.g. `https://proxy.railway.app`) |
| `NZSCV_PROXY_SECRET` | A shared secret string you choose (set the same value in Railway) |
| `RAILWAY_PROXY_URL` | Same as NZSCV_PROXY_URL |
| `INFERENCE_SERVICE_URL` | Your Railway inference-service URL |
| `PARKPOW_API_TOKEN` | From your ParkPow account (optional) |
| `OPENWEATHER_API_KEY` | From openweathermap.org (optional) |
| `EXPO_ACCESS_TOKEN` | From expo.dev → Account → Access tokens (for push notifications) |

---

## Step 8 — Deploy the web admin portal (Vercel)

1. Go to **https://vercel.com** → sign in with GitHub
2. Click **Add New → Project**
3. Import this GitHub repository (`DonSquires/FreedomCamp-Manager`)
4. Under **Environment Variables**, add:

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://YOUR_REF.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Your project's `anon` key (from Supabase → Settings → API) |

5. Click **Deploy**

Vercel builds the app and gives you a URL like `https://freedomcamp-manager.vercel.app`.

---

## Step 9 — Connect a custom domain (iwantmyname.com → Vercel)

> **Skip if you are happy with the default `*.vercel.app` URL.**
> Follow these steps if you have bought a domain at **iwantmyname.com** and want your app to run on it.

### 9a — Add the domain in Vercel

1. Open your project in **https://vercel.com** → **Settings → Domains**
2. Type your domain in the "Add Domain" field and click **Add**
   - Use `yourdomain.com` to point the root/apex domain
   - Use `app.yourdomain.com` to point only a subdomain
3. Vercel shows you the DNS records you need to add. **Leave this tab open** — you will need the values in step 9b.

### 9b — Add DNS records in iwantmyname.com

1. Log in to **https://iwantmyname.com**
2. Go to **Domains → click your domain name → Manage DNS records**

#### Option A — Root / apex domain (e.g. `yourdomain.com`)

Add an **A record**:

| Type | Host | Value (IP) | TTL |
|---|---|---|---|
| `A` | `@` | `76.76.21.21` | 3600 (or "1 hour") |

> `@` means the root/apex of your domain. Some registrars call it "blank" or leave the Host field empty.

#### Option B — Subdomain (e.g. `app.yourdomain.com`)

Add a **CNAME record**:

| Type | Host | Value | TTL |
|---|---|---|---|
| `CNAME` | `app` | `cname.vercel-dns.com.` | 3600 (or "1 hour") |

> Replace `app` with whatever subdomain label you typed into Vercel.

3. Click **Save / Update DNS records**
4. DNS propagation usually takes **5–30 minutes** (up to 24 h in rare cases)

### 9c — Confirm the domain in Vercel

1. Go back to **Vercel → Settings → Domains**
2. Once DNS propagates, Vercel automatically issues a free TLS certificate and shows a ✅ next to the domain
3. If it shows "Invalid Configuration", double-check that the A/CNAME values match exactly what Vercel told you

### 9d — Update Supabase Auth to use your custom domain

1. **Supabase → Authentication → URL Configuration**
2. Update **Site URL** to `https://yourdomain.com` (or your subdomain URL)
3. Under **Redirect URLs**, add `https://yourdomain.com/**`
4. Click **Save**

> Without this step, OAuth and email-link logins will redirect back to the old Vercel URL.

---

## Step 10 — Update `supabase/config.toml` (optional but recommended)

> This step lets future GitHub Actions workflows automatically use the right project.

In this GitHub repo, edit the file `supabase/config.toml`:

1. Click the file in the GitHub file browser
2. Click the ✏️ pencil icon (Edit this file)
3. Change line 3 from:
   ```
   project_id = "xbfnlzmpumthnjmtqufp"
   ```
   to:
   ```
   project_id = "YOUR_NEW_REF"
   ```
4. Scroll down → **Commit changes** → commit directly to the branch

---

## Summary checklist

```
Supabase:
[x] Step 1: New project created (ap-southeast-2 recommended)
[x] Step 3: Extensions enabled in SQL Editor (Pro plan only)
[x] Step 5: Storage buckets created (scans / evidence / incident-evidence / credentials)
[x] Step 6: Master user + first organisation created in SQL Editor

GitHub:
[x] Step 2: 3 secrets added (SUPABASE_PROJECT_REF, SUPABASE_DB_PASSWORD, SUPABASE_ACCESS_TOKEN)
[x] Step 4: "Apply Supabase migrations (db push)" workflow run with fresh_install=true ✅ green
[x] Step 7: "Deploy Supabase Edge Functions" workflow run ✅ green
[x] Step 10: supabase/config.toml updated with new project ref

Vercel:
[x] Step 8: Web admin portal deployed with correct env vars
[ ] Step 9: Custom domain added in Vercel + DNS records set in iwantmyname.com (optional)
[ ] Step 9d: Supabase Auth Site URL updated to custom domain (required if step 9 done)

Edge function secrets (Supabase → Edge Functions → Manage secrets):
[x] PLATERECOGNIZER_TOKEN
[x] NZSCV_PROXY_URL + NZSCV_PROXY_SECRET
[x] RAILWAY_PROXY_URL + INFERENCE_SERVICE_URL
[ ] PARKPOW_API_TOKEN (optional)
[ ] OPENWEATHER_API_KEY (optional)
[x] EXPO_ACCESS_TOKEN
```

---

## Smoke test after deployment

Log in to the Vercel URL with the master user credentials you created in Step 6.

| Test | Expected result |
|---|---|
| Login | Redirects to Portal Selection page |
| Admin portal | Dashboard loads, no errors in browser console |
| Supabase → Table Editor → `user_profiles` | Shows your master user row |
| Supabase → Table Editor → `organizations` | Shows Iron Eagle Security row |

If login fails, check **Supabase → Auth → URL Configuration** — set:
- **Site URL:** `https://your-vercel-url.vercel.app`
- **Redirect URLs:** `https://your-vercel-url.vercel.app/**`

---

## Need to re-run migrations later?

For any future schema changes (new migrations added to the repo):

1. GitHub → **Actions → "Apply Supabase migrations (db push)"**
2. **Run workflow** → `fresh_install = false` (default) → **Run workflow**

That's it — `supabase db push` only applies migrations that haven't been applied yet.
