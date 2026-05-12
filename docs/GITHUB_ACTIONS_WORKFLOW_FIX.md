## GitHub Actions Workflow Fixes & Configuration Guide

### ✅ Issues Fixed (Commit 331b69f5)

1. **Typo in Supabase Secret Reference**
   - Fixed in: `triage-bug-reports.yml` and `verify-historical-records.yml`
   - Issue: `secrets.SUPERBASE_SURVICE_ROLE_KEY` (typo'd fallback) → removed
   - Solution: Simplified to use only `secrets.SUPABASE_SERVICE_ROLE_KEY`

### ⚠️ Required GitHub Secrets Configuration

For workflows to execute successfully, configure these repository secrets in GitHub:

#### **Supabase Secrets** (Required for: triage-bug-reports.yml, verify-historical-records.yml, and most CI workflows)
- `VITE_SUPABASE_URL` — Your Supabase project URL (e.g., `https://abc.supabase.co`)
- `SUPABASE_URL` — (Fallback) Same as above
- `SUPABASE_PROJECT_REF` — Project reference ID (used in format() fallback)
- `SUPABASE_SERVICE_ROLE_KEY` — Service role API key (starts with `sbp_`)
- `SUPABASE_ANON_KEY` — Anon/public key

#### **Vercel Secrets** (Required for: deploy-frontend.yml)
- `VERCEL_TOKEN` — Vercel authentication token
- `VERCEL_ORG_ID` — Vercel organization ID

#### **Playwright/E2E Test Secrets** (Required for: ops-e2e-smoke.yml, playwright-deep-functional-cross-browser.yml)
- `PLAYWRIGHT_MASTER_EMAIL` — Master user test credentials
- `PLAYWRIGHT_MASTER_PASSWORD`
- `PLAYWRIGHT_ADMIN_EMAIL` — Admin test user
- `PLAYWRIGHT_ADMIN_PASSWORD`
- `PLAYWRIGHT_OFFICER_EMAIL` — Officer test user
- `PLAYWRIGHT_OFFICER_PASSWORD`
- `PLAYWRIGHT_SUPABASE_SERVICE_ROLE_KEY` — (Optional override for E2E)

#### **RunPod Secrets** (Required for: ops-runpod-* workflows)
- `RUNPOD_API_KEY` — RunPod API authentication
- `RUNPOD_ENDPOINT_ID` — Inference server endpoint

#### **Database Secrets** (Required for: db-* workflows)
- `SUPABASE_ACCESS_TOKEN` — Supabase CLI token
- `SUPABASE_DB_PASSWORD` — Database password

### 📋 GitHub Actions Configuration Steps

1. **Go to Repository Settings**
   - Navigate to: `Settings → Secrets and variables → Actions`

2. **Add Repository Secrets**
   - Click "New repository secret"
   - Enter each secret name and value from the lists above

3. **Verify Workflow Permissions**
   - Settings → Actions → General → Workflow permissions
   - Ensure "Read and write permissions" is enabled for workflows

### ✅ Workflow Health Check

After configuring secrets, verify:

```bash
# Check for any remaining typos
git log -p --follow | grep -i "survice\|superbase" || echo "No typos found"

# List all workflows that use secrets
grep -l "secrets\." .github/workflows/*.yml | wc -l

# View the fixed workflows
git show 331b69f5:.github/workflows/triage-bug-reports.yml | grep SUPABASE_SERVICE_ROLE_KEY
```

### 🔍 Troubleshooting

**If triage-bug-reports.yml still fails:**
1. Verify `SUPABASE_SERVICE_ROLE_KEY` is set in GitHub secrets
2. Check that the `bug_reports` table exists in Supabase
3. Verify Row Level Security (RLS) policies allow service role access
4. Check the workflow run logs for specific API error messages

**If other E2E workflows fail:**
1. Verify all Playwright test credentials are correct
2. Check that test users exist in Supabase
3. Run local credential injection: `bash scripts/playwright-codespace-credentials.sh`

### 📝 Recent Commits
- **331b69f5**: `fix: correct typo in SUPABASE_SERVICE_ROLE_KEY secret references in workflows`
  - Fixed typo in 2 workflows that were preventing proper secret resolution
