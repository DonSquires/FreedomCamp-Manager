# LINZ Integration Architecture & Enforcement Pipeline
## Complete System Documentation

**Date:** May 15, 2026  
**Status:** FULLY IMPLEMENTED  
**Component:** Field Dispatch Accuracy Enhancement System

---

## 📋 Table of Contents

1. [System Overview](#system-overview)
2. [Architecture Diagram](#architecture-diagram)
3. [Component Details](#component-details)
4. [Implementation Guide](#implementation-guide)
5. [Testing & Validation](#testing--validation)
6. [Deployment Checklist](#deployment-checklist)

---

## System Overview

The LINZ integration system enables **authoritative address resolution**, **property boundary verification**, and **automated compliance enforcement** for New Zealand freedom camping and resource management enforcement operations.

### Why LINZ?

Field-based address matching via raw text geocoding produces ambiguous results:
- Duplicate road names across regions
- Unnumbered rural properties
- Rapidly shifting subdivision boundaries
- Colloquial location references common in field communications

**LINZ Data Service API** provides:
- ✅ Authoritative address identifiers (unique Address IDs)
- ✅ Parcel ownership & legal title references
- ✅ OGC WFS spatial queries (point-in-polygon analysis)
- ✅ Official NZ property boundaries
- ✅ Regional accuracy for compliance notices

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│         Ambiguous Source Data / Voice Input                 │
│     "Smoke coming from the back of 45 Lower Queen"          │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│      Stage 1: LINZ Address Resolution (linzGeocoder.ts)    │
│  - Calls /services/wfs matching text to NZ authoritative   │
│  - Extracts Unique Address ID (e.g., '1683921')            │
│  - Returns WGS84 coordinates [latitude, longitude]          │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│    Stage 2a: Parcel Boundary Verification (linzParcelService.ts)
│  - Queries LINZ Layer 50785 (NZ Primary Parcels)            │
│  - Point-in-polygon spatial calculation                     │
│  - Returns Title Reference & ownership type                 │
└────────────────────┬────────────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        ▼                         ▼
┌──────────────────────────┐ ┌──────────────────────────┐
│ Stage 2b: Vision Analysis│ │ Parcel Boundary Data    │
│(visionThresholdService)  │ │ LINZ Title Reference    │
│ - Analyzes field image   │ │ Ownership Type          │
│ - Returns smoke/bio score│ │ Private/Public          │
│ - Opacity density %      │ │                          │
└──────────────────────────┘ └──────────────────────────┘
        │                         │
        └────────────┬────────────┘
                     ▼
┌─────────────────────────────────────────────────────────────┐
│         Stage 3: Enforcement Decision Engine                │
│  - Breach Score >= 40% (smoke) or binary (biosecurity)      │
│  - Determines RMA citation requirement                      │
│  - Triggers automated PDF notice generation                 │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│      PDF Generation & Storage (Supabase Edge Function)      │
│  - pg_net trigger on incidents INSERT                       │
│  - Async PDF generation via generate-compliance-pdf         │
│  - Stores in compliance-vault Storage bucket                │
│  - Logs to compliance_audit_trail table                     │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│     Android Auto Geofence Alert (CarGeofenceAlert.ts)      │
│  - Monitors live GPS movement                              │
│  - Crosses into high-risk parcel?                          │
│  - TTS alert: "Entering high-risk boundary zone..."        │
│  - Logs parcel entry for audit trail                       │
└─────────────────────────────────────────────────────────────┘
```

---

## Component Details

### 1. LINZ Geocoder Service (`src/services/linzGeocoder.ts`)

**Purpose:** Resolve ambiguous addresses to authoritative LINZ coordinates

**Key Functions:**
- `resolveNzAddress(rawInput, incidentId)` - Single address resolution
- `resolveNzAddressBatch(addresses)` - Bulk address processing

**Environment Variables Required:**
```bash
VITE_LINZ_DATA_SERVICE_API_KEY=<your_linz_api_key>
VITE_SUPABASE_URL=https://kxwjcupuxnnbnzcgmkoi.supabase.co
VITE_SUPABASE_ANON_KEY=<your_anon_key>
```

**Example Usage:**
```typescript
import { resolveNzAddress } from '@/services/linzGeocoder';

const result = await resolveNzAddress('Lower Queen Street, Richmond', 'incident-123');
// Returns:
// {
//   success: true,
//   latitude: -41.3361,
//   longitude: 173.1842,
//   verifiedAddress: "45 Lower Queen Street, Richmond, Nelson 7020",
//   linzAddressId: 1683921,
//   locality: "Richmond",
//   city: "Nelson"
// }
```

### 2. LINZ Parcel Service (`src/services/linzParcelService.ts`)

**Purpose:** Verify property boundaries and ownership using LINZ WFS API

**Key Functions:**
- `checkParcelIntersection(lat, lng)` - Single coordinate check
- `checkParcelIntersectionBatch(coordinates)` - Bulk boundary checks
- `isPrivateProperty(lat, lng)` - Quick private/public determination

**LINZ Layers Used:**
- **Layer 105343:** Authoritative NZ Primary Address Dataset
- **Layer 50785:** NZ Primary Parcels (for boundary verification)

**Return Structure:**
```typescript
interface ParcelBoundaryResult {
  insideParcel: boolean;
  parcelId: string | null;
  titleReference: string | null;
  ownershipType?: string;
  area?: number; // in square meters
}
```

### 3. Vision Threshold Service (`src/services/visionThresholdService.ts`)

**Purpose:** Analyze field imagery against compliance thresholds

**Key Functions:**
- `evaluateFieldImage(imageUrl, type)` - Classify image & determine breach
- `shouldTriggerEnforcement(assessment)` - Decide if notice required
- `getEnforcementAction(assessment)` - Determine action type (NOTICE/CITATION)

**Threshold Calculations:**
- **Smoke:** Ringelmann density >= 40% = RMA Section 326 breach
- **Biosecurity:** Binary hazard detection = Biosecurity Act 1993 breach

**Assessment Output:**
```typescript
interface AssessmentMatrix {
  classification: 'SMOKE_COMPLAINT' | 'BIOSECURITY_BREACH';
  densityScore: number;        // 0-100%
  breachDetected: boolean;
  citationRequired: string;    // RMA section or Act reference
  confidence: number;          // 0-100%
  processingTime: number;      // milliseconds
}
```

### 4. PDF Generation Trigger (`supabase/migrations/20260515_pdf_trigger.sql`)

**Purpose:** Automatically generate enforcement notices when breach confirmed

**Trigger Mechanism:**
- PostgreSQL function: `handle_automated_breach_notice()`
- Fires on `incidents` table INSERT
- Uses `pg_net` extension for async HTTP calls
- Invokes `generate-compliance-pdf` Edge Function

**Triggered For:**
- Incident type = 'SMOKE_COMPLAINT' OR 'BIOSECURITY_BREACH'
- Automatically generates RMA Abatement Notice PDF
- Stores in `compliance-vault` Supabase Storage bucket

### 5. PDF Edge Function (`supabase/functions/generate-compliance-pdf/index.ts`)

**Purpose:** Generate official enforcement notices as PDF documents

**Features:**
- ✅ RMA Section 326 Abatement Notices (smoke)
- ✅ Biosecurity Act 1993 Breach Notices
- ✅ Automatic compliance deadline calculation (14 days)
- ✅ Property coordinates embedding
- ✅ Legal citation & appeal rights section
- ✅ HTML-to-PDF conversion with proper formatting

**Output Storage:**
```
compliance-vault/notices/{incident_id}.pdf
```

**Audit Trail:**
- Every PDF generation logged to `compliance_audit_trail` table
- Event type: `PDF_GENERATED_AND_STORED`
- Includes storage path, timestamp, incident details

### 6. Android Auto Geofence Alert (`src/automotive/CarGeofenceAlert.ts`)

**Purpose:** Trigger voice warnings when crossing high-risk parcel boundaries

**Key Features:**
- ✅ Real-time GPS movement monitoring
- ✅ Continuous parcel boundary checking
- ✅ Contextual TTS alerts
- ✅ Risk score integration with Bob API
- ✅ Audit trail logging

**Alert Example:**
```
"Warning. Entering high risk boundary zone. Title reference NZ12345/6789. 
Risk level: high. This property has 3 recent compliance breach records. 
Bob recommends securing immediate backup."
```

**Configuration:**
```typescript
const geofence = new CarGeofenceAlert({
  checkIntervalMs: 5000,      // Check every 5 seconds
  riskThreshold: 0.6,         // 60% risk score threshold
  enableTTS: true             // Enable text-to-speech
});

// Evaluate on each GPS update
geofence.evaluateCarMovement({
  latitude: -41.3361,
  longitude: 173.1842,
  speed: 45,
  heading: 180,
  timestamp: Date.now()
});
```

---

## Implementation Guide

### Prerequisites

1. **LINZ API Access:**
   - Register at https://linz.govt.nz/guidance/data-service
   - Obtain API key for WFS service access
   - Ensure key has access to layers 105343 and 50785

2. **Environment Variables:**
   ```bash
   VITE_LINZ_DATA_SERVICE_API_KEY=your_key_here
   VITE_RUNPOD_SERVERLESS_ENDPOINT_URL=http://your-runpod:8000
   VITE_RUNPOD_API_KEY=your_runpod_key
   ```

3. **Supabase Setup:**
   - Enable `pg_net` extension (already enabled on all Supabase projects)
   - Create `compliance-vault` Storage bucket
   - Create `compliance_audit_trail` table (via migration)

### Step 1: Deploy Database Migration

```bash
# Apply SQL migration to Supabase
supabase migration up --linked

# Verify tables created
supabase db list

# Check trigger installed
supabase functions list | grep generate-compliance-pdf
```

### Step 2: Deploy Edge Function

```bash
# Deploy PDF generation function
supabase functions deploy generate-compliance-pdf

# Test function
curl -X POST https://kxwjcupuxnnbnzcgmkoi.supabase.co/functions/v1/generate-compliance-pdf \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -d '{
    "incident_id": "test-123",
    "type": "SMOKE_COMPLAINT",
    "location": "Lower Queen Street, Richmond",
    "timestamp": "2026-05-15T10:30:00Z"
  }'
```

### Step 3: Initialize Services in Application

```typescript
// In your incident management page
import { resolveNzAddress } from '@/services/linzGeocoder';
import { checkParcelIntersection } from '@/services/linzParcelService';
import { evaluateFieldImage, shouldTriggerEnforcement } from '@/services/visionThresholdService';

// When officer submits breach report:
async function processBreachReport(rawLocation: string, imageFile: File) {
  // Step 1: Resolve address
  const addressResult = await resolveNzAddress(rawLocation, incidentId);
  if (!addressResult.success) throw new Error('Could not resolve location');

  // Step 2: Verify parcel
  const parcelCheck = await checkParcelIntersection(
    addressResult.latitude,
    addressResult.longitude
  );

  // Step 3: Analyze image
  const imageUrl = await uploadImageAndGetUrl(imageFile);
  const assessment = await evaluateFieldImage(imageUrl, 'SMOKE');

  // Step 4: Determine enforcement action
  if (shouldTriggerEnforcement(assessment)) {
    const action = getEnforcementAction(assessment);
    // PDF notice automatically generated via database trigger!
  }
}
```

### Step 4: Integrate Android Auto Alerts

```typescript
// In automotive module initialization
import { initializeCarGeofenceAlert } from '@/automotive/CarGeofenceAlert';

// Initialize on app startup
const geofenceAlert = initializeCarGeofenceAlert({
  checkIntervalMs: 5000,
  riskThreshold: 0.6,
  enableTTS: true
});

// In GPS update handler
function onGpsLocationUpdate(lat: number, lng: number) {
  geofenceAlert.evaluateCarMovement({
    latitude: lat,
    longitude: lng,
    timestamp: Date.now()
  });
}
```

---

## Testing & Validation

### Test Scripts

```bash
# Test LINZ geocoding
npm run test:linz:geocoding

# Test compliance integration
npm run test:compliance:integration

# Run both suites
npm run test:linz:compliance
```

### Test Coverage

**LINZ Geocoding Tests (`tests/linz.test.ts`):**
- ✅ Resolve ambiguous Tasman region addresses
- ✅ Handle unresolvable addresses gracefully
- ✅ Auckland CBD address resolution
- ✅ Batch processing multiple addresses

**Compliance Integration Tests (`tests/compliance.test.ts`):**
- ✅ LINZ spatial verification + image analysis → enforcement
- ✅ Biosecurity breach detection
- ✅ Batch incident processing
- ✅ Boundary ambiguity resilience

### Manual Testing

```bash
# Test LINZ API connectivity
curl "https://linz.govt.nz/services/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=layer-105343&outputFormat=json&CQL_FILTER=STRMATCHES(address,'Queen%20Street*')&key=YOUR_KEY"

# Test Supabase trigger
# Insert test incident → trigger fires → check compliance_audit_trail for PDF_GENERATED event

# Test geofence alerts
# Run CarGeofenceAlert with mock locations near recorded parcel boundaries
```

---

## Deployment Checklist

- [ ] LINZ API key obtained and added to environment
- [ ] Supabase migration `20260515_pdf_trigger.sql` executed
- [ ] Edge Function `generate-compliance-pdf` deployed
- [ ] Storage bucket `compliance-vault` created
- [ ] `compliance_audit_trail` table verified
- [ ] npm test scripts validated:
  - [ ] `npm run test:linz:geocoding` passes
  - [ ] `npm run test:compliance:integration` passes
- [ ] Environment variables configured in production:
  - [ ] `VITE_LINZ_DATA_SERVICE_API_KEY`
  - [ ] `VITE_RUNPOD_SERVERLESS_ENDPOINT_URL`
  - [ ] `VITE_RUNPOD_API_KEY`
- [ ] CarGeofenceAlert integrated into automotive module
- [ ] Documentation reviewed by compliance officer
- [ ] Test incidents created to verify end-to-end flow
- [ ] Audit trail verified for PDF generation events
- [ ] Android Auto TTS tested on test device
- [ ] Deployment scheduled outside business hours

---

## Monitoring & Maintenance

### Key Metrics to Track

```sql
-- Monitor PDF generation success rate
SELECT 
  DATE(created_at) as date,
  COUNT(*) as total_events,
  SUM(CASE WHEN event_type = 'PDF_GENERATED_AND_STORED' THEN 1 ELSE 0 END) as pdfs_generated,
  SUM(CASE WHEN event_details->>'error' IS NOT NULL THEN 1 ELSE 0 END) as errors
FROM compliance_audit_trail
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- Identify high-risk parcels
SELECT 
  title_reference,
  COUNT(*) as breach_count,
  MAX(created_at) as last_breach
FROM incidents
WHERE type IN ('SMOKE_COMPLAINT', 'BIOSECURITY_BREACH')
GROUP BY title_reference
HAVING COUNT(*) > 2
ORDER BY breach_count DESC;
```

### Troubleshooting

**PDF Generation Fails:**
1. Check `compliance_audit_trail` for error details
2. Verify `pg_net` extension enabled: `SELECT * FROM pg_extension;`
3. Test Edge Function directly via API
4. Check Supabase Storage bucket permissions

**LINZ API Rate Limits:**
1. Implement response caching for repeated addresses
2. Add exponential backoff retry logic
3. Monitor API quota via LINZ dashboard
4. Contact LINZ support if quota insufficient

**Vision Analysis Accuracy:**
1. Test with known-good reference images
2. Adjust RunPod model parameters if needed
3. Review confidence scores in `visionThresholdService`
4. Cross-validate with manual officer review

---

## References

- [LINZ Data Service Guide](https://linz.govt.nz/guidance/data-service/linz-data-service-guide/web-services/lds-apis-and-web-services)
- [OGC WFS Standard](https://www.ogc.org/standards/wfs)
- [Resource Management Act 1991 - Section 326](https://www.legislation.govt.nz/act/public/1991/0069/latest/DLM230265.html)
- [Biosecurity Act 1993](https://www.legislation.govt.nz/act/public/1993/0095/latest/DLM314622.html)
- [Supabase pg_net Documentation](https://supabase.com/docs/guides/functions/extensions/pg_net)

---

**Status:** ✅ Implementation Complete  
**Last Updated:** May 15, 2026  
**Maintainer:** Iron Eagle Security / OnSpace AI  
**Next Review:** May 22, 2026
