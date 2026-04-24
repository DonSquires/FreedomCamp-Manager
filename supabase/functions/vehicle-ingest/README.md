# Vehicle Ingest - Unified ALPR + ORC Pipeline

## Overview

This Edge Function provides a unified vehicle scanning pipeline that:

1. **Tries ALPR first** (Snapshot Cloud API) for plate recognition
2. **Falls back to ORC** (Railway inference service) if ALPR fails or has low confidence
3. **Stores both results** when available for maximum data capture
4. **Returns immediately** with whichever result succeeded

## Decision Logic

```
┌─────────────────────────────────────────────────┐
│ 1. Receive photo + GPS + metadata              │
└─────────────────┬───────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────┐
│ 2. Try ALPR (Snapshot Cloud)                   │
│    - Multipart upload for best performance     │
│    - Region: NZ                                 │
│    - Mode: Fast                                 │
└─────────────────┬───────────────────────────────┘
                  │
         ┌────────┴────────┐
         │                 │
         ▼                 ▼
    Plate found?      No plate OR
    Conf ≥ 0.78?      Conf < 0.78
         │                 │
         │                 ▼
         │        ┌─────────────────────┐
         │        │ 3. ORC Fallback     │
         │        │    - Call Railway   │
         │        │    - Get embedding  │
         │        │    - Store quality  │
         │        └─────────┬───────────┘
         │                  │
         └────────┬─────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────┐
│ 4. Create observation with available data      │
│    - Plate + confidence (if ALPR succeeded)    │
│    - Embedding + quality (if ORC ran)          │
│    - GPS, zone, officer metadata               │
└─────────────────────────────────────────────────┘
```

## Environment Variables

### Required

```bash
SUPABASE_URL=https://xbfnlzmpumthnjmtqufp.supabase.co
SUPABASE_SERVICE_ROLE_KEY=***
```

### ALPR (Primary)

```bash
PLATE_RECOGNIZER_TOKEN=***
ALPR_CLOUD_URL=https://api.platerecognizer.com/v1/plate-reader/
ALPR_REGIONS=nz
ALPR_MMC=false
ALPR_CONFIG={"mode":"fast"}
ALPR_TIMEOUT_MS=15000
ALPR_CONF_THRESHOLD=0.78
```

### ORC (Fallback)

```bash
INFERENCE_SERVICE_URL=https://api.runpod.ai/v2/<RUNPOD_ENDPOINT_ID>/runsync
```

## Request Format

### JSON (Recommended)

```json
{
  "image": "data:image/jpeg;base64,...",
  "gpsLatitude": -43.5321,
  "gpsLongitude": 172.6362,
  "recordedAt": "2026-02-20T08:20:00.000Z",
  "officerId": "uuid-here",
  "organizationId": "uuid-here",
  "zoneId": "uuid-here",
  "idempotencyKey": "deviceId:localUuid"
}
```

### Multipart (Alternative)

```
POST /vehicle-ingest
Content-Type: multipart/form-data

photo: <binary JPEG/PNG>
gpsLatitude: -43.5321
gpsLongitude: 172.6362
recordedAt: 2026-02-20T08:20:00.000Z
officerId: uuid-here
organizationId: uuid-here
zoneId: uuid-here
idempotencyKey: deviceId:localUuid
```

## Response Format

```json
{
  "success": true,
  "path": "alpr",  // or "orc"
  "plate": "ABC123",
  "confidence": 0.91,
  "embedding_quality": null,  // or 0.85 if ORC ran
  "observation": {
    "plate_number": "ABC123",
    "plate_confidence": 0.91,
    "vehicle_embedding": null,  // or [0.1, 0.2, ...] if ORC ran
    "embedding_quality": null,
    "embedding_model_version": null,
    "gps_latitude": -43.5321,
    "gps_longitude": 172.6362,
    "recorded_at": "2026-02-20T08:20:00.000Z",
    "recorded_by": "uuid-here",
    "organization_id": "uuid-here",
    "zone_id": "uuid-here"
  }
}
```

## Deployment

```bash
# Set secrets
supabase secrets set \
  PLATE_RECOGNIZER_TOKEN=*** \
  ALPR_CLOUD_URL=https://api.platerecognizer.com/v1/plate-reader/ \
  ALPR_REGIONS=nz \
  ALPR_MMC=false \
  ALPR_CONFIG='{"mode":"fast"}' \
  ALPR_TIMEOUT_MS=15000 \
  ALPR_CONF_THRESHOLD=0.78 \
  INFERENCE_SERVICE_URL=https://api.runpod.ai/v2/<RUNPOD_ENDPOINT_ID>/runsync

# Deploy function
supabase functions deploy vehicle-ingest
```

## Testing

### Test ALPR Path

```bash
curl -X POST https://xbfnlzmpumthnjmtqufp.supabase.co/functions/v1/vehicle-ingest \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "image": "data:image/jpeg;base64,...",
    "gpsLatitude": -43.5321,
    "gpsLongitude": 172.6362,
    "recordedAt": "2026-02-20T08:20:00.000Z",
    "officerId": "uuid-here"
  }'
```

### Test ORC Fallback

Use a photo with no visible plate or poor lighting to trigger fallback.

## Observability

### Log Patterns

```
📥 Received scan  officer=<uuid> org=<uuid> zone=<uuid>
📡 ALPR ✅  plate=ABC123 conf=0.91
⚠️ ALPR ❌  plate=null conf=0.42 threshold=0.78
🤖 ORC fallback triggered
🤖 ORC ✅  dims=384 quality=0.85 version=v1.0.0
❌ ORC error: Connection timeout
✅ Ingest complete  hasPlate=true hasEmbedding=false
```

## Performance Targets

- **P95 latency**: ≤ 3 seconds end-to-end
- **ALPR success rate**: ≥ 70% (daytime, clean plates)
- **ORC fallback rate**: ≤ 30%
- **Error rate**: < 1%

## Rollout Plan

1. **Day 0**: Deploy with both paths enabled
2. **Pilot**: 1-2 shifts with 2 officers
3. **Monitor**: ALPR hit rate, ORC fallback rate, latency
4. **Tune**: Adjust `ALPR_CONF_THRESHOLD` based on field data
5. **Scale**: Enable for all officers

## Acceptance Criteria

- ✅ Captures never hang (timeout protection)
- ✅ ALPR succeeds for clean daylight plates
- ✅ ORC fallback works for missing/dirty/night plates
- ✅ Both results stored when available
- ✅ Breadcrumb logs for debugging
- ✅ CORS configured for all preview/production domains
- ✅ No client-side ALPR tokens
