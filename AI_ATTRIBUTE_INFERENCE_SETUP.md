# AI Vehicle Attribute Inference Setup Guide

This guide walks you through enabling AI-based vehicle attribute inference (make, model, year, color) in the FreedomCamp Manager system using OpenAI's GPT-4o vision API.

## Current Status

- **Inference Service Location**: Binary built in Railway (Node.js runtime running `inference-service/server.js`)
- **Default Mode**: `basic` — Uses dominant color estimation only (safe, no API costs)
- **Available Mode**: `openai` — Calls GPT-4o vision API for full vehicle attributes

## Step 1: Obtain OpenAI API Key

1. Visit [OpenAI API Keys dashboard](https://platform.openai.com/api/keys)
2. Create a new secret key with `gpt-4-vision` permissions
3. Copy the key (you'll need it in Step 3)

**Note**: This will incur charges (~$0.02 per inference for gpt-4o-mini, ~$0.07 for gpt-4o). Budget ~$5/month for testing.

## Step 2: Access Railway Dashboard

The inference service is deployed on Railway. You need to:

1. Log in to [Railway Dashboard](https://railway.app)
2. Navigate to the FreedomCamp project
3. Find the **inference-service** plugin/service

## Step 3: Set Environment Variables in Railway

Update the following environment variables in the inference service:

| Variable | Value | Notes |
|----------|-------|-------|
| `VEHICLE_ATTRS_PROVIDER` | `openai` | Or `basic` to disable (default) |
| `OPENAI_API_KEY` | `sk-...` | Your secret key from Step 1 |
| `OPENAI_MODEL` | `gpt-4o-mini` | Recommended (cost-effective); use `gpt-4o` for higher accuracy |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Usually no change needed |
| `ATTR_TIMEOUT_MS` | `2500` | Max wait time for AI inference (milliseconds) |

### How to Set Environment Variables in Railway

**Option A: Via Railway Dashboard (Recommended)**
1. Open inference-service settings
2. Click "Environment" tab
3. Add each variable as a separate entry
4. Click "Deploy" to apply changes

**Option B: Via Railway CLI**
```bash
railway env add VEHICLE_ATTRS_PROVIDER openai
railway env add OPENAI_API_KEY sk-YOUR_KEY_HERE
railway env add OPENAI_MODEL gpt-4o-mini
railway env add OPENAI_BASE_URL https://api.openai.com/v1
railway env add ATTR_TIMEOUT_MS 2500
railway up  # Redeploy with new env vars
```

## Step 4: Verify Deployment

After setting environment variables, Railway will automatically redeploy the inference service.

To confirm it's working:

1. Log into [FreedomCamp admin panel](https://app.freedomcamp.local)
2. Go to field officer portal
3. Capture a test vehicle photo
4. Wait for processing to complete (~5 sec)
5. Check the observation details — you should see:
   - `vehicle_make`, `vehicle_model`, `vehicle_year`, `vehicle_colour` fields populated
   - Source attribution showing `AI Detection` for attributes

## Step 5: Understanding Source Priority

When multiple sources provide vehicle attributes, the system uses this priority order:

### For Visual Attributes (make, model, year, color):
$$\text{Inference (HIGH confidence)} \gg \text{Canonical} \gg \text{NZSCV} \gg \text{Inference (low)} \gg \text{ALPR}$$

**Rationale**: The inference service (GPT-4o vision) can actually **see the vehicle in the photo**, making it more reliable for visual attributes than external registries.

- **Inference (high confidence)**: AI vision with confidence ≥ threshold (Make: 72%, Model: 68%, Color: 60%) — **HIGHEST PRIORITY**
- **Canonical**: Internal database (vehicle previously verified in zone) — used if inference is not confident enough
- **NZSCV**: Registry enrichment (optional attributes) — may be stale or incorrect for visual data
- **Inference (low confidence)**: AI vision with confidence below threshold — fallback
- **ALPR**: Plate Recognizer — last resort
- **null**: No data available

### For SC Certification (self_contained, self_contained_expiry):
$$\text{NZSCV} \text{ (authorities)}$$

NZSCV always has priority for certification status — the register is the sole authoritative source.

### Example

```
Vehicle: Toyota HiAce (actually white) — first observation

Scan results:
- Inference (GPT-4o): Color "White" (confidence 91%), Make "Toyota" (88%), Model "HiAce" (76%)
- Canonical: Empty (new in zone)
- NZSCV: Make "Toyota", Model "HiAce", Color "Black" (stale registry data)
- ALPR: Color "White" (85%)

Resolution:
- Make: "Toyota" (inference 88% ≥ 72% threshold) ✅ **Inference used (high confidence)**
- Model: "HiAce" (inference 76% ≥ 68% threshold) ✅ **Inference used (high confidence)**
- **Color: "White"** (inference 91% ≥ 60% threshold) — overrides stale NZSCV "Black" ✅ **Inference used (high confidence)**
- SC Status: From NZSCV register (if vehicle registered with SC warrant)
```

## Step 6: Monitor API Usage

### Checking OpenAI Costs

1. Visit [OpenAI Billing](https://platform.openai.com/account/billing/overview)
2. View monthly usage and costs
3. Set spending limits if desired

### Inference Service Logs

In Railway:
1. Open inference-service → Logs tab
2. Filter for `attribute` or `inference` to see AI call details
3. Check response times (should be <2500ms)

## Step 7: Troubleshooting

### Attributes Still Showing `null`

**Check 1**: Verify `VEHICLE_ATTRS_PROVIDER` is set to `openai`
```bash
railway env  # List all env vars
```

**Check 2**: Confirm OPENAI_API_KEY is valid
- Test key: `curl https://api.openai.com/v1/models -H "Authorization: Bearer sk-YOUR_KEY"`
- Should return a 200 with model list, not 401

**Check 3**: Check inference service logs for errors
- Look for `Error calling OpenAI` or timeout messages
- If timeout, increase `ATTR_TIMEOUT_MS` (but not > 5000)

### API Key Rejected (401)

- Confirm key starts with `sk-`
- Verify key has `gpt-4-vision` scope enabled
- Check for accidental spaces/newlines in the key value
- Try regenerating a new key

### Slow Inference (>3 sec)

- Use `gpt-4o-mini` instead of `gpt-4o` (faster + cheaper)
- Increase `ATTR_TIMEOUT_MS` to 4000 to allow more time
- Check Railway CPU usage — may indicate resource constraints

### Attributes Not Appearing in UI

- Confirm migration `20260417000001_add_vehicle_attribute_sources.sql` has been deployed to Supabase
- Check that observations table has `vehicle_attribute_sources` column:
  ```sql
  SELECT column_name FROM information_schema.columns 
  WHERE table_name='observations' AND column_name='vehicle_attribute_sources';
  ```
- If missing, manually run the migration in Supabase SQL editor

## Step 8: Disable AI Inference (If Needed)

To revert to basic mode (dominant color only):

1. In Railway dashboard, set `VEHICLE_ATTRS_PROVIDER = basic`
2. Or delete the `OPENAI_API_KEY` variable entirely
3. Redeploy

This immediately stops all API calls to OpenAI and incurs zero cost.

## Cost Estimation

| Mode | Cost per Scan | Monthly (100 scans/day) |
|------|---------------|------------------------|
| `basic` | $0 | $0 |
| `openai` (gpt-4o-mini) | ~$0.02 | ~$60 |
| `openai` (gpt-4o) | ~$0.07 | ~$210 |

**Recommendation**: Start with `gpt-4o-mini` for 1-2 weeks to validate accuracy, then switch to `basic` or `openai` depending on business need.

## Next Steps

- [Test ALPR Integration](./ALPR_TESTING_CHECKLIST.md) — Verify number plate recognizer attributes flow
- [View Source Attribution in UI](#Step 7) — Officers see where each attribute came from
- [Monitor System Health](./SYSTEM_MONITORING.md) — Track inference latency and API usage

---

**Support**: For Railway deployment issues, contact Railway support. For OpenAI API issues, see [OpenAI docs](https://platform.openai.com/docs).
