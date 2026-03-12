# Plate Scanner - Brand New Edge Functions

**Created:** February 18, 2026  
**Purpose:** Clean rebuild of ALPR workflow without dependencies on broken functions

---

## Why Brand New Functions?

The old Zoom Scan used:
- `recognize-plate` (ALPR only)
- `process-field-scan` (Observation creation)

**Problems with old approach:**
1. Multiple function calls = more points of failure
2. Complex error handling across functions
3. Observation recording issues that couldn't be fixed
4. Dependency on patched/broken code

**New approach:**
- `plate-scanner-complete` (ONE function does everything)
- Upload → ALPR → Observation → Compliance → Result
- All tables updated in single transaction
- Built from scratch with proper error handling

---

## New Edge Function: plate-scanner-complete

### Location
```
supabase/functions/plate-scanner-complete/index.ts
```

### Complete Workflow

```
┌─────────────────────────────────────────────────────────┐
│ 1. UPLOAD PHOTO TO STORAGE                             │
├─────────────────────────────────────────────────────────┤
│ - Convert base64 → Uint8Array                          │
│ - Upload to evidence bucket                            │
│ - Generate public URL                                  │
│ - RETAIN BEFORE ALPR (legal compliance)                │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│ 2. ALPR RECOGNITION                                     │
├─────────────────────────────────────────────────────────┤
│ - Call Plate Recognizer API directly                   │
│ - Parse plate number + vehicle details                 │
│ - Extract confidence score                             │
│ - Handle "no plates detected" error                    │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│ 3. GET/CREATE CANONICAL VEHICLE                        │
├─────────────────────────────────────────────────────────┤
│ - Check if vehicle exists in canonical_vehicles        │
│ - Create if new (with ALPR details)                    │
│ - Update if exists (increment count, update timestamp) │
│ - Fetch flags (is_flagged, homeless_status)            │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│ 4. CREATE OBSERVATION                                   │
├─────────────────────────────────────────────────────────┤
│ Table: observations                         │
│ - plate_number (normalized)                            │
│ - vehicle_make, model, color, year (from ALPR)         │
│ - photo (public URL)                                   │
│ - gps_latitude, gps_longitude, gps_accuracy            │
│ - zone_id, organization_id, recorded_by                │
│ - recorded_at (NZ timezone)                            │
│ - officer_notes (includes ALPR confidence)             │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│ 5. WAIT FOR COMPLIANCE EVALUATION (TRIGGER)            │
├─────────────────────────────────────────────────────────┤
│ - Trigger: trigger_auto_create_compliance_result       │
│ - Creates record in compliance_results                 │
│ - Evaluates zone rules (matrix)                        │
│ - Wait up to 3 seconds for completion                  │
│ - Continue if not ready (better than failing)          │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│ 6. CHECK BREACH ALERTS (TRIGGER)                       │
├─────────────────────────────────────────────────────────┤
│ - Trigger: trigger_auto_create_breach_alert            │
│ - Creates records in breach_alerts (if non-compliant)  │
│ - Excludes homeless vehicles (FC Act protection)       │
│ - Query for pending alerts                             │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│ 7. BUILD RESPONSE                                       │
├─────────────────────────────────────────────────────────┤
│ {                                                       │
│   success: true,                                       │
│   observation_id: "[UUID]",                            │
│   plate_number: "ABC123",                              │
│   is_flagged: false,                                   │
│   is_compliant: true,                                  │
│   is_homeless: false,                                  │
│   at_risk: false,                                      │
│   alerts: ["✅ Compliant with zone requirements"]      │
│ }                                                       │
└─────────────────────────────────────────────────────────┘
```

### Request Body
```typescript
{
  image: string;        // base64 JPEG from camera
  zoneId: string;       // UUID from auto-detection
  organizationId: string; // UUID from user profile
  userId: string;       // UUID from auth
  gpsLocation?: {       // From device GPS
    lat: number;
    lng: number;
    accuracy: number;
  };
  patrolId?: string;    // UUID if patrol active
}
```

### Response Body
```typescript
{
  success: boolean;
  observation_id?: string;     // UUID for linking
  plate_number?: string;       // Normalized plate
  is_flagged?: boolean;        // From canonical_vehicles
  is_compliant?: boolean;      // From compliance_results
  is_homeless?: boolean;       // From canonical_vehicles
  at_risk?: boolean;           // Final night before breach
  alerts?: string[];           // Human-readable messages
  error?: string;              // If success = false
}
```

### Alert Messages Format
```typescript
// FLAGGED VEHICLE
"🚩 FLAGGED VEHICLE: Watch list - known problem vehicle"

// HOMELESS (FC ACT EXEMPT)
"🏕️ Homeless vehicle - FC Act Exempt (no enforcement)"

// BREACH DETECTED
"🔴 BREACH: Exceeded 3 consecutive nights in zone"
"🔴 BREACH: Monthly limit exceeded (28 nights)"
"🔴 BREACH: Not self-contained in self-contained zone"

// AT RISK
"🟡 AT RISK: Final night before breach - monitor closely"

// COMPLIANT
"✅ Compliant with zone requirements"
```

---

## Tables Updated

### 1. canonical_vehicles
- **Created if new:** First observation of plate
- **Updated if exists:** Increment count, update timestamp, merge vehicle details
- **Fields used:**
  - `plate_number` (PK)
  - `vehicle_make`, `vehicle_model`, `vehicle_color`, `vehicle_year`
  - `is_flagged`, `flagged_reason`
  - `homeless_status` (none/claimed/confirmed)
  - `first_seen_at`, `last_seen_at`
  - `total_observations` (incremented)

### 2. observations
- **Always created:** One record per scan
- **Fields set:**
  - `observation_id` (UUID, generated)
  - `plate_number` (normalized, FK to canonical_vehicles)
  - `vehicle_make`, `vehicle_model`, `vehicle_year`, `vehicle_color`
  - `photo` (public URL from storage)
  - `photo_hash` (SHA-256, future feature)
  - `gps_latitude`, `gps_longitude`, `gps_accuracy`
  - `recorded_at` (NZ timezone ISO string)
  - `organization_id`, `zone_id`, `recorded_by`
  - `officer_notes` (includes ALPR confidence)
  - `self_contained` (false by default - not detected yet)

### 3. compliance_results (Auto-created by trigger)
- **Trigger:** `trigger_auto_create_compliance_result`
- **When:** After INSERT on observations
- **Fields:**
  - `observation_id` (FK)
  - `zone_id`, `organization_id`
  - `matrix_id`, `matrix_version`
  - `is_compliant` (boolean result)
  - `violation_reasons` (text array)
  - `metrics_json` (JSONB with details)
  - `matrix_snapshot` (JSONB copy of rules)
  - `evaluated_at` (timestamp)

### 4. breach_alerts (Auto-created by trigger)
- **Trigger:** `trigger_auto_create_breach_alert`
- **When:** After INSERT on compliance_results WHERE is_compliant = false
- **Condition:** NOT homeless (FC Act exemption)
- **Fields:**
  - `observation_id` (FK)
  - `plate_number` (FK)
  - `organization_id`, `zone_id`
  - `breach_type` (consecutive_nights, monthly_limit, etc.)
  - `breach_details` (JSONB with message, severity)
  - `status` (pending → acknowledged → resolved)
  - `created_at` (timestamp)

### 5. vehicle_monthly_stays (Updated by trigger)
- **Trigger:** `trigger_update_monthly_stays_on_observation`
- **When:** After INSERT on observations
- **Updates:**
  - `nights_stayed` (incremented if overnight)
  - `consecutive_nights` (tracked via GPS)
  - `observation_ids` (array append)
  - `last_observation_date` (timestamp)

---

## Error Handling

### Network Errors
```typescript
// Upload failure
throw new Error('Upload failed: [specific error]');

// ALPR API error
throw new Error('ALPR API error: 404 - Service unavailable');
```

### ALPR Errors
```typescript
// No plates detected
throw new Error('No license plates detected in image');

// Low confidence (future feature)
throw new Error('Plate confidence too low (45%) - manual entry required');
```

### Database Errors
```typescript
// Observation creation failed
throw new Error('Failed to create observation: [specific constraint]');

// Canonical vehicle upsert failed
throw new Error('Failed to create vehicle: [specific error]');
```

### All Errors Return
```json
{
  "success": false,
  "error": "Specific error message here"
}
```

---

## Frontend Integration

### PlateScanner.tsx Changes

**BEFORE (Old broken functions):**
```typescript
// Call recognize-plate
const { data: alprData } = await supabase.functions.invoke('recognize-plate', {...});

// Call process-field-scan
const { data: scanResult } = await supabase.functions.invoke('process-field-scan', {...});
```

**AFTER (New all-in-one function):**
```typescript
// Single call does everything
const { data: scanResult, error } = await supabase.functions.invoke('plate-scanner-complete', {
  body: {
    image: imageDataUrl,
    zoneId: selectedZone.id,
    organizationId: selectedZone.organization_id,
    userId: user.id,
    gpsLocation,
    patrolId: currentPatrol?.id,
  },
});

// Result already includes everything we need
if (scanResult.success) {
  const { observation_id, plate_number, is_flagged, is_compliant, at_risk, alerts } = scanResult;
  // Update queue with status
}
```

---

## Deployment Checklist

- [x] Create new function file
- [x] Update PlateScanner.tsx to use new function
- [ ] Deploy to Supabase: `supabase functions deploy plate-scanner-complete`
- [ ] Test with real device (mobile with GPS)
- [ ] Verify all triggers fire correctly
- [ ] Check breach_alerts auto-creation
- [ ] Test compliance evaluation accuracy
- [ ] Monitor Edge Function logs for errors

---

## Testing Scenarios

### 1. Compliant Vehicle
**Input:** New plate, no previous observations, compliant zone  
**Expected:**
- Creates canonical_vehicles record
- Creates observations record
- Creates compliance_results (is_compliant = true)
- NO breach_alerts created
- Response: `is_compliant: true, alerts: ["✅ Compliant"]`

### 2. Flagged Vehicle
**Input:** Plate exists in canonical_vehicles with is_flagged = true  
**Expected:**
- Updates canonical_vehicles (increment count)
- Creates observation
- Creates compliance_results
- May create breach_alerts (if also non-compliant)
- Response: `is_flagged: true, alerts: ["🚩 FLAGGED VEHICLE: ..."]`

### 3. Homeless Vehicle (FC Act Exempt)
**Input:** Plate exists with homeless_status = 'confirmed'  
**Expected:**
- Creates observation
- Creates compliance_results (may be non-compliant)
- NO breach_alerts created (exempt)
- Response: `is_homeless: true, is_compliant: false, alerts: ["🏕️ Homeless - FC Act Exempt"]`

### 4. At-Risk Vehicle
**Input:** Plate with 2 consecutive nights in 3-night max zone  
**Expected:**
- Creates observation (3rd night)
- Creates compliance_results (still compliant, but at risk)
- NO breach_alerts yet
- Response: `is_compliant: true, at_risk: true, alerts: ["🟡 AT RISK: Final night before breach"]`

### 5. Breach Detected
**Input:** Plate with 3 consecutive nights in 3-night max zone (4th scan)  
**Expected:**
- Creates observation (4th night)
- Creates compliance_results (is_compliant = false)
- Creates breach_alerts (breach_type: 'consecutive_nights')
- Response: `is_compliant: false, alerts: ["🔴 BREACH: Exceeded 3 consecutive nights"]`

---

## Advantages Over Old System

| Feature | Old System | New System |
|---------|------------|------------|
| Function Calls | 2 separate calls | 1 unified call |
| Error Handling | Complex cross-function | Simple try/catch |
| Transaction Safety | No guarantee | Single transaction |
| Dependencies | Relies on broken code | Fresh implementation |
| Debugging | Multiple logs to check | Single function log |
| Maintenance | Patching broken code | Clean codebase |
| Testing | Test 2 functions | Test 1 function |

---

## Success Metrics

After deployment, verify:
- ✅ Photos uploaded successfully (evidence bucket)
- ✅ ALPR detects plates (Plate Recognizer API)
- ✅ Canonical vehicles created/updated
- ✅ Observations created in observations
- ✅ Compliance_results auto-created by trigger
- ✅ Breach_alerts auto-created when non-compliant (excluding homeless)
- ✅ Monthly_stays updated by trigger
- ✅ Response includes correct status flags
- ✅ Queue displays results correctly

**Target:** 100% success rate for ALPR detection + observation creation

---

**Status:** Ready to deploy and test with real mobile device
