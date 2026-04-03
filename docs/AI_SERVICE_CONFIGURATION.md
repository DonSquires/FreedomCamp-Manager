# AI Service Configuration Guide

This guide explains how to configure AI services for FieldOps Manager using a self-contained inference-service-only policy.

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
| `INFERENCE_SERVICE_URL` | `https://orc-ai-inference-service-production.up.railway.app` | Yes |
| `INFERENCE_API_KEY` | Shared secret for inference-service auth | Recommended |
| `PROXY_SERVER_URL` | Railway proxy URL | For NZSCV lookups |

## Required Secrets by Feature

### AI Chat + Self-Healing Bug Analysis

AI chat and bug self-healing run through Supabase Edge Functions and inference-service.
No external cloud AI provider secrets are required under this policy.

### Vehicle Inference (ALPR, Face Recognition)

| Secret | Purpose |
|--------|---------|
| `INFERENCE_SERVICE_URL` | Railway inference service URL for YOLO/MobileNet models |
| `INFERENCE_API_KEY` | Optional API key for inference service auth |

### NZSCV Self-Contained Vehicle Lookups

| Secret | Purpose |
|--------|---------|
| `PROXY_SERVER_URL` or `NZSCV_PROXY_URL` | Railway proxy server URL |
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
curl https://kxwjcupuxnnbnzcgmkoi.supabase.co/functions/v1/check-railway-health
```

### Expected Response

```json
{
  "proxy": { "status": "online" },
  "proxy_url": "https://...",
  "inference": { "status": "online" },
  "inference_url": "https://orc-ai-inference-service-production.up.railway.app",
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

### "INFERENCE_SERVICE_URL not configured"

**Cause**: The Railway inference service URL is not set

**Fix**: Add `INFERENCE_SERVICE_URL` secret with the Railway service URL

### "Inference service offline" but Railway is healthy

**Cause**: `INFERENCE_SERVICE_URL` is missing the protocol (for example `https://`).

**Fix**:
1. Set a full URL value such as `https://orc-ai-inference-service-production.up.railway.app`.
2. Redeploy affected edge functions after secret changes.

### Auto bug analysis returns 401 Invalid JWT

**Cause**: The `auto-analyse-report` deployment/config is out of sync with current auth settings.

**Fix**:
1. Redeploy `auto-analyse-report` from the latest repository code.
2. Confirm request includes `Authorization: Bearer <supabase-access-token>` and `apikey` headers.
3. Re-test with a known valid report id.

### Services show "Offline" in System Diagnostics

1. Check that the Railway services are running
2. Verify the URLs are correct in the secrets
3. Check Railway dashboard for service health

## Architecture Overview

```
┌─────────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│  Browser/UI         │────▶│ Supabase Edge        │────▶│ Railway         │
│  - FaceRecognition  │     │ Functions            │     │ - inference     │
│  - PlateScanner     │     │ - check-railway      │     │ - proxy         │
│  - AIChat           │     │ - process-face-scan  │     │                 │
└─────────────────────┘     │ - onspace-ai-chat    │     └─────────────────┘
                            │ - vehicle-ingest     │
                            └──────────────────────┘
```

**Key point**: Browser cannot call Railway directly (CORS). All calls go through Edge Functions.
