# AI Service Configuration Guide

This guide explains how to configure AI services for FieldOps Manager using a self-contained inference-service-only policy.

## Bob Operating Modes

Bob now supports two explicit operating profiles:

| Mode | Env | Purpose |
|---|---|---|
| `self-contained` | `BOB_OPERATING_MODE=self-contained` | Locked-down production posture. Non-local outbound egress is blocked. |
| `build-training` | `BOB_OPERATING_MODE=build-training` | Internet-enabled mode for build, training, external research, and upstream model access. |

If `BOB_OPERATING_MODE` is not set, the inference service falls back to the legacy `SELF_CONTAINED_MODE` flags.

## Quick Fix for "AI service not connecting"

The most common cause of this error is missing Supabase Edge Function secrets.

### Option 1: Use the Configuration Script

```bash
# Make sure you have Supabase CLI installed
brew install supabase/tap/supabase

# Login to Supabase
supabase login

# Run the configuration script
./scripts/configure-ai-secrets.sh
```

### Option 2: Manual Configuration

Go to Supabase Dashboard → Edge Functions → Manage Secrets and add:

| Secret | Value | Required |
|--------|-------|----------|
| `INFERENCE_SERVICE_URL` | Bob's RunPod service URL | Yes |
| `INFERENCE_API_KEY` | Shared secret for inference-service auth | Recommended |
| `PROXY_SERVER_URL` | Railway proxy URL | For NZSCV lookups |

For Bob service environment variables (set in RunPod pod `.env`):

| Variable | Value |
|---|---|
| `BOB_OPERATING_MODE` | `build-training` |
| `CHAT_PROVIDER` | `ollama` or `openai` |
| `TABULAR_NLP_PROVIDER` | `ollama` or `openai` |
| `OLLAMA_BASE_URL` | External or internal Ollama URL |
| `OPENAI_API_KEY` | Required if using `openai` providers |
| `ALLOW_OPENAI_RUNTIME` | `true` to allow OpenAI runtime calls for approved purposes |
| `OPENAI_ALLOWED_PURPOSES` | `research,training` (policy allowlist) |
| `OPENAI_REFERENCE_GATE_ENABLED` | Keep `true` to enforce policy gate |
| `ALLOW_OPENAI_REFERENCE_PROVIDER` | `false` by default (use purpose-gated access instead) |

### OpenAI Through Bob Policy (Training/Research Only)

OpenAI calls are policy-gated in the RunPod worker. To use OpenAI through Bob:

1. Keep `OPENAI_REFERENCE_GATE_ENABLED=true`
2. Set `ALLOW_OPENAI_RUNTIME=true`
3. Set `OPENAI_ALLOWED_PURPOSES=research,training`
4. Provide `OPENAI_API_KEY`
5. Include `openai_purpose` in request payload (`research` or `training`)

Example payload:

```json
{
  "input": {
    "action": "chat",
    "provider": "openai",
    "model": "gpt-4o-mini",
    "openai_purpose": "research",
    "message": "Summarize latest training outcomes"
  }
}
```

## Required Secrets by Feature

### AI Chat + Self-Healing Bug Analysis

AI chat and bug self-healing run through Supabase Edge Functions and inference-service.
No external cloud AI provider secrets are required under this policy.

### Vehicle Inference (ALPR, Face Recognition)

| Secret | Purpose |
|--------|---------|
| `INFERENCE_SERVICE_URL` | Bob inference service URL (RunPod) for YOLO/MobileNet models |
| `INFERENCE_API_KEY` | Optional API key for inference service auth |

### NZSCV Self-Contained Vehicle Lookups

| Secret | Purpose |
|--------|---------|
| `PROXY_SERVER_URL` or `NZSCV_PROXY_URL` | Railway proxy server URL (NZSCV/MotorWeb) |
| `NZSCV_PROXY_SECRET` | Shared secret for proxy authentication |

## Verifying Configuration

### Check from System Diagnostics

1. Login as a master user
2. Go to System Diagnostics page
3. Check the "Inference Service" and "Proxy Server" status cards
4. Both should show "Online" with green badges

### Check from CLI

```bash
# List all configured secrets
supabase secrets list --project-ref kxwjcupuxnnbnzcgmkoi

# Test the health endpoint
curl https://kxwjcupuxnnbnzcgmkoi.supabase.co/functions/v1/check-services-health
```

### Expected Response

```json
{
  "proxy": { "status": "online" },
  "proxy_url": "https://...",
  "inference": { "status": "online" },
  "inference_url": "https://api.runpod.ai/v2/<RUNPOD_ENDPOINT_ID>/runsync",
  "inference_api_key_configured": true,
  "checked_at": "2026-03-31T..."
}
```

## Troubleshooting

### "AI chat request timed out"

**Cause**: Inference service unreachable or auth mismatch.

**Fix**:
1. Verify `INFERENCE_SERVICE_URL` is configured.
2. Verify `INFERENCE_API_KEY` matches the inference-service deployment.
3. Check inference-service `/health` endpoint.
4. Confirm `config.OPERATING_MODE` in `/health` matches the intended posture.

### "Unauthorized inference request" while Bob is in build/training mode

**Cause**: The Bob service is still running in `self-contained` mode, so Supabase JWKS auth and external upstream access remain blocked.

**Fix**:
1. Set `BOB_OPERATING_MODE=build-training` on the Bob service (RunPod pod `.env`).
2. Redeploy the Bob service.
3. Re-check `/health` and confirm:
  - `config.OPERATING_MODE = build-training`
  - `config.SUPABASE_JWT_RUNTIME_ENABLED = true`
  - `config.EXTERNAL_EGRESS_ALLOWED = true`

See [docs/BOB_SYSTEM_REVIEW.md](BOB_SYSTEM_REVIEW.md) for the current consolidation plan.

### "INFERENCE_SERVICE_URL not configured"

**Cause**: The Bob inference service URL is not set

**Fix**: Add `INFERENCE_SERVICE_URL` secret with Bob's RunPod service URL

### "Inference service offline" but RunPod is healthy

**Cause**: `INFERENCE_SERVICE_URL` is missing the protocol (for example `https://`).

**Fix**:
1. Set a full URL value such as `https://api.runpod.ai/v2/<RUNPOD_ENDPOINT_ID>/runsync`.
2. Redeploy affected edge functions after secret changes.

### Auto bug analysis returns 401 Invalid JWT

**Cause**: The `auto-analyse-report` deployment/config is out of sync with current auth settings.

**Fix**:
1. Redeploy `auto-analyse-report` from the latest repository code.
2. Confirm request includes `Authorization: Bearer <supabase-access-token>` and `apikey` headers.
3. Re-test with a known valid report id.

### Services show "Offline" in System Diagnostics

1. Check that the Bob service (RunPod) and Proxy (Railway) are running
2. Verify the URLs are correct in the secrets
3. Check RunPod dashboard / Railway dashboard for service health

## Architecture Overview

```
┌─────────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│  Browser/UI         │────▶│ Supabase Edge        │────▶│ RunPod / Railway│
│  - FaceRecognition  │     │ Functions            │     │ - Bob inference │
│  - PlateScanner     │     │ - onspace-ai-chat    │     │ - proxy         │
│  - AIChat           │     │ - process-face-scan  │     │                 │
└─────────────────────┘     │ - vehicle-ingest     │     └─────────────────┘
                            └──────────────────────┘
```

**Key point**: Browser cannot call Bob or the proxy directly (CORS). All calls go through Edge Functions.
