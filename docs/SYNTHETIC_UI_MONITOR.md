# Synthetic UI Monitor (GitHub Actions)

The synthetic UI monitor is a scheduled GitHub Actions workflow that exercises the production admin portal and Supabase backend end-to-end. It lives at `.github/workflows/synthetic-monitor.yml`.

## What it does
- **Runs every 30 minutes** and **after each successful frontend deployment** (also runnable manually with `workflow_dispatch`).
- **Secrets gate:** skips entirely if `FRONTEND_URL`, `VITE_SUPABASE_URL`, or `VITE_SUPABASE_ANON_KEY` are missing.
- **URL resolution:** uses `FRONTEND_URL` by default, or the `frontend_url_override` input when dispatched manually.
- **Checks performed (in order):**
  1. **HTTP 200 check** against the frontend URL.
  2. **Supabase reachability** via `GET /rest/v1/` (the PostgREST root endpoint) with the anon key. Using the root endpoint avoids false positives from RLS policies or table-level access restrictions on specific tables.
  3. **Playwright render check** (headless Chromium) that:
     - Loads the login page and captures JS/console errors (filters common noise).
     - Detects error overlays and multiple JS errors.
     - Detects Vercel protection using multiple signals: the `x-vercel-id` response header, "vercel" in the page title/body, or a `*.vercel.app` URL. A 401/403 combined with any of these signals is treated as a **soft pass** for the HTTP/Supabase checks to avoid noisy alerts when protection is enabled.

- **Health evaluation:** marks the run unhealthy if any check fails (after applying the Vercel soft-pass logic).

## Failure handling
- When unhealthy **and** `SUPABASE_SERVICE_ROLE_KEY` + `SYNTHETIC_MONITOR_USER_ID` are set, the workflow inserts a `bug_reports` row via Supabase REST:
  - `app_version: "synthetic-monitor"`
  - `auto_reported: true`
  - Severity `high` with a summary of which checks failed and the workflow run URL.
- A step summary is appended to the GitHub Actions run with pass/fail for each check. When Vercel protection is detected, an additional ⚠️ row is shown in the summary.

## Required secrets
- `FRONTEND_URL` – production portal URL (e.g., `https://app.freedomcamp.co.nz`)
- `VITE_SUPABASE_URL` – Supabase project URL
- `VITE_SUPABASE_ANON_KEY` – Supabase anon key

## Optional but recommended
- `SUPABASE_SERVICE_ROLE_KEY` – enables auto bug report inserts
- `SYNTHETIC_MONITOR_USER_ID` – service account reporter for auto-created reports
