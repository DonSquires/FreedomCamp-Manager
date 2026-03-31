# AI Service Configuration Guide

This guide explains how to configure the AI services for FreedomCamp Manager.

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
| `GITHUB_TOKEN` | GitHub PAT with `copilot` scope | For AI chat |
| `OPENAI_API_KEY` | OpenAI API key | Alternative to GITHUB_TOKEN |
| `PROXY_SERVER_URL` | Railway proxy URL | For NZSCV lookups |

## Required Secrets by Feature

### AI Chat (Field Officer Portal)

The AI chat feature in the Field Officer Portal requires one of:

1. **GITHUB_TOKEN** (recommended) - GitHub Personal Access Token with `copilot` scope
   - Go to https://github.com/settings/tokens/new
   - Name: "FreedomCamp AI"
   - Select scope: `copilot`
   - Generate and copy the token

2. **OPENAI_API_KEY** - OpenAI API key
   - Go to https://platform.openai.com/api-keys
   - Create new key
   - Copy the key (starts with `sk-`)

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

### "AI chat request timed out after 25s"

**Cause**: No AI provider configured (missing GITHUB_TOKEN or OPENAI_API_KEY)

**Fix**: Add one of these secrets to Supabase Edge Functions

### "INFERENCE_SERVICE_URL not configured"

**Cause**: The Railway inference service URL is not set

**Fix**: Add `INFERENCE_SERVICE_URL` secret with the Railway service URL

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
