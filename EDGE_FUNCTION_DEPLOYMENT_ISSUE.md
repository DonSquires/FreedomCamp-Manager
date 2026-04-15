# Edge Function Deployment Issue - onspace-ai-chat Not Reachable

**Date:** 2026-04-15
**Status:** Network-level failure - edge function not responding to browser requests

## Problem

When users try to use **AI Feedback Chat** or other features calling `onspace-ai-chat` edge function, they get:

> "⚠️ Unable to reach the Edge Function. The function may not be deployed, or there may be a network connectivity issue."

This error (`FunctionsFetchError` / `FunctionsRelayError`) indicates the HTTP request to the edge function itself is failing - not that the function is misconfigured.

## Root Cause Analysis

The error comes from `src/lib/edgeFunctions.ts` when `supabase.functions.invoke()` fails to POST to:
```
https://{SUPABASE_URL}/functions/v1/onspace-ai-chat
```

### Possible Causes (in order of likelihood)

1. **Edge function is not deployed to Supabase** → Most likely
   - Functions must be explicitly deployed to Supabase
   - Not deployed: only live in local repository
   - Solution: Push to Supabase via CLI or Git

2. **CORS preflight rejection** → If function exists but CORS headers are wrong
   - Browser sends OPTIONS; function should respond with CORS headers
   - Function DOES have OPTIONS handler in code (line 240), so this shouldn't be it

3. **Supabase project misconfiguration** → If credentials are wrong
   - Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
   - Should point to active Supabase project

4. **Recent code change broke the function** → Unlikely but possible
   - Latest commit to function: ae51a87f (minor provider preference change)
   - No syntax errors detected

## Verification

### Test 1: Check if other edge functions work

Try another edge function that should be deployed:
```bash
# From browser console
await fetch('https://mfqfqqewfpdxqmqnzrvi.supabase.co/functions/v1/check-railway-health', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer <your-anon-key>' },
  body: JSON.stringify({})
}).then(r => r.json()).then(console.log)
```

If this returns a response: other functions ARE deployed, so the issue is specific to onspace-ai-chat.
If this fails: NO functions are deployed.

### Test 2: Check Supabase dashboard

Go to: https://app.supabase.com/project/mfqfqqewfpdxqmqnzrvi/functions

Look for:
- Is `onspace-ai-chat` listed?
- Does it show "Deployed"?
- Are there any error messages in Function details?

## Solution

### Step 1: Deploy Edge Functions to Supabase

**Option A: Using Supabase CLI (if you have it)**
```bash
cd /workspaces/FreedomCamp-Manager
supabase functions deploy onspace-ai-chat
```

**Option B: Using Git-based deployment**
- Supabase auto-deploys functions when you push to the connected GitHub repo
- Check: https://app.supabase.com/project/mfqfqqewfpdxqmqnzrvi/settings/general
- Under "Connected repository", should show DonSquires/FreedomCamp-Manager
- Trigger redeploy by pushing to main

**Option C: Manual push via Supabase dashboard**
- Go to: https://app.supabase.com/project/mfqfqqewfpdxqmqnzrvi/functions
- Click "+ Create a new function"
- Upload `supabase/functions/onspace-ai-chat/index.ts` directly
- This is NOT recommended for production (use Git-based deployment instead)

### Step 2: Verify Deployment

After deploying, wait ~30-60 seconds for the function to be available.

Then test:
1. Go to Bob Assistant Studio on the app
2. Open "Send Feedback" form
3. Type a message (e.g., "test")
4. Expected: Bob responds with questions (no more "Unable to reach" error)

### Step 3: Enable Secrets (from previous fix)

Once the function is reachable, also make sure you've set these secrets
(from `BOB_INFERENCE_SECRET_CONFIGURATION.md`):
- `INFERENCE_SERVICE_URL = https://focused-courage-production-ccee.up.railway.app`
- `OLLAMA_BASE_URL = http://ollama.railway.internal:8080`  
- `INFERENCE_API_KEY = <Bob service API key>`

## How to Check Git-Based Deployment Status

If using GitHub → Supabase auto-deploy:

1. Push to main (functions are in `supabase/functions/`)
2. Check GitHub Actions: https://github.com/DonSquires/FreedomCamp-Manager/actions
   - Look for "Deploy" workflow runs
   - Should run automatically when `supabase/functions/` changes

3. Check Supabase dashboard for deployment status
   - https://app.supabase.com/project/mfqfqqewfpdxqmqnzrvi/functions

## Relevant Documentation

- [docs/DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md) — Supabase setup instructions
- [AI_SERVICE_DEPLOYMENT_FINAL_STEPS.md](AI_SERVICE_DEPLOYMENT_FINAL_STEPS.md) — Final deployment checklist
- [supabase/functions/onspace-ai-chat/index.ts](supabase/functions/onspace-ai-chat/index.ts) — Function source code

## Related Issues

This is different from the [Bob inference provider issue](BOB_INFERENCE_SECRET_CONFIGURATION.md), which was about missing Supabase secrets. This issue is about the edge function itself not being deployed.

**Two-part fix required:**
1. ✅ **First**: Deploy the edge function (this doc) ← **BLOCKING ISSUE**
2. ✅ **Then**: Set inference provider secrets (BOB_INFERENCE_SECRET_CONFIGURATION.md)

---

**Diagnosed:** 2026-04-15
**Status:** Awaiting edge function deployment
