# 🧪 Deployment Validation Checklist

## ✅ Quick Validation Steps

Run these commands **in order** to verify your unified vehicle-ingest deployment.

---

## 1️⃣ Clean Up Auto-Injected Secrets

Supabase automatically injects `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` into Edge Functions. Remove any manual copies:

```bash
supabase secrets unset SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY
```

**Verify remaining secrets:**
```bash
supabase secrets list
```

**Expected output (8 secrets):**
```
ALPR_CLOUD_URL
ALPR_CONFIG
ALPR_CONF_THRESHOLD
ALPR_MMC
ALPR_REGIONS
ALPR_TIMEOUT_MS
INFERENCE_SERVICE_URL
PLATE_RECOGNIZER_TOKEN
```

---

## 2️⃣ Validate Railway Inference Service

Test that your ORC inference service is accessible:

```bash
curl -i https://orc-ai-inference-service-production.up.railway.app/health
```

**Expected:**
```
HTTP/2 200
content-type: application/json

{"status":"ok","model":"ready"}
```

**If 404:**
- Check your Railway deployment logs
- Confirm `/health` endpoint exists in `server.js`
- Try root path: `curl https://orc-ai-inference-service-production.up.railway.app/`

---

## 3️⃣ Test CORS Preflight

Verify OPTIONS request handling:

```bash
curl -i -X OPTIONS \
  "https://xbfnlzmpumthnjmtqufp.supabase.co/functions/v1/vehicle-ingest" \
  -H "Origin: https://preview-react-vite-vite-typescript-fvdypijc-d.onspace.build"
```

**Expected headers:**
```
HTTP/1.1 200 OK
Access-Control-Allow-Origin: https://preview-react-vite-vite-typescript-fvdypijc-d.onspace.build
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: authorization, apikey, x-client-info, content-type
Access-Control-Max-Age: 3600
Vary: Origin
```

**If missing CORS headers:**
- Reply with actual headers received
- I'll patch the CORS configuration

---

## 4️⃣ Smoke Test: ALPR Path (JSON)

Test with a **clean, visible plate** photo:

```bash
# Create base64 image (Linux)
IMG_B64=$(base64 -w 0 clean-plate.jpg)

# macOS version:
# IMG_B64=$(base64 -i clean-plate.jpg)

# Test ALPR detection
curl -s -X POST \
  "https://xbfnlzmpumthnjmtqufp.supabase.co/functions/v1/vehicle-ingest" \
  -H "Content-Type: application/json" \
  -d '{
    "image":"data:image/jpeg;base64,'"${IMG_B64}"'",
    "gpsLatitude": -43.5321,
    "gpsLongitude": 172.6362,
    "recordedAt":"2026-02-20T08:20:00.000Z",
    "officerId":"00000000-0000-0000-0000-000000000001",
    "organizationId":"00000000-0000-0000-0000-000000000001",
    "zoneId":"00000000-0000-0000-0000-000000000001",
    "idempotencyKey":"prod-validate:alpr-001"
  }' | jq
```

**Expected response:**
```json
{
  "success": true,
  "path": "alpr",
  "plate": "ABC123",
  "confidence": 0.91,
  "embedding_quality": null
}
```

**Supabase Dashboard → Edge Functions → vehicle-ingest → Logs:**
```
📥 Received scan
📡 ALPR ✅ plate=ABC123 conf=0.91
✅ Ingest complete hasPlate=true hasEmbedding=false
```

---

## 5️⃣ Smoke Test: ORC Fallback (Multipart)

Test with **no plate / dirty plate / night photo**:

```bash
curl -s -X POST \
  "https://xbfnlzmpumthnjmtqufp.supabase.co/functions/v1/vehicle-ingest" \
  -F "photo=@hard-plate.jpg;type=image/jpeg" \
  -F "gpsLatitude=-43.5321" \
  -F "gpsLongitude=172.6362" \
  -F "recordedAt=2026-02-20T08:20:01.000Z" \
  -F "officerId=00000000-0000-0000-0000-000000000001" \
  -F "organizationId=00000000-0000-0000-0000-000000000001" \
  -F "zoneId=00000000-0000-0000-0000-000000000001" \
  -F "idempotencyKey=prod-validate:orc-001" | jq
```

**Expected response:**
```json
{
  "success": true,
  "path": "orc",
  "plate": null,
  "confidence": null,
  "embedding_quality": 0.85
}
```

**Expected logs:**
```
📥 Received scan
⚠️ ALPR ❌ plate=null conf=0.42 threshold=0.78
🤖 ORC fallback triggered
🤖 ORC ✅ dims=384 quality=0.85 version=v1.0.0
✅ Ingest complete hasPlate=false hasEmbedding=true
```

---

## 6️⃣ Config Sanity Check

Current thresholds are optimized for field use:

- ✅ **ALPR_CONF_THRESHOLD="0.78"** - Sweet spot for NZ plates
- ✅ **ALPR_TIMEOUT_MS="15000"** - 15s prevents hanging on slow API
- ✅ **ALPR_MMC="false"** - Faster, single plate detection
- ✅ **ALPR_CONFIG='{"mode":"fast"}'** - Low latency priority

**Adjust if needed:**

```bash
# If too many false positives (95% → ORC)
supabase secrets set ALPR_CONF_THRESHOLD="0.75"

# If ALPR times out frequently
supabase secrets set ALPR_TIMEOUT_MS="20000"

# Redeploy after changes
supabase functions deploy vehicle-ingest
```

---

## 7️⃣ Database Verification

Check that observations are being created:

```sql
SELECT 
  observation_id,
  plate_number,
  plate_confidence,
  vehicle_embedding IS NOT NULL as has_embedding,
  embedding_quality,
  embedding_model_version,
  created_at
FROM vehicle_observations_v2
WHERE created_at > now() - interval '10 minutes'
ORDER BY created_at DESC
LIMIT 5;
```

**Expected:**
- ALPR test: `plate_number='ABC123'`, `has_embedding=false`
- ORC test: `plate_number=null`, `has_embedding=true`, `embedding_quality≈0.85`

---

## 🚨 Troubleshooting Guide

### ❌ **ALPR 401 Unauthorized**
```
❌ ALPR API error 401: Invalid token
```

**Fix:**
```bash
# Get new token from platerecognizer.com
supabase secrets set PLATE_RECOGNIZER_TOKEN="sk_new_token_here"
supabase functions deploy vehicle-ingest
```

---

### ❌ **ORC 502 Bad Gateway**
```
❌ ORC infer failed 502: Bad Gateway
```

**Fix:**
```bash
# Check Railway service status
curl https://orc-ai-inference-service-production.up.railway.app/health

# Check Railway dashboard for deployment errors
# Restart service if needed
```

---

### ❌ **CORS Missing**
```
Access to fetch at '...' from origin '...' has been blocked by CORS policy
```

**Fix:**
1. Copy the actual `Origin` header from browser console
2. Reply with: "CORS error - origin: `<your-origin>`"
3. I'll update the ALLOWED_ORIGINS set

---

### ❌ **Timeout on ALPR**
```
⚠️ ALPR timeout after 15000ms
```

**Fix:**
```bash
# Increase timeout to 20 seconds
supabase secrets set ALPR_TIMEOUT_MS="20000"
supabase functions deploy vehicle-ingest
```

---

### ❌ **Missing Database Columns**
```
ERROR: column "plate_number" does not exist
```

**Fix:**
```sql
-- Run in Supabase SQL Editor
ALTER TABLE vehicle_observations_v2
  ADD COLUMN IF NOT EXISTS plate_number text,
  ADD COLUMN IF NOT EXISTS plate_confidence real;
```

---

## 📊 Success Metrics

After running all tests, you should see:

- ✅ **8 secrets** configured (no SUPABASE_* vars)
- ✅ **Railway /health** returns 200
- ✅ **CORS preflight** returns 200 with correct headers
- ✅ **ALPR path** works (clean plate → `path: "alpr"`)
- ✅ **ORC fallback** works (no plate → `path: "orc"`)
- ✅ **Database records** created with correct columns
- ✅ **Logs show breadcrumbs** (📥📡🤖✅)

---

## 📋 Next Steps

Once all validations pass:

1. ✅ **Update frontend components**
   - Modify `PlateCapture.tsx` to call `vehicle-ingest`
   - Modify `ZoomScan.tsx` to call `vehicle-ingest`
   - Remove old ALPR function calls

2. ✅ **Field pilot testing**
   - 2 officers
   - 1-2 shifts
   - Monitor P95 latency ≤ 3s
   - Target ALPR success rate ≥ 70%
   - Target ORC fallback rate ≤ 30%

3. ✅ **Add pgvector similarity** (optional)
   - Deploy `match_vehicle()` RPC
   - Add "Likely same vehicle" panel in Admin Portal

---

## 🔄 Report Back

Reply with one of:

- ✅ **"All tests passed"** → I'll help with frontend updates
- ⚠️ **"Test X failed: [error message]"** → Paste curl output + logs, I'll fix
- 📊 **"Need to adjust thresholds"** → Describe behavior, I'll recommend settings

---

**Status**: 🧪 Ready for validation testing
