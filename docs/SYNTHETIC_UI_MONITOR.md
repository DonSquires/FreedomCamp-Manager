# Synthetic UI Monitor (GitHub Actions)

The synthetic UI monitor is a scheduled GitHub Actions workflow that exercises the production admin portal and Supabase backend end-to-end. It lives at `.github/workflows/synthetic-monitor.yml`.

## What it does
- **Runs every 30 minutes** and **after each successful frontend deployment** (also runnable manually with `workflow_dispatch`).
- **Secrets gate:** skips entirely if `FRONTEND_URL`, `VITE_SUPABASE_URL`, or `VITE_SUPABASE_ANON_KEY` are missing.
- **URL resolution:** uses `FRONTEND_URL` by default, or the `frontend_url_override` input when dispatched manually.
- **Checks performed (in order):**
  1. **HTTP 200 check** against the frontend URL.
  2. **Supabase reachability** via `GET /rest/v1/` (the PostgREST OpenAPI schema endpoint). This endpoint returns 200 with a valid anon key whenever PostgREST is running, regardless of table-level grants or RLS policies. (Previously queried the `zones` table directly, which caused HTTP 403 false-failures because the `anon` role lacks `SELECT` on that table.)
  3. **Playwright render check** (headless Chromium) that:
     - Loads the login page and captures JS/console errors (filters common noise).
     - Detects error overlays and multiple JS errors.
     - Detects Vercel protection (401/403 plus Vercel wording) and treats it as a **soft pass** for the HTTP/Supabase checks to avoid noisy alerts when protection is enabled.
     - Writes the JSON result to a temp file; bash parses it and writes `vercel_protection` as a step output (more reliable than writing from inside Node).

- **Health evaluation:** marks the run unhealthy if any check fails (after applying the Vercel soft-pass logic).
  - Vercel protection is detected either from the Playwright step's explicit `vercel_protection` output **or** by inferring it from a 401/403 frontend HTTP response when the Playwright render itself passed — this fallback prevents false-positive bug reports even if the Node output write fails (root cause of incident e9911b5d).

## Failure handling
- When unhealthy **and** `SUPABASE_SERVICE_ROLE_KEY` + `SYNTHETIC_MONITOR_USER_ID` are set, the workflow inserts a `bug_reports` row via Supabase REST:
  - `app_version: "synthetic-monitor"`
  - `auto_reported: true`
  - Severity `high` with a summary of which checks failed and the workflow run URL.
- A step summary is appended to the GitHub Actions run with pass/fail for each check.

## Required secrets
- `FRONTEND_URL` – production portal URL (e.g., `https://app.freedomcamp.co.nz`)
- `VITE_SUPABASE_URL` – Supabase project URL
- `VITE_SUPABASE_ANON_KEY` – Supabase anon key

## Optional but recommended
- `SUPABASE_SERVICE_ROLE_KEY` – enables auto bug report inserts
- `SYNTHETIC_MONITOR_USER_ID` – service account reporter for auto-created reports
