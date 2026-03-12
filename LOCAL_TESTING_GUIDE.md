# Vehicle Ingest - Local Testing Guide

## Prerequisites

1. **Supabase CLI installed**
   ```bash
   npm install -g supabase
   ```

2. **ALPR Token**
   - Get from: https://app.platerecognizer.com/accounts/plan/
   - Copy API token

---

## Setup (One-Time)

### 1. Configure Local Secrets

Edit `supabase/.env.functions.local`:

```bash
PLATE_RECOGNIZER_TOKEN=sk_xxxxx  # Your actual token
```

> **Note:** `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected in local testing and should **not** be set in `.env.functions.local`

### 2. Ensure Database Columns Exist

Run this SQL in Supabase SQL Editor:

```sql
-- Add ALPR columns (if missing)
ALTER TABLE observations
  ADD COLUMN IF NOT EXISTS plate_number text,
  ADD COLUMN IF NOT EXISTS plate_confidence real;

-- Verify all columns exist
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'observations'
  AND column_name IN (
    'plate_number', 
    'plate_confidence', 
    'vehicle_embedding', 
    'embedding_quality', 
    'embedding_model_version', 
    'embedding_created_at'
  )
ORDER BY column_name;
```

Expected result: 6 rows

---

## Local Testing

### 1. Start Function Locally

```bash
supabase functions serve vehicle-ingest \
  --env-file supabase/.env.functions.local \
  --no-verify-jwt
```

**Expected output:**
```
Serving functions on http://127.0.0.1:54321/functions/v1/...
vehicle-ingest: http://127.0.0.1:54321/functions/v1/vehicle-ingest
```

Keep this terminal open!

---

### 2. Test A: JSON Request (Base64)

Open a **new terminal** and run:

```bash
# Create base64 test image
IMG_B64=$(base64 -w 0 sample.jpg)  # Linux
# or
IMG_B64=$(base64 -i sample.jpg)    # macOS

# Test ALPR path (clean plate photo)
curl -s -X POST "http://127.0.0.1:54321/functions/v1/vehicle-ingest" \
  -H "Content-Type: application/json" \
  -d '{
    "image":"data:image/jpeg;base64,'"${IMG_B64}"'",
    "gpsLatitude": -43.5321,
    "gpsLongitude": 172.6362,
    "recordedAt":"2026-02-20T08:20:00.000Z",
    "officerId":"00000000-0000-0000-0000-000000000001",
    "idempotencyKey":"local-device:demo-0001"
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

**Expected logs (in serve terminal):**
```
📥 Received scan
📡 ALPR ✅ plate=ABC123 conf=0.91
✅ Ingest complete hasPlate=true hasEmbedding=false
```

---

### 3. Test B: Multipart Request (File Upload)

```bash
curl -s -X POST "http://127.0.0.1:54321/functions/v1/vehicle-ingest" \
  -F "photo=@sample.jpg;type=image/jpeg" \
  -F "gpsLatitude=-43.5321" \
  -F "gpsLongitude=172.6362" \
  -F "recordedAt=2026-02-20T08:20:00.000Z" \
  -F "officerId=00000000-0000-0000-0000-000000000001" \
  -F "idempotencyKey=local-device:demo-0002" | jq
```

---

### 4. Test C: ORC Fallback (No Plate)

Use a photo with **no visible plate** or **poor lighting**:

```bash
IMG_B64=$(base64 -w 0 dark-no-plate.jpg)

curl -s -X POST "http://127.0.0.1:54321/functions/v1/vehicle-ingest" \
  -H "Content-Type: application/json" \
  -d '{
    "image":"data:image/jpeg;base64,'"${IMG_B64}"'",
    "gpsLatitude": -43.5321,
    "gpsLongitude": 172.6362,
    "recordedAt":"2026-02-20T08:20:00.000Z",
    "officerId":"00000000-0000-0000-0000-000000000001",
    "idempotencyKey":"local-device:demo-0003"
  }' | jq
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

### 5. Test D: CORS Preflight

```bash
curl -i -X OPTIONS "http://127.0.0.1:54321/functions/v1/vehicle-ingest" \
  -H "Origin: http://localhost:5173"
```

**Expected headers:**
```
HTTP/1.1 200 OK
Access-Control-Allow-Origin: http://localhost:5173
Access-Control-Allow-Methods: POST, OPTIONS
```

---

## Verification Checklist

- [ ] ALPR path works (clean plate → `path: "alpr"`)
- [ ] ORC fallback works (no plate → `path: "orc"`)
- [ ] CORS preflight returns 200
- [ ] Logs show breadcrumbs (📥📡🤖✅)
- [ ] Both JSON and multipart requests work

---

## Troubleshooting

### "PLATE_RECOGNIZER_TOKEN not configured"
→ Check `.env.functions.local` has correct token

### "ALPR API error 401"
→ Token invalid, get new one from platerecognizer.com

### "ORC infer failed 502"
→ Railway service might be asleep, try again in 10s

### "Missing image data"
→ Check base64 encoding has correct prefix: `data:image/jpeg;base64,`

### CORS error from browser
→ Add your frontend origin to `ALLOWED_ORIGINS` in `vehicle-ingest/index.ts`

---

## Production Deployment

Once all tests pass:

```bash
# Set production secrets (SUPABASE_* vars are auto-injected)
supabase secrets set \
  PLATE_RECOGNIZER_TOKEN="sk_xxxxx" \
  ALPR_CLOUD_URL="https://api.platerecognizer.com/v1/plate-reader/" \
  ALPR_REGIONS="nz" \
  ALPR_MMC="false" \
  ALPR_CONFIG='{"mode":"fast"}' \
  ALPR_TIMEOUT_MS="15000" \
  ALPR_CONF_THRESHOLD="0.78" \
  INFERENCE_SERVICE_URL="https://orc-ai-inference-service-production.up.railway.app"

# Deploy function
supabase functions deploy vehicle-ingest

# Test production
curl -i -X OPTIONS \
  "https://xbfnlzmpumthnjmtqufp.supabase.co/functions/v1/vehicle-ingest"
```

---

## Next Steps

After successful local testing and production deployment:

1. **Update frontend components** (PlateCapture.tsx, ZoomScan.tsx)
2. **Add vehicle similarity UI** (top-k matches via pgvector)
3. **Field pilot** (2 officers, 1-2 shifts)
4. **Monitor metrics** (ALPR hit rate, ORC fallback rate, latency)

---

**Status**: ✅ Ready for local testing
