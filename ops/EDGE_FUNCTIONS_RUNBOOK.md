# Edge Functions Deployment & Verification Runbook

> **Audience:** Any developer or operator deploying FieldOps Manager to a Supabase project.
> This runbook covers deploying all 49 Edge Functions, verifying they are active, and running
> smoke tests to confirm end-to-end connectivity.

---

## Prerequisites

Before running any commands, make sure you have the following in place:

| Requirement | How to satisfy |
|---|---|
| **Supabase CLI installed** | `brew install supabase/tap/supabase` (macOS) or see [Supabase CLI docs](https://supabase.com/docs/guides/cli/getting-started) |
| **Supabase CLI version** | `supabase --version` → should be **≥ 1.200.0** |
| **Logged in to Supabase** | `supabase login` — opens a browser to authenticate |
| **Correct project linked** | `supabase link --project-ref YOUR_PROJECT_REF` in the repo root |
| **Repository checked out** | You are running commands from the **repo root** (not a subdirectory) |

### Find your Project Reference ID

1. Open **https://supabase.com/dashboard**
2. Select your project → **Project Settings → General**
3. Copy the **Reference ID** (e.g. `xbfnlzmpumthnjmtqufp`)

### One-time link command

```bash
# Run once per local clone; stored in supabase/.temp/
supabase link --project-ref YOUR_PROJECT_REF
```

---

## Step 1 — Deploy all Edge Functions

Run the following command from the **repo root**:

```bash
supabase functions deploy
```

This single command deploys **all** functions found in `supabase/functions/` to your linked project.

### What it does

- Iterates every subdirectory in `supabase/functions/` (skipping `_shared/`)
- Bundles and uploads each function's TypeScript code to Supabase
- Respects any per-function configuration in `supabase/config.toml`

### Public functions (JWT verification disabled)

Some functions are intentionally accessible without a user token (e.g. called by IoT
devices or external webhooks). Deploy them with the `--no-verify-jwt` flag:

```bash
supabase functions deploy orc-ingest --no-verify-jwt
supabase functions deploy vehicle-ingest --no-verify-jwt
supabase functions deploy alpr-process --no-verify-jwt
supabase functions deploy alpr-retry --no-verify-jwt
supabase functions deploy plate-scanner-photo-first --no-verify-jwt
supabase functions deploy stream-webhook --no-verify-jwt
supabase functions deploy get-weather --no-verify-jwt
supabase functions deploy send-push-notification --no-verify-jwt
```

> **Tip:** The GitHub Actions workflow `deploy-edge-functions.yml` handles the JWT flags
> automatically. If you are deploying from CI/CD rather than locally, use
> **GitHub → Actions → "Deploy Supabase Edge Functions" → Run workflow** and leave
> `function_name` blank to deploy all.

### Expected output

```
Deploying Function: admin-incident-ops (Bundling)
Deploying Function: admin-incident-ops (Uploading)
✓ Deployed Function admin-incident-ops (...)
...
✓ Deployed Function zone-correction (...)
```

A final line shows the total count of functions deployed. If any function fails, the CLI
prints an error for that function but continues deploying the rest.

---

## Step 2 — Set required Edge Function secrets

Edge Functions that call external services need secrets injected at runtime.

In **Supabase Dashboard → Edge Functions → Manage secrets** (or via CLI), set:

| Secret name | Description | Required? |
|---|---|---|
| `PLATERECOGNIZER_TOKEN` | PlateRecognizer API token (ALPR) | Required for ALPR features |
| `NZSCV_PROXY_URL` | URL of your Railway proxy-server | Required for NZSCV lookups |
| `NZSCV_PROXY_SECRET` | Shared secret between Edge Function and proxy | Required for NZSCV lookups |
| `RAILWAY_PROXY_URL` | Same as `NZSCV_PROXY_URL` | Required for NZSCV lookups |
| `INFERENCE_SERVICE_URL` | URL of your Railway inference-service | Required for AI features |
| `OPENWEATHER_API_KEY` | OpenWeatherMap API key | Required for `get-weather` |
| `PARKPOW_API_TOKEN` | ParkPow API token | Optional — enables ParkPow sync |
| `EXPO_ACCESS_TOKEN` | Expo access token | Required for push notifications |

**Via CLI:**

```bash
supabase secrets set PLATERECOGNIZER_TOKEN=your_token_here
supabase secrets set NZSCV_PROXY_URL=https://your-proxy.railway.app
# ... repeat for each secret
```

---

## Step 3 — Verify all functions are Active

1. Open **https://supabase.com/dashboard**
2. Select your project → **Edge Functions** (left sidebar)
3. You should see **49 functions** listed. Confirm each shows a green **Active** badge.

### Complete list of expected functions

| # | Function name |
|---|---|
| 1 | `admin-incident-ops` |
| 2 | `alpr-process` |
| 3 | `alpr-retry` |
| 4 | `analyze-vehicle-photo` |
| 5 | `check-almost-breaches` |
| 6 | `check-data-integrity` |
| 7 | `check-nzscv-status` |
| 8 | `check-railway-health` |
| 9 | `check-zone-corrections` |
| 10 | `cleanup-and-recalculate` |
| 11 | `correct-zone-assignments` |
| 12 | `create-user` |
| 13 | `duplicate-detection` |
| 14 | `enrich-from-motorweb` |
| 15 | `generate-dashboard-report` |
| 16 | `generate-incident-pdf` |
| 17 | `generate-infringement` |
| 18 | `generate-leadership-pack` |
| 19 | `generate-notice-to-vacate` |
| 20 | `generate-vehicle-report` |
| 21 | `get-compliance-statistics` |
| 22 | `get-weather` |
| 23 | `hotspot-data` |
| 24 | `import-data` |
| 25 | `import-historical-data` |
| 26 | `monitor-officer-welfare` |
| 27 | `observations-export` |
| 28 | `observations-in-bounds` |
| 29 | `observations-list` |
| 30 | `onspace-ai-chat` |
| 31 | `orc-ingest` |
| 32 | `parkpow-sync` |
| 33 | `plate-scanner-photo-first` |
| 34 | `process-credential-document` |
| 35 | `process-homeless-data` |
| 36 | `process-investigation-document` |
| 37 | `recalculate-compliance` |
| 38 | `recalculate-compliance-v2` |
| 39 | `scan-breaches` |
| 40 | `scrape-vehicle-photos` |
| 41 | `select-best-vehicle-photo` |
| 42 | `send-push-notification` |
| 43 | `stream-webhook` |
| 44 | `suggest-new-zone` |
| 45 | `update-compliance-policy` |
| 46 | `update-user-password` |
| 47 | `upload-file` |
| 48 | `vehicle-ingest` |
| 49 | `zone-correction` |

If any function is missing or shows as **Failed**, redeploy it individually:

```bash
supabase functions deploy <function-name>
```

Then refresh the Dashboard and check again.

---

## Step 4 — Smoke tests

Run these from your local terminal after deploying. They test three representative functions
across different categories (ALPR, weather, NZSCV).

### Test 1 — ALPR processing pipeline

```bash
supabase functions invoke alpr-process --body '{"test": true}'
```

**Expected:** HTTP 200 with a JSON response (e.g. `{"status":"ok"}` or a structured result).
No `500` or `Function not found` errors.

### Test 2 — Weather lookup

```bash
supabase functions invoke get-weather --body '{"latitude": -36.848, "longitude": 174.763}'
```

**Expected:** HTTP 200 with weather data for Auckland (latitude -36.848, longitude 174.763).
The response will include temperature and conditions from OpenWeatherMap.

> **Note:** Requires `OPENWEATHER_API_KEY` to be set in Edge Function secrets (Step 2).
> Without the key, the function returns an error — which is still proof it executed correctly.

### Test 3 — NZSCV vehicle check

```bash
supabase functions invoke check-nzscv-status --body '{"plate_number": "TEST123"}'
```

**Expected:** HTTP 200 with a JSON payload containing vehicle registration data or a "not found"
response for the test plate. A `500` only if the proxy is not reachable.

> **Note:** Requires `NZSCV_PROXY_URL` and `NZSCV_PROXY_SECRET` to be set (Step 2).

### Interpreting results

| HTTP status | Meaning |
|---|---|
| `200` | Function executed successfully |
| `401` / `403` | JWT issue — check the function was deployed with the right JWT flag |
| `404` / `Function not found` | Function was not deployed — re-run `supabase functions deploy` |
| `500` | Function threw an error — check **Supabase → Edge Functions → Logs** for details |

---

## Troubleshooting

### "supabase: command not found"

Install the Supabase CLI:

```bash
# macOS / Linux via Homebrew
brew install supabase/tap/supabase

# Or via npm
npm install -g supabase
```

### "Error: not logged in"

```bash
supabase login
```

### "Error: project not linked"

```bash
supabase link --project-ref YOUR_PROJECT_REF
```

Find your project ref at: **Supabase Dashboard → Project Settings → General → Reference ID**

### "Error: Function X failed to deploy"

1. Check the function's `index.ts` for syntax errors
2. Try deploying just that function: `supabase functions deploy <function-name>`
3. Check **Supabase → Edge Functions → Logs** for runtime errors after deployment

### Function deploys but returns 500 in smoke tests

1. Open **Supabase → Edge Functions → <function-name> → Logs**
2. Look for missing secrets (e.g. `OPENWEATHER_API_KEY is not set`)
3. Add the missing secret via **Edge Functions → Manage secrets** and retry

---

## Quick reference

```bash
# Full deploy (all 49 functions)
supabase functions deploy

# Deploy a single function
supabase functions deploy <function-name>

# Deploy a public function (no JWT)
supabase functions deploy <function-name> --no-verify-jwt

# Smoke tests
supabase functions invoke alpr-process --body '{"test": true}'
supabase functions invoke get-weather --body '{"latitude": -36.848, "longitude": 174.763}'
supabase functions invoke check-nzscv-status --body '{"plate_number": "TEST123"}'

# List deployed functions (shows status)
supabase functions list

# View logs for a function
supabase functions logs <function-name>
```

---

## Related documentation

- [`ONLINE_DEPLOYMENT_GUIDE.md`](../ONLINE_DEPLOYMENT_GUIDE.md) — Full browser-only deployment guide (no CLI required)
- [`.github/workflows/deploy-edge-functions.yml`](../.github/workflows/deploy-edge-functions.yml) — GitHub Actions workflow for CI/CD deployment
- [Supabase Edge Functions docs](https://supabase.com/docs/guides/functions)
- [Supabase CLI reference](https://supabase.com/docs/reference/cli/supabase-functions-deploy)
