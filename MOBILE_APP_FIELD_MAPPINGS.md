# FreedomCamp Manager - Mobile App Field Mappings & Validation Rules

**Last Updated**: 2026-02-04  
**Purpose**: Reference document for React Native mobile app to validate data before submission

---

## 🔴 CRITICAL: Database CHECK Constraints

These are **hard validation rules** - the database will reject any values not in these lists.

### import_history.import_type
**Allowed Values:**
```
'vehicle_records'
'flagged_vehicles'
'observations'
'observation_migration'
'bulk_scan'
'homeless_data'
'manual_entry'
```

### import_history.status
**Allowed Values:**
```
'completed'
'failed'
'partial'
```

### investigation_jobs.job_type
**Standard Values** (recommended, but may allow others):
```
'Homeless Occupation'
'Abandoned Vehicle'
'Unauthorized Structure'
'Noise Complaint'
'Environmental Hazard'
'Welfare Check'
'Trespass'
'Other'
```

### health_safety_reports.severity
**Allowed Values:**
```
'low'
'medium'
'high'
'critical'
```

### enforcement_actions.action_type
**Allowed Values:**
```
'warning'
'notice'
'tow_request'
'follow_up'
```

### enforcement_actions.status
**Allowed Values:**
```
'pending'
'delivered'
'acknowledged'
'completed'
```

### enforcement_actions.breach_status
**Allowed Values:**
```
'active'
'assigned'
'in_progress'
'completed'
'not_on_site'
```

### incidents.status
**Allowed Values:**
```
'pending'
'resolved'
'escalated'
```

### incidents.severity
**Allowed Values:**
```
'low'
'medium'
'high'
```

### patrols.status
**Allowed Values:**
```
'scheduled'
'active'
'completed'
'cancelled'
```

### patrols.shift
**Allowed Values:**
```
'morning'
'afternoon'
'evening'
'night'
```

### zones.zone_type
**Allowed Values:**
```
'specific'
'general'
'temporary'
```

---

## 📋 Required Fields by Table

### vehicle_observations_v2 (Main Observation Entry)
**REQUIRED (NOT NULL):**
- `plate_number` (text) - Must be uppercase, alphanumeric only
- `recorded_at` (timestamp) - ISO 8601 format
- `organization_id` (uuid) - From user profile
- `zone_id` (uuid) - Must exist in zones table

**OPTIONAL (can be null):**
- `vehicle_make` (text)
- `vehicle_model` (text)
- `vehicle_year` (integer)
- `vehicle_color` (text)
- `self_contained` (boolean) - Use `null` if unknown, `false` if confirmed NO, `true` if confirmed YES
- `self_contained_expiry` (date)
- `photo` (text) - Storage URL
- `photo_hash` (text)
- `gps_latitude` (numeric)
- `gps_longitude` (numeric)
- `gps_accuracy` (numeric)
- `recorded_by` (uuid) - User ID
- `officer_notes` (text)
- `has_notes` (boolean) - Auto-set based on notes
- `has_hs_incident` (boolean) - Default false
- `has_incident` (boolean) - Default false
- `has_homeless_claim` (boolean) - Default false

**DEFAULTS:**
- `is_compliant`: `true` (triggers recalculate)
- `is_breach`: `false` (triggers recalculate)
- `created_at`: `now()`
- `updated_at`: `now()`

### incidents (Incident Reports)
**REQUIRED (NOT NULL):**
- `organization_id` (uuid)
- `zone_id` (uuid)
- `incident_type` (text) - Free text, but common values below
- `description` (text)
- `happened_at` (timestamp)

**OPTIONAL:**
- `user_id` (uuid) - Officer who created it
- `status` (text) - Default: 'pending'
- `severity` (text) - Default: 'medium'
- `gps_latitude` (numeric)
- `gps_longitude` (numeric)
- `gps_accuracy` (numeric)
- `photos` (text[]) - Array of storage URLs
- `photo_hashes` (text[]) - Array of SHA-256 hashes
- `photo_metadata_ids` (uuid[]) - Array of photo_metadata IDs
- `evidence_notes` (text)
- `court_ready` (boolean) - Default: false
- `homeless_status` (text) - 'claimed', 'confirmed', 'rejected', null
- `hs_issues` (boolean) - Default: false
- `issue_detected` (boolean) - Default: false
- `enforcement_required` (boolean) - Default: false

**Common incident_type values:**
```
'Anti-social Behaviour'
'Littering'
'Noise Complaint'
'Vandalism'
'Trespass'
'Property Damage'
'Safety Hazard'
'Other'
```

### health_safety_reports (H&S Reports)
**REQUIRED (NOT NULL):**
- `organization_id` (uuid)
- `zone_id` (uuid)
- `reported_by` (uuid)
- `details` (text)
- `severity` (text) - See CHECK constraint above

**OPTIONAL:**
- `patrol_id` (uuid)
- `status` (text) - Default: 'pending'
- `gps_latitude` (numeric)
- `gps_longitude` (numeric)
- `attachments` (jsonb) - Default: []

### enforcement_actions (Warnings/Notices/Tows)
**REQUIRED (NOT NULL):**
- `organization_id` (uuid)
- `user_id` (uuid) - Officer who created it
- `zone_id` (uuid)
- `action_type` (text) - See CHECK constraint above

**OPTIONAL:**
- `vehicle_record_id` (uuid)
- `plate_number` (text) - Auto-populated via trigger
- `observation_id` (uuid)
- `compliance_result_id` (uuid)
- `incident_id` (uuid)
- `delivery_method` (text)
- `recipient_name` (text)
- `recipient_email` (text)
- `gps_latitude` (numeric)
- `gps_longitude` (numeric)
- `notes` (text)
- `attachments` (jsonb) - Default: []
- `status` (text) - Default: 'pending'
- `breach_status` (text) - Default: 'active'

### patrols (Patrol Check-in/out)
**REQUIRED (NOT NULL):**
- `organization_id` (uuid)
- `zone_id` (uuid)
- `patrol_date` (date)
- `shift` (text) - See CHECK constraint above

**OPTIONAL:**
- `assigned_to` (uuid)
- `checked_in_at` (timestamp)
- `check_in_location_lat` (numeric)
- `check_in_location_lng` (numeric)
- `completed_at` (timestamp)
- `status` (text) - Default: 'scheduled'
- `notes` (text)

---

## 🔄 Data Transformations & Validation

### Plate Number Normalization
**Rule**: Always uppercase, remove all non-alphanumeric characters
```javascript
function normalizePlate(plate: string): string {
  return plate.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Examples:
"abc-123" → "ABC123"
"mzk 802" → "MZK802"
"425j9" → "425J9"
```

### Date/Time Formats
**recorded_at, happened_at, checked_in_at**: ISO 8601 with timezone
```javascript
// CORRECT:
"2026-02-04T14:30:00Z"           // UTC
"2026-02-04T14:30:00+12:00"      // NZST
"2026-02-04T14:30:00.123Z"       // With milliseconds

// WRONG:
"2026-02-04"                     // Missing time
"04/02/2026 2:30 PM"            // Wrong format
```

**patrol_date, self_contained_expiry**: Date only (YYYY-MM-DD)
```javascript
// CORRECT:
"2026-02-04"

// WRONG:
"04/02/2026"
"2026-02-04T00:00:00Z"
```

### GPS Coordinates
**Validation Rules:**
- `gps_latitude`: -90 to 90 (decimal degrees)
- `gps_longitude`: -180 to 180 (decimal degrees)
- `gps_accuracy`: Positive number in meters (0.0 to 999999.99)

**Precision**: Store as provided by device (up to 8 decimal places for lat/lng)

**New Zealand Bounds (Sanity Check):**
```javascript
const NZ_BOUNDS = {
  lat: { min: -47.5, max: -34.0 },  // Stewart Island to North Cape
  lng: { min: 166.0, max: 179.0 }   // West to East
};

function isValidNZCoordinate(lat: number, lng: number): boolean {
  return lat >= NZ_BOUNDS.lat.min && lat <= NZ_BOUNDS.lat.max &&
         lng >= NZ_BOUNDS.lng.min && lng <= NZ_BOUNDS.lng.max;
}
```

### Boolean Fields - Three-State Logic
For fields like `self_contained`:
- `true` = Officer confirmed vehicle IS self-contained
- `false` = Officer confirmed vehicle is NOT self-contained
- `null` = Unknown / Not checked / Historical data

**DO NOT** default unknown values to `false` - use `null` instead!

```javascript
// WRONG:
self_contained: false  // Implies "confirmed not self-contained"

// CORRECT (when unknown):
self_contained: null   // Indicates "not captured/unknown"
```

### Photo Handling
**File Upload Flow:**
1. Capture photo on device
2. Calculate SHA-256 hash of original file
3. Upload to Supabase Storage bucket `evidence` or `incident-evidence`
4. Store public URL in observation/incident
5. Store hash in `photo_hash` or `photo_hashes` array
6. Create `photo_metadata` record with:
   - `photo_url`
   - `photo_hash`
   - `file_name`
   - `bucket_name`
   - `storage_path`
   - `gps_latitude`, `gps_longitude` (from EXIF or device)
   - `captured_at` (from EXIF or device time)
   - `organization_id`, `user_id`
   - `photo_type`: 'full', 'plate', 'sticker', 'evidence'
   - `retention_policy`: 'standard', 'court_evidence', 'long_term'

**Storage Buckets:**
- `evidence` - General field photos (public bucket)
- `incident-evidence` - Court-ready evidence (private bucket, requires auth)

**Allowed MIME Types:**
```
image/jpeg
image/jpg
image/png
image/webp
application/pdf
```

---

## 🔗 Foreign Key Relationships

### Critical Dependencies
Before inserting records, ensure these foreign keys exist:

**organization_id** → `organizations.id`
- Get from authenticated user's profile: `user_profiles.organization_id`

**zone_id** → `zones.id`
- Must query zones table or use geofencing to detect
- Filter: `WHERE organization_id = ? AND is_active = true`

**user_id** / **recorded_by** / **reported_by** → `user_profiles.id`
- Get from auth: `supabase.auth.getUser().data.user.id`

**plate_number** → `canonical_vehicles.plate_number`
- Auto-created via database function `upsert_canonical_vehicle()`
- Mobile app should NOT manually insert into `canonical_vehicles`

**patrol_id** → `patrols.id`
- Get from active patrol session
- Query: `SELECT id FROM patrols WHERE assigned_to = ? AND status = 'active' ORDER BY checked_in_at DESC LIMIT 1`

---

## 📡 API Endpoint Reference

### Edge Functions (Use `supabase.functions.invoke()`)

#### process-field-scan
**Purpose**: Submit vehicle observation from field officer
**Method**: POST
**Body**:
```json
{
  "plate_number": "ABC123",
  "organization_id": "uuid",
  "zone_id": "uuid",
  "scan_mode": "field",
  "scanned_photo": "storage-url",
  "confidence_score": 0.95,
  "gps_latitude": -41.2705,
  "gps_longitude": 173.2840,
  "gps_accuracy": 5.0,
  "notes": "Officer notes here"
}
```

#### process-driving-scan
**Purpose**: Submit vehicle scan from driving mode (bulk scanning)
**Method**: POST
**Body**:
```json
{
  "plate_number": "ABC123",
  "organization_id": "uuid",
  "zone_id": "uuid",
  "scan_mode": "driving",
  "scanned_photo": "storage-url",
  "gps_latitude": -41.2705,
  "gps_longitude": 173.2840,
  "gps_accuracy": 5.0
}
```

#### recognize-plate
**Purpose**: ALPR plate recognition (Plate Recognizer API)
**Method**: POST
**Body**:
```json
{
  "image_base64": "base64-encoded-image"
}
```
**Returns**:
```json
{
  "plate": "ABC123",
  "confidence": 0.95,
  "region": "NZ"
}
```

#### analyze-vehicle-photo
**Purpose**: AI analysis of vehicle photos (stickers, make/model)
**Method**: POST
**Body**:
```json
{
  "image_url": "storage-url",
  "analysis_type": "self_contained_sticker"
}
```

#### send-push-notification
**Purpose**: Send push notification to specific user
**Method**: POST (admin only)
**Body**:
```json
{
  "user_id": "uuid",
  "title": "Notification title",
  "body": "Notification message",
  "data": {}
}
```

---

## 🚨 Common Validation Errors & Fixes

### Error: "violates check constraint"
**Cause**: Value not in allowed list (CHECK constraint)
**Fix**: Use exact values from constraint lists above

### Error: "violates foreign key constraint"
**Cause**: Referenced record doesn't exist (e.g., zone_id, organization_id)
**Fix**: Query parent table first to verify record exists

### Error: "violates not-null constraint"
**Cause**: Required field is null
**Fix**: Check required fields list above, provide valid value

### Error: "duplicate key value violates unique constraint"
**Cause**: Record already exists (e.g., duplicate patrol for same zone/date/shift)
**Fix**: Query first to check if record exists, update instead of insert

### Error: "mime type not supported"
**Cause**: Uploading file type not in allowed list
**Fix**: Only upload jpeg, jpg, png, webp, pdf files

---

## 🔐 Row Level Security (RLS) Policies

### What Mobile App Can Do:

**INSERT** (authenticated users):
- `vehicle_observations_v2` - ✅ Any authenticated user
- `incidents` - ✅ Any authenticated user
- `health_safety_reports` - ✅ Any authenticated user
- `enforcement_actions` - ✅ Any authenticated user (own org)
- `plate_scans` - ✅ Any authenticated user (own org)

**SELECT** (read):
- `vehicle_observations_v2` - ✅ Own organization OR master users see all
- `incidents` - ✅ Own organization OR master users see all
- `health_safety_reports` - ✅ Own organization OR master users see all
- `enforcement_actions` - ✅ Own organization OR master users see all
- `canonical_vehicles` - ✅ ALL users (for safety - flagged vehicle warnings)
- `flagged_vehicles` - ✅ ALL users (for safety)
- `zones` - ✅ Own organization OR master users see all
- `patrols` - ✅ Own organization OR master users see all

**UPDATE** (modify):
- `vehicle_observations_v2` - ❌ Immutable (admins only, within 24h)
- `incidents` - ✅ Own incidents only (officers), own org (admins)
- `enforcement_actions` - ✅ Own org (admins), assigned jobs (officers)
- `patrols` - ✅ Own patrols only

**DELETE**:
- ❌ Most tables: Super-delete permission only (`don.squire@firstsecurity.co.nz`)
- ⚠️ `vehicle_observations_v2`: Officers can delete own observations within 24 hours

---

## 📊 Offline Queue Structure

When offline, store operations in AsyncStorage queue:

```typescript
interface QueuedOperation {
  id: string;                    // UUID for queue item
  type: 'observation' | 'incident' | 'hs_report' | 'enforcement' | 'photo_upload';
  timestamp: string;             // ISO 8601
  data: any;                     // Full payload
  retry_count: number;           // Number of failed attempts
  last_error?: string;           // Last error message
  status: 'pending' | 'uploading' | 'failed';
}
```

**Upload Priority:**
1. Photos first (get storage URLs)
2. Core records (observations, incidents)
3. Metadata (photo_metadata records)
4. Related records (enforcement actions)

**Retry Logic:**
- Exponential backoff: 5s, 10s, 30s, 60s, 300s
- Max retries: 5
- After 5 failures: Mark as failed, require manual review

---

## ✅ Pre-Submission Checklist

Before calling Edge Functions or inserting into database:

- [ ] Plate number normalized (uppercase, alphanumeric only)
- [ ] Timestamps in ISO 8601 format with timezone
- [ ] GPS coordinates within valid range (-90 to 90, -180 to 180)
- [ ] Required fields all populated (NOT NULL fields)
- [ ] Status/enum fields match allowed values (CHECK constraints)
- [ ] Foreign keys exist (query first if needed)
- [ ] Photos uploaded to storage first (have URLs)
- [ ] Photo hashes calculated (SHA-256)
- [ ] Boolean fields use three-state logic (true/false/null)
- [ ] Organization ID from authenticated user profile
- [ ] User ID from authenticated session

---

## 🆘 Support

**Database Schema Changes**: Check `Backend Context` section in conversation history
**API Changes**: Check Edge Function code in `supabase/functions/` directory
**Validation Rules**: This document is the source of truth

**Last Schema Update**: 2026-02-04 (enforcement workflow, photo metadata, zone corrections)
