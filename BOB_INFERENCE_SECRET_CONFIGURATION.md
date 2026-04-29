# Bob Inference Service - Supabase Secret Configuration

**Date:** 2026-04-15
**Status:** Required action

## Problem

The **AI Feedback Chat** in Bob Assistant Studio shows:

> "Bob is online, but the upstream inference provider is currently unavailable. I can still help with operational triage..."

This happens because the Supabase edge function `onspace-ai-chat` cannot reach the Bob inference service at Railway.

## Root Cause

The Supabase edge function secrets are **missing the INFERENCE_SERVICE_URL** variable. Without this, the edge function doesn't know where to find Bob's /chat endpoint.

### Current Deployment State

| Component | Status | URL | Notes |
|---|---|---|---|
| **Bob Inference Service** | ✅ Running | `https://focused-courage-production-ccee.up.railway.app` | Railway; operates in build-training mode |
| **Ollama LLM** | ✅ Running | `http://ollama.railway.internal:8080` | Private Railway network; port is 8080 (not 11434) |
| **Supabase Edge Function** | ⚠️ Misconfigured | `onspace-ai-chat` | Missing secrets pointing to Bob service |

### Evidence

1. **Bob health check is green:**
   ```json
   {
     "status": "healthy",
     "config": {
       "OPERATING_MODE": "build-training",
       "CHAT_PROVIDER": "ollama",
       "OLLAMA_BASE_URL": "http://ollama.railway.internal:8080",
       "OLLAMA_BASE_URL_CONFIGURED": true
     },
     "capabilities": {
       "chat_local_ollama_enabled": true,
       "chat": true
     },
     "circuit_breaker": {
       "state": "closed"
     }
   }
   ```

2. **Edge function logs show** (inferred from UI message):
   ```
   All provider attempts failed:
   - inference: INFERENCE_SERVICE_URL not configured
   - ollama: OLLAMA_BASE_URL not configured
   ```

## Solution

### Step 1: Access Supabase Edge Function Secrets

Go to: https://app.supabase.com/project/mfqfqqewfpdxqmqnzrvi/functions/secrets

### Step 2: Add or Update Secrets

Click **"New secret"** for each of these:

#### Secret 1: INFERENCE_SERVICE_URL (Required)

| Field | Value |
|---|---|
| **Name** | `INFERENCE_SERVICE_URL` |
| **Value** | `https://focused-courage-production-ccee.up.railway.app` |

**Why this secret?**
- Tells `onspace-ai-chat` edge function where to POST `/chat` requests
- Must be a public HTTPS URL reachable from Supabase's servers
- Current Bob Railway service is at this URL (verified via health endpoint)

#### Secret 2: OLLAMA_BASE_URL (Recommended)

| Field | Value |
|---|---|
| **Name** | `OLLAMA_BASE_URL` |
| **Value** | `http://ollama.railway.internal:8080` |

**Why this secret?**
- Provides fallback if inference service is down
- Uses Railway's **private internal network** (`*.railway.internal` hostnames)
- Port **8080** (not 11434 as old docs state — check Bob's live health output)

#### Secret 3: INFERENCE_API_KEY (Optional but Recommended)

| Field | Value |
|---|---|
| **Name** | `INFERENCE_API_KEY` |
| **Value** | `<same value as on Bob service>` |

**Why this secret?**
- Authenticates requests to Bob /chat endpoint
- Bob expects `x-inference-api-key` header
- Prevents unauthorized callers
- Find the actual value in Railway → Bob service → Variables

### Step 3: Verify Secrets Are Saved

After entering each secret:
- Click the `+` button to add it
- Confirm it appears in the list
- All three secrets should show as "Added"

### Step 4: Edge Functions Auto-Redeploy

Once saved, Supabase automatically redeploys all edge functions with the new secrets. This takes ~30 seconds.

**No manual redeploy needed** — the environment variables are injected at function startup.

## Verification

After setting secrets, test the AI Feedback Chat:

1. Open Bob Assistant Studio
2. Go to **Conversation** tab
3. Type: `test: is the inference provider working?`
4. **Expected behavior:**
   - Bob responds with a question asking for more context
   - No more "currently unavailable" message
   - Chat continues normally for 3–5 back-and-forths until Bob collects structured intake data

## Old Documentation Discrepancy

**Note:** Some docs reference `OLLAMA_BASE_URL=http://ollama.railway.internal:11434`

This is outdated. The current Ollama service is configured with `OLLAMA_HOST=0.0.0.0:8080`, making the internal URL:
- **Old (outdated):** `http://ollama.railway.internal:11434`
- **Current (correct):** `http://ollama.railway.internal:8080`

Verify the correct port by checking:
```bash
curl -s https://focused-courage-production-ccee.up.railway.app/health | jq '.config.OLLAMA_BASE_URL'
# Output: "http://ollama.railway.internal:8080"
```

## If Secrets Are Already Set

If INFERENCE_SERVICE_URL and OLLAMA_BASE_URL are already in Supabase secrets but Bob still says "currently unavailable," check:

1. **Network connectivity:**
   - Can Supabase reach `https://focused-courage-production-ccee.up.railway.app`?
   - Test from local terminal: `curl -s https://focused-courage-production-ccee.up.railway.app/health`

2. **Auth headers:**
   - Is INFERENCE_API_KEY correct?
   - Does it match the value on Bob service in Railway?

3. **Edge function logs:**
   - Check Supabase Dashboard → Functions → onspace-ai-chat → Invocations
   - Look for error messages in `diagnostics` field of responses

## Related Documentation

- [docs/BOB_PRODUCTION_RAILWAY_SETUP.md](docs/BOB_PRODUCTION_RAILWAY_SETUP.md) — Bob deployment details
- [docs/RAILWAY_SERVICES_AUTHORITY.md](docs/RAILWAY_SERVICES_AUTHORITY.md) — authoritative service registry
- [supabase/functions/onspace-ai-chat/index.ts](supabase/functions/onspace-ai-chat/index.ts) — edge function source code

## Next Steps

1. ✅ Set INFERENCE_SERVICE_URL in Supabase secrets
2. ✅ Set OLLAMA_BASE_URL in Supabase secrets
3. ⏳ Wait ~30 seconds for redeploy
4. ⏳ Test AI Feedback Chat integration
5. ⏳ Verify Bob responds to natural language queries

---

**Created:** 2026-04-15  
**Last Updated:** 2026-04-15
