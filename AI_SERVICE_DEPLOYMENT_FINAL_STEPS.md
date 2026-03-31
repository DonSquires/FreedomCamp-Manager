# AI Service Connection Fix - Final Deployment Steps

**Status**: Code complete and pushed. Awaiting manual secret configuration.

---

## ✅ Completed Work

### 1. Code Fixes Applied (7 Files)
All fixes committed and pushed to `copilot/fix-duplicate-vehicle-observations`:

**src/components/features/PlateScanner.tsx**
- ❌ Removed: Direct `railwayServices.checkNZSCVCertification()` calls (CORS blocked)
- ✅ Added: Edge function wrapper `edgeFunctions.checkNZSCVStatus()`
- ✅ Added: `edgeFunctions.enrichFromMotorWeb()` for vehicle enrichment

**supabase/functions/onspace-ai-chat/index.ts**
- ✅ Added: Dual AI provider support (GITHUB_TOKEN OR OPENAI_API_KEY)
- ✅ Added: Dual payload format support ({messages:[]} and {message, context})

**5 Edge Functions (Proxy/NZSCV/Compliance)**
- ✅ Added: Secret name fallbacks for backward compatibility
    - `PROXY_SERVER_URL` ← also checks → `NZSCV_PROXY_URL`
    - `PROXY_SERVER_SECRET` ← also checks → `NZSCV_PROXY_SECRET`

Functions updated:
- `check-railway-health`
- `check-nzscv-status`
- `process-officer-scan`
- `recalculate-compliance-v3`
- `cleanup-and-recalculate`

### 2. Validation
- ✅ TypeScript compilation: `npm run typecheck` — PASSED
- ✅ ESLint validation: `npm run lint` — PASSED
- ✅ Merge conflicts: Resolved, branch aligned with origin/main
- ✅ Git status: All staged changes committed and pushed

---

## ⏸️ Pending: Manual Secret Configuration

**Reason**: Supabase CLI (`supabase projects list`, etc.) is timing out in this environment.

### Required Secrets to Set

| Secret | Default Value | Required | Notes |
|--------|---------------|----------|-------|
| **INFERENCE_SERVICE_URL** | `https://orc-ai-inference-service-production.up.railway.app` | YES | AI inference service URL |
| **PROXY_SERVER_URL** | *(from ops)* | YES | NZSCV/MotorWeb proxy URL |
| **NZSCV_PROXY_URL** | *(same as above)* | YES | Backward compatibility alias |
| **PROXY_SERVER_SECRET** | *(from ops)* | IF REQUIRED | Proxy authentication token |
| **NZSCV_PROXY_SECRET** | *(same as above)* | IF REQUIRED | Backward compatibility alias |
| **GITHUB_TOKEN** *or* **OPENAI_API_KEY** | *(from provider)* | YES | Choose ONE for AI chat |

### Option A: Using CLI (if responsive)

```bash
# Set inference service
supabase secrets set \
  INFERENCE_SERVICE_URL=https://orc-ai-inference-service-production.up.railway.app \
  --project-ref kxwjcupuxnnbnzcgmkoi

# Set proxy server (replace <YOUR_PROXY_URL> with actual URL)
supabase secrets set \
  PROXY_SERVER_URL=<YOUR_PROXY_URL> \
  --project-ref kxwjcupuxnnbnzcgmkoi

supabase secrets set \
  NZSCV_PROXY_URL=<YOUR_PROXY_URL> \
  --project-ref kxwjcupuxnnbnzcgmkoi

# Set proxy authentication (if required)
supabase secrets set \
  PROXY_SERVER_SECRET=<YOUR_PROXY_SECRET> \
  NZSCV_PROXY_SECRET=<YOUR_PROXY_SECRET> \
  --project-ref kxwjcupuxnnbnzcgmkoi

# Set AI provider: GitHub (recommended)
supabase secrets set \
  GITHUB_TOKEN=<YOUR_GH_PAT_WITH_COPILOT_SCOPE> \
  --project-ref kxwjcupuxnnbnzcgmkoi

# OR set AI provider: OpenAI (alternative)
supabase secrets set \
  OPENAI_API_KEY=<YOUR_OPENAI_KEY> \
  --project-ref kxwjcupuxnnbnzcgmkoi
```

**Get GITHUB_TOKEN:**
1. Go to https://github.com/settings/tokens/new
2. Token name: "FreedomCamp AI"
3. Check scope: `copilot`
4. Generate and copy token

**Get OPENAI_API_KEY:**
1. Go to https://platform.openai.com/api-keys
2. Create new secret key
3. Copy immediately (can't view again)

### Option B: Using Supabase Dashboard (if CLI unavailable)

1. Go to: https://app.supabase.com/project/kxwjcupuxnnbnzcgmkoi
2. Left sidebar → **Settings** → **Edge Functions** → **Secrets**
3. Click **+** to add each secret above
4. Input name and value for each required secret
5. Click **Save** after each entry

---

## 🚀 Deployment Trigger

Once secrets are set, edge functions will be deployed automatically when changes merge to `main`.

**To manually trigger deployment:**

```bash
# Option 1: Using GitHub CLI
gh workflow run deploy-edge-functions.yml --ref main

# Option 2: Using GitHub web UI
# Go to: https://github.com/DonSquires/FreedomCamp-Manager/actions/workflows/deploy-edge-functions.yml
# Click "Run workflow" → select "main" branch
```

**Deployment auto-triggers** when:
- Changes to `supabase/functions/**` are pushed to `main` branch
- The workflow is manually triggered via GitHub Actions

---

## ✔️ Validation (Post-Deployment)

Once secrets are set and functions are deployed:

### 1. Test AI Chat Endpoint
```bash
# Verify onspace-ai-chat function is responding
curl -X POST https://kxwjcupuxnnbnzcgmkoi.supabase.co/functions/v1/onspace-ai-chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ANON_KEY" \
  -d '{"messages": [{"role": "user", "content": "Test"}]}'
```

Expected: Function responds (no timeout)

### 2. Test PlateScanner NZSCV Lookup
In Field Officer Portal:
1. Go to **Patrols** → Start patrol
2. Click **Scan Vehicle** → **Camera** (or **Enter Plate**)
3. Enter a known plate (e.g., `ABC123`)
4. Should see vehicle details (registration, compliance status, etc.)

Expected: No "NZSCV service unavailable" errors

### 3. Check System Diagnostics
In Admin Portal:
1. Go to **Settings** → **System Diagnostics**
2. Check service health: Inference, NZSCV, MotorWeb
3. All should show "✓ Configured" with green status

Expected: All AI/proxy services show as operational

---

## 📋 Checklist

- [ ] Confirmed INFERENCE_SERVICE_URL value from ops
- [ ] Confirmed PROXY_SERVER_URL value from ops
- [ ] Confirmed PROXY_SERVER_SECRET value (if applicable) from ops
- [ ] Chose AI provider: GitHub (recommended) OR OpenAI
- [ ] Obtained API token/key from provider
- [ ] Set all required secrets (CLI or Dashboard)
- [ ] Triggered edge function deployment (auto or manual)
- [ ] Waited for deployment to complete (check GitHub Actions logs)
- [ ] Tested AI chat endpoint (curl or UI)
- [ ] Tested PlateScanner NZSCV lookup (mobile/web)
- [ ] Verified System Diagnostics show all services operational

---

## 🆘 Troubleshooting

**"AI service request timed out"**
- Check INFERENCE_SERVICE_URL is set and accessible
- Check OPENAI_API_KEY or GITHUB_TOKEN is set
- Verify edge function `onspace-ai-chat` is deployed

**"NZSCV service unavailable"**
- Check PROXY_SERVER_URL and NZSCV_PROXY_URL are set
- Check PROXY_SERVER_SECRET is set (if proxy requires auth)
- Verify edge functions `check-nzscv-status` and `process-officer-scan` are deployed

**"No AI provider configured"**
- Check either GITHUB_TOKEN or OPENAI_API_KEY is set (not both required, but one needed)
- Verify OPENAI_BASE_URL is not set if using GitHub token (uses GitHub Models endpoint)

**Secrets not being picked up after deployment**
- Secrets are cached in edge function deployment; redeployment is required
- Run: `gh workflow run deploy-edge-functions.yml --ref main`
- Wait for workflow to complete and logs to show successful deployment

---

## 📝 Summary

| Step | Status | Owner | Blocker |
|------|--------|-------|---------|
| Code fixes | ✅ Complete | Done | — |
| Typecheck/lint | ✅ Clean | Done | — |
| Git push | ✅ Done | Done | — |
| Set secrets | ⏸️ Pending | **You** | CLI timeout; use Dashboard |
| Deploy functions | ⏳ Ready | Automated | Waiting for merge or manual trigger |
| Validation | ⏳ Ready | **You** | After deployment |

**Next action**: Set required secrets in Supabase (Dashboard recommended), then trigger or merge changes to main.
