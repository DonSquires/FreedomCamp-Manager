# Production Deployment - Unified Vehicle Ingest

## ✅ Pre-Deployment Checklist

- [x] Database columns verified (plate_number, plate_confidence, vehicle_embedding)
- [x] Performance indexes added (idempotency_key, plate_number)
- [x] ALPR helper created (_shared/alpr.ts)
- [x] ORC integration ready (Railway inference service)
- [x] CORS configured with preview URL
- [x] Local testing guide created

## 🚀 Deployment Steps

### 1. Configure Production Secrets

```bash
supabase secrets set \
  PLATE_RECOGNIZER_TOKEN="YOUR-TOKEN-HERE" \
  ALPR_CLOUD_URL="https://api.platerecognizer.com/v1/plate-reader/" \
  ALPR_REGIONS="nz" \
  ALPR_MMC="false" \
  ALPR_CONFIG='{"mode":"fast"}' \
  ALPR_TIMEOUT_MS="15000" \
  ALPR_CONF_THRESHOLD="0.78" \
  INFERENCE_SERVICE_URL="https://orc-ai-inference-service-production.up.railway.app" \
  SUPABASE_URL="https://xbfnlzmpumthnjmtqufp.supabase.co" \
  SUPABASE_SERVICE_ROLE_KEY="YOUR-SERVICE-ROLE-KEY"
```

### 2. Verify Secrets

```bash
supabase secrets list
```

Expected output:
```
PLATE_RECOGNIZER_TOKEN
ALPR_CLOUD_URL
ALPR_REGIONS
ALPR_MMC
ALPR_CONFIG
ALPR_TIMEOUT_MS
ALPR_CONF_THRESHOLD
INFERENCE_SERVICE_URL
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

### 3. Deploy Edge Function

```bash
supabase functions deploy vehicle-ingest
```

---

## 🧪 Post-Deployment Verification

### Test 1: CORS Preflight

```bash
curl -i -X OPTIONS \
  "https://xbfnlzmpumthnjmtqufp.supabase.co/functions/v1/vehicle-ingest"
```

**Expected:**
```
HTTP/1.1 200 OK
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: authorization, apikey, x-client-info, content-type
```

### Test 2: ALPR Path (Clean Plate Photo)

```bash
# Create test image base64
IMG_B64=$(base64 -w 0 test-clean-plate.jpg)

# Test endpoint
curl -s -X POST \
  "https://xbfnlzmpumthnjmtqufp.supabase.co/functions/v1/vehicle-ingest" \
  -H "Content-Type: application/json" \
  -d '{
    "image":"data:image/jpeg;base64,'"${IMG_B64}"'",
    "gpsLatitude": -43.5321,
    "gpsLongitude": 172.6362,
    "recordedAt":"2026-02-20T08:20:00.000Z",
    "officerId":"00000000-0000-0000-0000-000000000001",
    "idempotencyKey":"prod-test:alpr-001"
  }' | jq
```

**Expected:**
```json
{
  "success": true,
  "path": "alpr",
  "plate": "ABC123",
  "confidence": 0.91,
  "embedding_quality": null
}
```

### Test 3: ORC Fallback (No Plate / Poor Quality)

```bash
IMG_B64=$(base64 -w 0 test-no-plate.jpg)

curl -s -X POST \
  "https://xbfnlzmpumthnjmtqufp.supabase.co/functions/v1/vehicle-ingest" \
  -F "photo=@test-no-plate.jpg;type=image/jpeg" \
  -F "gpsLatitude=-43.5321" \
  -F "gpsLongitude=172.6362" \
  -F "recordedAt=2026-02-20T08:20:01.000Z" \
  -F "officerId=00000000-0000-0000-0000-000000000001" \
  -F "idempotencyKey=prod-test:orc-001" | jq
```

**Expected:**
```json
{
  "success": true,
  "path": "orc",
  "plate": null,
  "confidence": null,
  "embedding_quality": 0.85
}
```

### Test 4: Verify Logs

**Supabase Dashboard → Edge Functions → vehicle-ingest → Logs**

Look for:
```
📥 Received scan
📡 ALPR ✅ plate=ABC123 conf=0.91
# or
⚠️ ALPR ❌ plate=null conf=0.42 threshold=0.78
🤖 ORC fallback triggered
🤖 ORC ✅ dims=384 quality=0.85
✅ Ingest complete
```

### Test 5: Verify Database Records

```sql
SELECT 
  observation_id,
  plate_number,
  plate_confidence,
  vehicle_embedding IS NOT NULL as has_embedding,
  embedding_quality,
  idempotency_key,
  created_at
FROM vehicle_observations_v2
WHERE idempotency_key LIKE 'prod-test:%'
ORDER BY created_at DESC
LIMIT 5;
```

---

## 📊 Monitoring

### Key Metrics to Track

- **ALPR Success Rate**: % of scans with plate_number IS NOT NULL
- **ORC Fallback Rate**: % of scans with vehicle_embedding IS NOT NULL
- **P95 Latency**: Time from request to response
- **Error Rate**: HTTP 4xx/5xx responses

### Log Patterns

✅ **Success (ALPR):**
```
📥 Received scan
📡 ALPR ✅ plate=ABC123 conf=0.91
✅ Ingest complete hasPlate=true hasEmbedding=false
```

✅ **Success (ORC Fallback):**
```
📥 Received scan
⚠️ ALPR ❌ plate=null conf=0.42 threshold=0.78
🤖 ORC fallback triggered
🤖 ORC ✅ dims=384 quality=0.85 version=v1.0.0
✅ Ingest complete hasPlate=false hasEmbedding=true
```

❌ **Error Patterns:**
```
❌ PLATE_RECOGNIZER_TOKEN not configured
❌ ALPR API error 401: Unauthorized
❌ ORC infer failed 502: Bad Gateway
❌ Missing image data
```

---

## 🔄 Rollback Plan

If issues occur:

```bash
# Option 1: Increase ALPR threshold (force more ORC fallbacks)
supabase secrets set ALPR_CONF_THRESHOLD="0.90"

# Option 2: Redeploy previous version
git checkout <previous-commit>
supabase functions deploy vehicle-ingest

# Option 3: Disable function temporarily
# (Delete from Supabase Dashboard → Edge Functions)
```

---

## 🌟 Optional Enhancements (Future)

### 1. Parallel ALPR + ORC
Run both simultaneously, pick best result (lower latency)

### 2. Zone Auto-Detection
Derive zone_id from GPS coordinates in Edge Function

### 3. Vehicle Similarity Matching
Add pgvector top-k similarity RPC for "Likely same vehicle" panel

### 4. Retry Logic
Add exponential backoff for transient network errors

### 5. Configurable Storage
Use `EVIDENCE_BUCKET` secret for bucket name flexibility

---

## 🎯 Success Criteria

- ✅ CORS preflight returns 200
- ✅ ALPR path works (clean plates → `path: "alpr"`)
- ✅ ORC fallback works (no plate → `path: "orc"`)
- ✅ Logs show breadcrumbs (📥📡🤖✅)
- ✅ Database records created correctly
- ✅ P95 latency ≤ 3 seconds
- ✅ Error rate < 1%

---

**Status**: Ready for production deployment

**Next Steps**:
1. Configure production secrets with real tokens
2. Run deployment command
3. Execute all 5 verification tests
4. Monitor logs for 24 hours
5. Update frontend components to call unified endpoint
