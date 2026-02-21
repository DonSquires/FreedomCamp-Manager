# Onspace AI Fallback Mode - Complete Integration Guide

**Status:** PRODUCTION-READY  
**Deployment Target:** Monday, Feb 22, 2026  
**Mode:** Temporary fallback until Railway inference service is operational

---

## 🎯 Architecture Overview

This document provides **complete coordination** between Supabase AI and Onspace AI during the temporary fallback period where:

- **Onspace AI** handles ALPR/ORC/embeddings on the client side
- **Supabase** handles validation, storage, analytics, and API serving
- **Railway inference service** is bypassed until models are deployed

---

## 📋 A) Supabase Edge Function Code Patch

### File: `supabase/functions/vehicle-ingest/index.ts`

**Key Changes:**

1. **Deployment Mode Flag** (Line 18):
```typescript
const USE_ONSPACE_AI = true; // ✅ Fallback mode active
```

2. **Onspace Plate Data Acceptance** (Lines 84-92):
```typescript
// Onspace AI provided plate data
if (USE_ONSPACE_AI) {
  clientPlate = body.plate;
  clientConfidence = body.confidence;
  clientRequiresManualEntry = body.requires_manual_entry ?? false;
  clientRawCandidates = body.raw_candidates;
}
```

3. **Inference Routing Logic** (Lines 175-242):
```typescript
if (USE_ONSPACE_AI) {
  // Accept pre-processed plate from client
  inferenceResult = {
    success: true,
    path: 'onspace_fallback',
    plate: clientPlate,
    requires_manual_entry: clientRequiresManualEntry,
    confidence: clientConfidence,
  };
} else {
  // Call Railway inference service (future)
  const inferenceResponse = await fetch(`${inferenceUrl}/infer`, {
    method: 'POST',
    body: JSON.stringify({ image_base64, mode: 'alpr_with_orc_fallback' }),
  });
  // ... process response
}
```

4. **Response Includes Source** (Line 294):
```typescript
return new Response(JSON.stringify({
  success: true,
  observation_id: observation.id,
  source: inferenceResult.path, // "onspace_fallback" or "railway_inference"
  plate: plateNumber,
  confidence: plateConfidence,
  requires_manual_entry: requiresManualEntry,
}));
```

### Deployment Command:

```bash
# Deploy updated vehicle-ingest function
supabase functions deploy vehicle-ingest

# Verify deployment
supabase functions list
```

---

## 📝 B) JSON Schema for Onspace AI Validation

Onspace AI must validate payloads before sending to `vehicle-ingest`. Use this schema:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Vehicle Ingest Payload (Onspace AI Fallback Mode)",
  "type": "object",
  "required": [
    "photoDataUrl",
    "gps",
    "recorded_at",
    "organization_id",
    "zone_id",
    "officer_id",
    "idempotency_key"
  ],
  "properties": {
    "photoDataUrl": {
      "type": "string",
      "description": "Base64-encoded image data URI",
      "pattern": "^data:image\\/(jpeg|jpg|png);base64,[A-Za-z0-9+/=]+$"
    },
    "plate": {
      "type": ["string", "null"],
      "description": "Detected plate number (null if detection failed)",
      "pattern": "^[A-Z0-9]{1,7}$",
      "examples": ["ABC123", "A8C12B", null]
    },
    "confidence": {
      "type": ["number", "null"],
      "description": "Plate detection confidence (0-1)",
      "minimum": 0,
      "maximum": 1,
      "examples": [0.92, 0.78, null]
    },
    "requires_manual_entry": {
      "type": "boolean",
      "description": "True if ALPR/ORC failed and manual entry needed",
      "default": false
    },
    "raw_candidates": {
      "type": "array",
      "description": "All candidate plates from ALPR (optional)",
      "items": {
        "type": "string",
        "pattern": "^[A-Z0-9]{1,7}$"
      },
      "maxItems": 10,
      "examples": [["ABC123", "ABC12B", "A8C123"]]
    },
    "gps": {
      "type": "object",
      "required": ["lat", "lng"],
      "properties": {
        "lat": {
          "type": "number",
          "description": "GPS latitude",
          "minimum": -90,
          "maximum": 90,
          "examples": [-43.5321]
        },
        "lng": {
          "type": "number",
          "description": "GPS longitude",
          "minimum": -180,
          "maximum": 180,
          "examples": [172.6362]
        },
        "accuracy": {
          "type": "number",
          "description": "GPS accuracy in meters",
          "minimum": 0,
          "examples": [6]
        }
      }
    },
    "recorded_at": {
      "type": "string",
      "description": "ISO 8601 timestamp from device",
      "format": "date-time",
      "examples": ["2026-02-22T10:42:01.123Z"]
    },
    "organization_id": {
      "type": "string",
      "description": "Organization UUID",
      "format": "uuid",
      "examples": ["550e8400-e29b-41d4-a716-446655440000"]
    },
    "zone_id": {
      "type": "string",
      "description": "Zone UUID",
      "format": "uuid",
      "examples": ["550e8400-e29b-41d4-a716-446655440001"]
    },
    "officer_id": {
      "type": "string",
      "description": "Officer/user UUID",
      "format": "uuid",
      "examples": ["550e8400-e29b-41d4-a716-446655440002"]
    },
    "idempotency_key": {
      "type": "string",
      "description": "Unique key for offline sync deduplication",
      "minLength": 10,
      "maxLength": 100,
      "examples": ["scan_1708599121123_abc123"]
    },
    "officer_notes": {
      "type": "string",
      "description": "Optional officer notes",
      "maxLength": 1000
    },
    "weather_conditions": {
      "type": "string",
      "description": "Optional weather conditions",
      "maxLength": 100,
      "examples": ["Clear", "Rainy", "Cloudy"]
    }
  }
}
```

### TypeScript Validation Example:

```typescript
import Ajv from 'ajv';

const ajv = new Ajv();
const schema = { /* paste schema above */ };
const validate = ajv.compile(schema);

function validatePayload(payload: any): boolean {
  const valid = validate(payload);
  if (!valid) {
    console.error('Validation errors:', validate.errors);
    return false;
  }
  return true;
}

// Before sending to Supabase:
if (!validatePayload(scanPayload)) {
  toast.error('Invalid scan data - please retry');
  return;
}
```

---

## 🧪 C) Smoke Test - Simulate Scan (curl)

Test the complete end-to-end flow with this curl command:

```bash
#!/bin/bash

# Configuration
SUPABASE_URL="https://xbfnlzmpumthnjmtqufp.supabase.co"
ANON_KEY="YOUR_ANON_KEY_HERE"
ACCESS_TOKEN="YOUR_ACCESS_TOKEN_HERE" # Get from supabase.auth.getSession()

# Test payload (simulates Onspace AI scan result)
curl -X POST "${SUPABASE_URL}/functions/v1/vehicle-ingest" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "apikey: ${ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "photoDataUrl": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCKAA==",
    "plate": "ABC123",
    "confidence": 0.87,
    "requires_manual_entry": false,
    "raw_candidates": ["ABC123", "ABC12B", "A8C123"],
    "gps": {
      "lat": -43.5321,
      "lng": 172.6362,
      "accuracy": 6
    },
    "recorded_at": "2026-02-22T10:42:01.123Z",
    "organization_id": "550e8400-e29b-41d4-a716-446655440000",
    "zone_id": "550e8400-e29b-41d4-a716-446655440001",
    "officer_id": "550e8400-e29b-41d4-a716-446655440002",
    "idempotency_key": "test_scan_1708599121123",
    "officer_notes": "Test scan from curl",
    "weather_conditions": "Clear"
  }' | jq .
```

### Expected Response (Success):

```json
{
  "success": true,
  "observation_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "source": "onspace_fallback",
  "plate": "ABC123",
  "confidence": 0.87,
  "photo_url": "https://xbfnlzmpumthnjmtqufp.supabase.co/storage/v1/object/public/evidence/officer_id/1708599121123-abc12345.jpg",
  "photo_hash": "abc123def456...",
  "requires_manual_entry": false
}
```

### Verification Steps:

1. **Check Observations Table:**
```sql
SELECT id, plate_number, photo_hash, source_path 
FROM observations 
WHERE idempotency_key = 'test_scan_1708599121123';
```

2. **Check Hotspots Map:**
   - Navigate to `/admin/hotspots`
   - Verify marker appears at GPS coordinates
   - Click cluster to see observation in drawer

3. **Check Observations Page:**
   - Navigate to `/admin/observations`
   - Search for plate "ABC123"
   - Verify row shows correct data

4. **Export CSV:**
   - Click "Export CSV" button
   - Verify test observation appears in downloaded file

---

## 📄 D) One-Page Summary (For Team Distribution)

### **FreedomCamp Manager - Onspace AI Fallback Mode**

**Effective Date:** February 22, 2026  
**Duration:** Temporary (until Railway inference service is operational)

#### What Changed?

We've implemented a **temporary fallback architecture** where plate detection (ALPR/ORC) happens on the **Onspace AI side** instead of the **Railway inference service**.

#### Why This Change?

- Railway inference service requires additional model deployment work
- This gives us **production-ready operations by Monday**
- Maintains identical user experience
- Clean re-integration path when Railway is ready

#### Division of Responsibilities

| Component | Owner | Responsibilities |
|-----------|-------|------------------|
| **Onspace AI** | Frontend/UI | • Photo capture<br>• ALPR detection<br>• ORC fallback<br>• Plate normalization<br>• Send to Supabase |
| **Supabase** | Backend/DB | • Validate payload<br>• Store observations<br>• Serve analytics<br>• CSV exports<br>• Admin UI data |
| **Railway** | Infrastructure | • (Bypassed temporarily)<br>• Will be re-enabled when models are deployed |

#### Data Contract (Onspace → Supabase)

Onspace AI must POST to `/functions/v1/vehicle-ingest` with:

```json
{
  "photoDataUrl": "data:image/jpeg;base64,...",
  "plate": "ABC123" | null,
  "confidence": 0.87,
  "requires_manual_entry": false,
  "gps": { "lat": -43.53, "lng": 172.63, "accuracy": 6 },
  "recorded_at": "2026-02-22T10:42:01Z",
  "organization_id": "uuid",
  "zone_id": "uuid",
  "officer_id": "uuid",
  "idempotency_key": "unique_scan_id"
}
```

#### Success Metrics

- ✅ Observations appear in Admin Portal within 2 seconds
- ✅ Hotspots map updates immediately
- ✅ CSV exports include all scans
- ✅ No calls to Railway (zero 500 errors)
- ✅ Offline sync works (idempotency keys prevent duplicates)

#### Re-Enabling Railway (Future)

When Railway inference service is ready:

1. Upload `.onnx` models to `v1-models` branch
2. Verify Docker build succeeds
3. Test `/ready` endpoint returns 200
4. Update Edge Function: `const USE_ONSPACE_AI = false;`
5. Deploy: `supabase functions deploy vehicle-ingest`
6. Monitor: Onspace AI stops doing ALPR, Supabase calls Railway

#### Support Contacts

- **Technical Lead:** [Your Name]
- **Supabase Issues:** Check Edge Function logs
- **Onspace AI Issues:** Check browser console for validation errors
- **Data Issues:** Query `observations` table directly

---

## ✅ Monday Deployment Checklist

### Pre-Deployment (Friday/Weekend)

- [ ] Deploy updated `vehicle-ingest` Edge Function
- [ ] Run curl smoke test (verify 200 response)
- [ ] Check `observations` table receives test scan
- [ ] Verify Admin Portal hotspots show test marker
- [ ] Test CSV export includes test observation
- [ ] Clear test data: `DELETE FROM observations WHERE idempotency_key LIKE 'test_%';`

### Monday Morning (Go-Live)

- [ ] Onspace AI: Enable fallback mode in production build
- [ ] First real scan: Officer takes photo of known plate
- [ ] Verify observation appears in Admin Portal < 2 seconds
- [ ] Check source field: `"source": "onspace_fallback"`
- [ ] Monitor logs: No Railway calls, no 500 errors
- [ ] Notify team: Fallback mode active ✅

### Post-Deployment Monitoring (Week 1)

- [ ] Track average scan-to-observation latency (target < 2s)
- [ ] Monitor duplicate rate (should be 0% with idempotency keys)
- [ ] Check ALPR success rate from Onspace logs
- [ ] Count manual entry requests (target < 30%)
- [ ] Review officer feedback on scan UX

---

## 🔧 Troubleshooting

### Issue: "Missing authorization header"

**Cause:** Onspace AI not passing access token  
**Fix:** Use `supabase.functions.invoke()` instead of raw `fetch()`

```typescript
// ✅ Correct
await supabase.functions.invoke('vehicle-ingest', { body: payload });

// ❌ Wrong
await fetch(`${SUPABASE_URL}/functions/v1/vehicle-ingest`, { 
  body: JSON.stringify(payload) 
});
```

### Issue: "Observation appears but plate is null"

**Cause:** Onspace AI not providing `plate` field  
**Fix:** Validate payload before sending:

```typescript
if (!payload.plate && !payload.requires_manual_entry) {
  console.error('Plate detection failed but manual entry not flagged');
  payload.requires_manual_entry = true;
}
```

### Issue: "Duplicate observations created"

**Cause:** Idempotency key collision or not unique  
**Fix:** Generate unique key per scan:

```typescript
const idempotencyKey = `scan_${Date.now()}_${officerId}_${zoneId}`;
```

### Issue: "Admin Portal shows zero observations"

**Cause:** RLS policies blocking reads or wrong organization filter  
**Fix:** Check user's organization_id matches observation's organization_id

```sql
-- Verify observation visibility
SELECT id, plate_number, organization_id 
FROM observations 
WHERE recorded_by = 'YOUR_OFFICER_ID' 
ORDER BY recorded_at DESC 
LIMIT 10;
```

---

## 📚 Additional Resources

- **Edge Function Logs:** `supabase functions logs vehicle-ingest`
- **Database Schema:** `ADMIN_PORTAL_GO_LIVE_CHECKLIST.md`
- **API Contracts:** `supabase/functions/vehicle-ingest/README.md`
- **Frontend Integration:** Contact Onspace AI team

---

**Document Version:** 1.0  
**Last Updated:** February 22, 2026  
**Status:** APPROVED FOR PRODUCTION

