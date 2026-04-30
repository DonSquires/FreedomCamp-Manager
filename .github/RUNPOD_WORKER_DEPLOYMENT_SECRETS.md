# RunPod Worker Deployment Secrets

This document lists the required environment variables and GitHub Actions secrets needed for automatic RunPod worker deployment.

## GitHub Actions Repository Secrets

For automatic deployment via `.github/workflows/deploy-runpod-worker-serverless.yml`, configure these secrets in your GitHub repository settings:

| Secret Name | Description | Example / Source |
|---|---|---|
| `RUNPOD_API_KEY` | RunPod API key (alternative: `RUNPOD_ENDPOINT_API_KEY`) | From RunPod dashboard → API Keys |
| `RUNPOD_ENDPOINT_ID` | RunPod serverless endpoint ID | `n0bp1ifmq01cx2` |
| `SUPABASE_ACCESS_TOKEN` | Supabase personal access token for model secret updates | Generate in Supabase dashboard → Account → Access Tokens |
| `SUPABASE_PROJECT_REF` | Supabase project reference ID | `kxwjcupuxnnbnzcgmkoi` |

### Optional Secrets
| Secret Name | Purpose |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Enables onspace-ai-chat smoke test to verify inference; improves test confidence |

## Local Development Secrets (.env)

For local development, create a `.runtime/bob.env` file (or update if exists):

```bash
# RunPod
RUNPOD_API_KEY=<your-runpod-api-key>
RUNPOD_ENDPOINT_ID=n0bp1ifmq01cx2

# Supabase
SUPABASE_PROJECT_REF=kxwjcupuxnnbnzcgmkoi
SUPABASE_ACCESS_TOKEN=<your-supabase-access-token>

# Optional: for smoke tests
SUPABASE_SERVICE_ROLE_KEY=<your-supabase-service-role-key>
```

This file is git-ignored and will be auto-discovered by promotion scripts.

## Setup Instructions

### 1. GitHub Actions Secrets (Required for CI/CD)

1. Go to your GitHub repository → **Settings** → **Secrets and variables** → **Actions**
2. Create the four repository secrets above
3. Workflow will automatically use these when triggered on `runpod-worker/` changes

### 2. Local / Codespace Secrets (Optional for manual promotion)

1. Copy `.runtime/bob.env.example` to `.runtime/bob.env` (if it exists)
2. Or create `.runtime/bob.env` with the values from GitHub Actions secrets
3. Run: `npm run runpod:endpoint:promote`

## How It Works

**Automatic Promotion (GitHub Actions):**
- Triggered on: Commits to `runpod-worker/` directory on `main` branch
- Action: Calls `npm run runpod:endpoint:promote -- --projectRef <SUPABASE_PROJECT_REF>`
- Result: Models pinned, workers scaled, endpoint refreshed, smoke tests run

**Manual Promotion (Local):**
- Trigger: `npm run runpod:endpoint:promote`
- Prerequisites: `.runtime/bob.env` exists with secrets
- Result: Same as automatic, but runs in local Codespace/dev environment

## Verification

To verify secrets are correctly configured:

```bash
# Check if secrets are loaded (local)
echo "RUNPOD_ENDPOINT_ID=$RUNPOD_ENDPOINT_ID"
echo "SUPABASE_PROJECT_REF=$SUPABASE_PROJECT_REF"

# Run a test promotion (local)
npm run runpod:endpoint:promote -- --waitSeconds 10
```

Expected output includes:
```
RunPod promote: endpoint=n0bp1ifmq01cx2 model=qwen2.5:7b
✓ Supabase secrets pinned
✓ Workers scaled
✓ Endpoint refreshed
✓ Direct smoke test OK
✓ onspace-ai-chat smoke test OK
```

---

**Last Updated:** 2026-04-30  
**Status:** Production Ready
