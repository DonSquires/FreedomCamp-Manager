# Synthetic UI Monitor (GitHub Actions)

The synthetic UI monitor is a scheduled GitHub Actions workflow that exercises the production admin portal and Supabase backend end-to-end. It lives at `.github/workflows/synthetic-monitor.yml`.

## What it does
- **Runs every 30 minutes** and **after each successful frontend deployment** (also runnable manually with `workflow_dispatch`).
- **Secrets gate:** skips entirely if `FRONTEND_URL`, `VITE_SUPABASE_URL`, or `VITE_SUPABASE_ANON_KEY` are missing.
- **URL resolution:** uses `FRONTEND_URL` by default, or the `frontend_url_override` input when dispatched manually.
- **Checks performed (in order):**
  1. **HTTP 200 check** against the frontend URL.
  2. **Supabase reachability** via a lightweight probe to the PostgREST root (`/rest/v1/`) which returns the OpenAPI schema with HTTP 200 using only the anon key — no table grants or RLS policy required. This avoids false negatives caused by restrictive RLS on individual tables (e.g. `zones`).
  3. **Playwright render check** (headless Chromium) that:
     - Loads the login page and captures JS/console errors (filters common noise).
     - Detects error overlays and multiple JS errors.
     - Detects Vercel protection (401/403 plus Vercel wording) and emits a `vercel_protection` output.

- **Health evaluation:** marks the run unhealthy if any check fails, after applying Vercel deployment-protection soft-pass logic:
  - **Explicit detection:** if the Playwright check sets `vercel_protection=true` (page title/body contains "Vercel" and HTTP status was 401/403), the Frontend HTTP and Supabase REST checks are soft-passed.
  - **Implicit inference (fallback):** if `vercel_protection` was not set (e.g. the browser was redirected to a Vercel-hosted 200 auth page) but the curl-based frontend check returned 401/403 and Playwright rendered the page successfully, deployment protection is inferred and the same soft-pass is applied. This prevents false alerts in either Vercel protection mode.

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
