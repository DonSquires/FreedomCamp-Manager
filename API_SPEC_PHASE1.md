# FreedomCamp Manager - Phase 1 API Specification

## Overview
OpenAPI-style specification for Phase 1 backend endpoints supporting both Field Officer and Admin portals.

---

## Authentication
All endpoints require Bearer token authentication:
```
Authorization: Bearer {supabase_jwt_token}
```

---

## Field Officer Endpoints

### POST /functions/v1/process-driving-scan
Fast plate recognition and compliance check for mobile scanning.

**Request:**
```json
{
  "imageUrl": "https://storage.supabase.co/...",
  "zoneId": "uuid",
  "organizationId": "uuid",
  "gpsLocation": {
    "lat": -41.2706,
    "lng": 173.2840,
    "accuracy": 5.2
  },
  "happenedAt": "2025-01-26T14:30:00Z"
}
```

**Response:**
```json
{
  "plate": "ABC123",
  "confidence": 0.95,
  "vehicle": {
    "make": "Toyota",
    "model": "Camry",
    "color": "Silver",
    "year": "2020"
  },
  "plateCropUrl": "https://storage.supabase.co/.../cropped.jpg",
  "compliance": {
    "isCompliant": false,
    "violationSeverity": "critical",
    "violationMessage": "Vehicle exceeded consecutive nights limit",
    "fineAmount": 400,
    "recommendedAction": "Issue breach notice",
    "matrixVersion": 3
  },
  "isFlagged": false,
  "isHomeless": false
}
```

---

### POST /functions/v1/recognize-plate
ALPR (Automatic License Plate Recognition) using Plate Recognizer API.

**Request:**
```json
{
  "imageUrl": "https://storage.supabase.co/..."
}
```

**Response:**
```json
{
  "plate": "ABC123",
  "confidence": 0.95,
  "vehicle": {
    "make": "Toyota",
    "model": "Camry",
    "color": "Silver",
    "year": "2020"
  },
  "plate_crop_url": "https://storage.supabase.co/.../cropped.jpg"
}
```

---

### POST /functions/v1/extract-plate
OCR fallback using OnSpace AI when ALPR fails.

**Request:**
```json
{
  "imageUrl": "https://storage.supabase.co/..."
}
```

**Response:**
```json
{
  "plate": "ABC123",
  "confidence": 0.75
}
```

---

## Admin Endpoints

### POST /functions/v1/recalculate-compliance
Multi-scope compliance recalculation with real-time progress tracking.

**Request:**
```json
{
  "scope": "ZONE" | "ORG" | "BUILD",
  "zoneIds": ["uuid1", "uuid2"],
  "orgIds": ["uuid1"],
  "dateRangeStart": "2025-01-01",
  "dateRangeEnd": "2025-01-26",
  "performedBy": "uuid"
}
```

**Response:**
```json
{
  "actionId": "uuid",
  "status": "running",
  "message": "Recalculation started - tracking via Realtime"
}
```

**Real-time Updates (Supabase Realtime):**
Subscribe to `admin_recalculation_actions` table:
```typescript
supabase
  .channel('recalculation_progress')
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'admin_recalculation_actions',
    filter: `id=eq.${actionId}`
  }, (payload) => {
    // payload.new contains:
    // - observations_processed (current count)
    // - compliance_changed (count changed)
    // - drift_events_created (count)
    // - status ('running' | 'completed' | 'failed')
    // - duration_seconds
  })
  .subscribe()
```

---

### GET /drift_events
List drift events with filters.

**Query Parameters:**
- `zone_id` (optional): Filter by zone UUID
- `organization_id` (optional): Filter by organization UUID
- `severity` (optional): `INFO` | `WARNING` | `CRITICAL`
- `status` (optional): `pending` | `reviewed` | `acknowledged`
- `from_date` (optional): ISO 8601 date
- `to_date` (optional): ISO 8601 date

**Response:**
```json
{
  "events": [
    {
      "id": "uuid",
      "zoneId": "uuid",
      "zoneName": "Zone A",
      "organizationId": "uuid",
      "organizationName": "Org 1",
      "matrixVersionFrom": 2,
      "matrixVersionTo": 3,
      "observationsAffected": 15,
      "complianceChanged": 3,
      "criteriaChanged": {
        "max_consecutive_nights": { "old": 3, "new": 2 },
        "nights_per_month": { "old": 28, "new": 21 }
      },
      "detectedAt": "2025-01-26T10:00:00Z",
      "detectedBy": "uuid",
      "status": "pending",
      "severity": "CRITICAL"
    }
  ],
  "total": 45,
  "page": 1,
  "pageSize": 20
}
```

---

### POST /functions/v1/generate-incident-pdf
Generate court-ready PDF with matrix snapshot.

**Request:**
```json
{
  "incidentId": "uuid",
  "includeMatrixSnapshot": true,
  "includeEvidencePhotos": true,
  "includeGPSMap": true
}
```

**Response:**
```json
{
  "pdfUrl": "https://storage.supabase.co/.../incident_ABC123_20250126.pdf",
  "fileName": "incident_ABC123_20250126.pdf",
  "fileSize": 2457600,
  "matrixVersion": 3,
  "generatedAt": "2025-01-26T14:45:00Z"
}
```

**PDF Contents:**
1. **Header:** Organization, Zone, Officer, Date/Time
2. **Incident Summary:** Plate, Vehicle, Location (GPS map)
3. **Evidence Photos:** Full-size photos with captions
4. **Compliance Status:** Breach details, fine amount, nights analysis
5. **Matrix Snapshot:**
   ```
   === COMPLIANCE MATRIX SNAPSHOT ===
   Version: 3
   Zone: Zone A
   Organization: Nelson City Council
   Effective From: 2025-01-15
   
   Criteria:
   - Self-Contained Required: YES
   - Nights Per Month: 21
   - Max Consecutive Nights: 2
   - Day Visit Only: NO
   - Homeless Exemption: YES
   
   Change Reason: Updated council policy for summer season
   Created By: Admin User (2025-01-15 09:30 NZDT)
   ```
6. **Officer Notes:** Additional context
7. **Signature Block:** Digital signature placeholder

---

### GET /zones/{zone_id}/matrix
Get active compliance matrix for a zone.

**Response:**
```json
{
  "id": "uuid",
  "zoneId": "uuid",
  "version": 3,
  "effectiveFrom": "2025-01-15T00:00:00Z",
  "effectiveTo": null,
  "selfContainedRequired": true,
  "nightsPerMonth": 21,
  "maxConsecutiveNights": 2,
  "dayVisitOnly": false,
  "allowedDays": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
  "homelessExemption": true,
  "createdBy": "uuid",
  "changeReason": "Updated council policy for summer season",
  "createdAt": "2025-01-15T09:30:00Z"
}
```

---

### POST /zones/{zone_id}/matrix
Create new matrix version (versioning + audit).

**Request:**
```json
{
  "selfContainedRequired": true,
  "nightsPerMonth": 21,
  "maxConsecutiveNights": 2,
  "dayVisitOnly": false,
  "allowedDays": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
  "homelessExemption": true,
  "changeReason": "Updated council policy for summer season",
  "changeNotes": "Reduced nights per month from 28 to 21 due to increased summer traffic"
}
```

**Response:**
```json
{
  "id": "uuid",
  "version": 4,
  "effectiveFrom": "2025-01-26T00:00:00Z",
  "driftDetectionScheduled": true,
  "affectedObservations": 127,
  "message": "Matrix version 4 created - drift detection will run in background"
}
```

---

### GET /functions/v1/get-compliance-statistics
Get zone/org compliance analytics.

**Query Parameters:**
- `zone_id` (optional)
- `organization_id` (optional)
- `from_date` (required)
- `to_date` (required)

**Response:**
```json
{
  "totalObservations": 1247,
  "compliantCount": 1189,
  "breachCount": 58,
  "complianceRate": 0.953,
  "byZone": [
    {
      "zoneId": "uuid",
      "zoneName": "Zone A",
      "total": 450,
      "compliant": 420,
      "breach": 30,
      "rate": 0.933
    }
  ],
  "finesIssued": 23,
  "totalFineAmount": 9200,
  "homelessExemptions": 12
}
```

---

## Data Contracts

### ComplianceResult
```typescript
interface ComplianceResult {
  observation_id: string;
  vehicle_id: string;
  zone_id: string;
  organization_id: string;
  matrix_id: string;
  matrix_version: number;
  is_compliant: boolean;
  violation_reasons: string[];
  metrics_json: {
    nights_this_month: number;
    consecutive_nights: number;
    is_self_contained: boolean;
    is_homeless: boolean;
  };
  matrix_snapshot: {
    version: number;
    zone_name: string;
    organization_name: string;
    effective_from: string;
    criteria: {
      self_contained_required: boolean;
      nights_per_month: number;
      max_consecutive_nights: number;
      day_visit_only: boolean;
      homeless_exemption: boolean;
    };
  };
  evaluated_at: string;
}
```

### DriftEvent
```typescript
interface DriftEvent {
  id: string;
  zone_id: string;
  organization_id: string;
  matrix_version_from: number;
  matrix_version_to: number;
  matrix_id_from: string;
  matrix_id_to: string;
  observations_affected: number;
  compliance_changed: number;
  criteria_changed: {
    [key: string]: { old: any; new: any };
  };
  detected_at: string;
  detected_by: string;
  status: 'pending' | 'reviewed' | 'acknowledged';
  remediation_notes: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
}
```

---

## Error Responses

All endpoints return standardized error format:

```json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": {
    "field": "Additional context"
  }
}
```

**Common HTTP Status Codes:**
- `200` - Success
- `400` - Bad Request (validation error)
- `401` - Unauthorized (invalid token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `500` - Internal Server Error

---

## Rate Limits

- Field Officer endpoints: 100 requests/minute
- Admin endpoints: 50 requests/minute
- PDF generation: 10 requests/minute

---

## Notes

- All timestamps use ISO 8601 format with timezone
- All UUIDs are RFC 4122 compliant
- GPS coordinates use WGS84 (EPSG:4326)
- Matrix snapshots embedded in PDFs are read-only audit trails
- Drift detection runs asynchronously after matrix changes

