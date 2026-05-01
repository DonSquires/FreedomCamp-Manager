# GitHub Actions Secrets - Quick Setup

## Problem
The **Bob Capability Watchdog** workflow is failing because RunPod authentication secrets are missing from GitHub Actions.

## Solution
Set these 2 secrets in your GitHub repository:

### Secrets to Create

| Secret Name | Value | Source |
|---|---|---|
| `RUNPOD_ENDPOINT_ID` | `<your-runpod-endpoint-id>` | Extract from local runtime config (for example `.runtime/bob.env`) |
| `INFERENCE_API_KEY` | `<your-inference-api-key>` | Extract from local runtime config (for example `.runtime/bob.env`) |

### Option 1: Set Secrets via GitHub Web UI (Easiest for one-time setup)

1. Go to: **Settings** → **Secrets and variables** → **Actions**
   - URL: `https://github.com/DonSquires/FreedomCamp-Manager/settings/secrets/actions`

2. Click **"New repository secret"**

3. Create first secret:
   - **Name**: `RUNPOD_ENDPOINT_ID`
   - **Value**: your live endpoint ID from local runtime config
   - Click **"Add secret"**

4. Click **"New repository secret"** again

5. Create second secret:
   - **Name**: `INFERENCE_API_KEY`
   - **Value**: your live inference API key from local runtime config
   - Click **"Add secret"**

### Option 2: Use the Existing Setup Script (Local machine with `gh` CLI)

If you have the GitHub CLI installed locally with proper permissions:

1. Create an env file locally:
```bash
cat > .env.actions.local << 'EOF'
RUNPOD_ENDPOINT_ID=<your-runpod-endpoint-id>
INFERENCE_API_KEY=<your-inference-api-key>
EOF
```

2. Run the setup script:
```bash
GH_TOKEN=<your-token-with-repo-admin> \
  ./scripts/set-actions-secrets.sh \
  --repo DonSquires/FreedomCamp-Manager \
  --file .env.actions.local
```

### Verify Setup

After setting the secrets, re-run the workflow:

1. Go to: **Actions** → **Ops - Bob Capability Watchdog**
2. Click **"Run workflow"** → **Run workflow**
3. Monitor the run - it should now pass the auth probe step

### What the Workflow Does

The **Bob Capability Watchdog** workflow validates that Bob's RunPod serverless endpoint is accessible by:
1. Probing the endpoint with an auth request
2. Checking for required capabilities (chat, health, etc.)
3. Running every 30 minutes (or on manual trigger)

Without these secrets, it cannot authenticate and fails immediately.

---

**Status**: Applied April 30, 2026 | **Endpoint**: RunPod Serverless (set via `RUNPOD_ENDPOINT_ID` secret)
