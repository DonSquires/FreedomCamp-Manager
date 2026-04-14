# Synthetic UI Monitor (GitHub Actions)

The synthetic UI monitor is a scheduled GitHub Actions workflow that exercises the production admin portal and Supabase backend end-to-end. It lives at `.github/workflows/synthetic-monitor.yml`.

## What it does
- **Runs every 30 minutes** and **after each successful frontend deployment** (also runnable manually with `workflow_dispatch`).
- **Secrets gate:** skips entirely if `FRONTEND_URL`, `VITE_SUPABASE_URL`, or `VITE_SUPABASE_ANON_KEY` are missing.
- **URL resolution:** uses `FRONTEND_URL` by default, or the `frontend_url_override` input when dispatched manually.
- **Checks performed (in order):**
  1. **HTTP 200 check** against the frontend URL.
  2. **Supabase reachability** via the REST root endpoint (`/rest/v1/`) with the anon key. This returns the OpenAPI schema (HTTP 200) without depending on any specific table or RLS policy.
  3. **Playwright render check** (headless Chromium) that:
     - Loads the login page and captures JS/console errors (filters common noise).
     - Detects error overlays and multiple JS errors.
     - Detects Vercel deployment protection via three signals: (a) 401/403 with "vercel" in the page content, (b) final URL redirected to a `vercel.com` auth/SSO page, or (c) `x-vercel-id` response header present. Any detected protection is treated as a **soft pass** for the HTTP/Supabase checks.

- **Health evaluation:** marks the run unhealthy if any check fails (after applying Vercel soft-pass logic). An additional fallback soft-pass activates for the frontend check if the browser rendered the page successfully but the direct HTTP check returned 401/403 — this handles Vercel auth redirect flows where the browser follows the redirect (final status 200) while `curl` sees the initial 401/403.
    - Writes the JSON result to a temp file; bash parses it and writes `vercel_protection` as a step output (more reliable than writing from inside Node).

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
