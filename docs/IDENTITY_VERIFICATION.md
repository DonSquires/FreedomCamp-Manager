# Identity Verification & Access Control System

## Overview

The Identity Verification system provides secure face recognition-based access control for restricted zones such as military bases, secure facilities, and controlled entry points.

## Features

### 1. Face Recognition Verification
- Compare live face capture against stored profile photos
- Uses AI-powered 384-D face embeddings for accurate matching
- Configurable confidence thresholds per zone
- **Multi-face detection** - Automatically detects and processes multiple faces in a single capture

### 2. Video Stream Monitoring
- Connect to IP cameras via HLS/DASH/MJPEG streams
- Live video feed monitoring
- Manual or automatic frame capture
- Configurable auto-capture intervals (2s to 60s)
- Real-time face detection from video feeds

### 3. Geofence-Restricted Verification
- Verification only works when the operator is inside the designated zone
- GPS-based location verification
- Prevents unauthorized remote access attempts

### 4. Side-by-Side Photo Comparison
- Pop-up verification cards with:
  - Captured photo and reference photo side-by-side
  - Match confidence percentage
  - Person details (name, badge number, clearance level)
  - Face detection metadata (age, gender estimates)
- Stacking cards for multiple pending verifications
- "No Match" cards for unknown persons requiring further verification

### 5. Incident Recording
- Create incidents directly from verification results
- Link incidents to person records and zones
- Incident types: no_match, denied_access, suspicious_activity, unauthorized_entry, etc.
- Severity levels: low, medium, high, critical
- Add additional evidence photos
- **Vehicle of Interest (VOI)** capture with automatic vehicle record creation

### 6. Access Statistics
- Real-time zone statistics dashboard
- Entry/exit/denial counts
- Incident tracking
- Unique person counts
- Average match confidence
- Recent incidents list

### 7. Access Permissions
- Grant time-based or permanent access to individuals
- Support for escort-required access
- Clearance level tracking (public, restricted, confidential, secret, top_secret)

### 8. Complete Audit Trail
- All verification attempts are logged
- Entry/exit/denied events recorded with timestamps
- Face photos captured during verification stored for audit
- Incidents linked to access entries

## Database Schema

### New Tables

#### `person_id_documents`
Stores ID document photos and verification status for person records.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| organization_id | uuid | Organization reference |
| person_record_id | uuid | Person reference |
| document_type | text | Type (drivers_license, passport, etc.) |
| document_number | text | Document number (encrypted) |
| front_photo_url | text | Front photo URL |
| back_photo_url | text | Back photo URL (optional) |
| is_verified | boolean | Verification status |
| verified_by | uuid | Verifying user |
| verified_at | timestamptz | Verification timestamp |

#### `access_entries`
Immutable log of all access control events.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| organization_id | uuid | Organization reference |
| zone_id | uuid | Zone reference |
| person_record_id | uuid | Person reference |
| entry_type | text | 'entry', 'exit', or 'denied' |
| verification_method | text | Method used for verification |
| face_match_confidence | real | Face match score (0-1) |
| face_match_passed | boolean | Whether face matched |
| gps_latitude | double | GPS coordinates |
| gps_longitude | double | GPS coordinates |
| inside_geofence | boolean | Was inside zone boundary |
| incident_id | uuid | Linked incident (if any) |
| created_at | timestamptz | Event timestamp |

#### `access_control_incidents`
Records incidents related to access control verifications.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| organization_id | uuid | Organization reference |
| zone_id | uuid | Zone reference |
| access_entry_id | uuid | Related access entry |
| person_record_id | uuid | Person reference |
| incident_type | text | Type of incident |
| severity | text | low, medium, high, critical |
| title | text | Incident title |
| description | text | Detailed description |
| verification_photo_url | text | Captured photo |
| reference_photo_url | text | Reference photo |
| face_match_similarity | real | Match confidence |
| evidence_photos | jsonb | Additional photos array |
| vehicle_id | uuid | Linked VOI vehicle |
| vehicle_plate | text | Vehicle plate number |
| vehicle_photo_url | text | Vehicle photo |
| status | text | open, investigating, resolved, etc. |
| created_at | timestamptz | Event timestamp |

#### `access_permissions`
Manages who can access which zones.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| person_record_id | uuid | Person reference |
| zone_id | uuid | Zone reference |
| permission_type | text | 'full_access', 'time_restricted', 'escort_required', 'denied' |
| valid_from | timestamptz | Permission start time |
| valid_until | timestamptz | Permission end time (null = permanent) |
| requires_escort | boolean | Escort requirement |
| time_restrictions | jsonb | Time-of-day restrictions |

### Modified Tables

#### `zones`
Added columns:
- `access_control_enabled` (boolean) - Enable access control for zone
- `access_control_config` (jsonb) - Configuration options

#### `person_records`
Added columns:
- `profile_photo_url` (text) - Primary verification photo
- `profile_photo_embedding` (real[]) - Face embedding for matching
- `access_clearance_level` (text) - Security clearance
- `access_badge_number` (text) - Badge/ID number
- `id_document_number` (text) - ID document reference

## Usage

### Enabling Access Control on a Zone

1. Go to Zone Management
2. Select a zone
3. Enable "Access Control" in zone settings
4. Configure:
   - Minimum face match confidence (default 75%)
   - Whether ID document is required
   - Any additional restrictions

### Adding a Person for Access

1. Go to Person Records
2. Create or edit a person record
3. Upload their profile photo (used for face matching)
4. Enter clearance level and badge number
5. Optionally upload ID documents

### Granting Access Permissions

1. Go to Access Control > Permissions
2. Select person and zone
3. Set permission type:
   - Full Access: No restrictions
   - Time Restricted: Only during specified hours
   - Escort Required: Must be accompanied
4. Set validity period (optional)

### Performing Identity Verification

1. Navigate to Identity Verification page
2. Select the access control zone
3. Search for the person by name or badge number
4. Capture their face with the camera
5. System compares against stored profile photo
6. If matched and permissions valid: ACCESS GRANTED
7. If not matched or no permission: ACCESS DENIED

## Security Considerations

1. **Geofence Requirement**: Verification can only be performed when the operator is physically inside the designated zone.

2. **Audit Trail**: All verification attempts are logged with:
   - Timestamp
   - GPS coordinates
   - Face photos
   - Match confidence scores
   - Operator ID

3. **Encrypted Storage**: Sensitive fields (ID numbers) are encrypted at rest in Supabase.

4. **RLS Policies**: All tables have Row Level Security enabled, restricting access to organization members only.

## API Reference

### RPC Functions

#### `verify_access_identity`
Performs identity verification.

```sql
SELECT verify_access_identity(
  p_person_record_id := 'uuid',
  p_zone_id := 'uuid',
  p_face_embedding := '{0.1, 0.2, ...}',
  p_gps_lat := -36.8509,
  p_gps_lng := 174.7645
);
```

Returns:
```json
{
  "success": true,
  "person": { "id": "...", "first_name": "...", ... },
  "verification": {
    "face_match_passed": true,
    "face_similarity": 0.92,
    "inside_geofence": true
  },
  "permission": {
    "has_permission": true,
    "permission_type": "full_access"
  },
  "access_granted": true
}
```

#### `log_access_entry`
Records an access control event.

```sql
SELECT log_access_entry(
  p_organization_id := 'uuid',
  p_zone_id := 'uuid',
  p_person_record_id := 'uuid',
  p_entry_type := 'entry',
  p_verification_method := 'face_only',
  p_face_match_confidence := 0.92,
  p_face_match_passed := true,
  ...
);
```

Returns: UUID of created entry

## Temporary Visitor Management

### Overview

The system supports short-term visitors whose data should only be retained for a specific period. Records can be automatically or manually deleted.

### Visitor Types

- `visitor` - General visitor
- `contractor` - Temporary contractor
- `vendor` - Delivery/service vendor
- `delivery` - Delivery personnel
- `event_attendee` - Event participant
- `other` - Other temporary access

### Data Retention

When creating a temporary visitor:
1. Set `is_temporary_visitor = true`
2. Set `data_retention_until` to the expiry date
3. Set `auto_delete_on_expiry = true` for automatic cleanup

### Automatic Cleanup

A scheduled job should call `cleanup_expired_visitor_records()` periodically:

```sql
-- Run daily via pg_cron or external scheduler
SELECT * FROM cleanup_expired_visitor_records(100);
```

This function:
1. Soft-deletes expired records (marks `deleted_at`)
2. Hard-deletes records that were soft-deleted 30+ days ago
3. Returns count and IDs of deleted records

### Manual Deletion

Authorized users can manually delete visitor records:

```sql
-- Soft delete (30-day grace period)
SELECT delete_visitor_with_data(
  p_person_record_id := 'uuid',
  p_reason := 'Visitor access no longer required',
  p_immediate := false
);

-- Immediate permanent deletion
SELECT delete_visitor_with_data(
  p_person_record_id := 'uuid',
  p_reason := 'Data protection request',
  p_immediate := true
);
```

### Authorization for Deletion

The following roles can delete visitor records:

| Role | Can Delete Own Org | Can Delete Any Org |
|------|-------------------|-------------------|
| grand_master | ✅ | ✅ |
| master | ✅ | ❌ |
| admin | ✅ | ❌ |
| admin_officer | ✅ | ❌ |

### Extending Retention

To extend a visitor's retention period:

```sql
SELECT extend_visitor_retention(
  p_person_record_id := 'uuid',
  p_new_retention_until := '2024-06-30T23:59:59Z',
  p_reason := 'Extended contract'
);
```

### Listing Expiring Visitors

To find visitors with expiring retention (within N days):

```sql
SELECT * FROM list_expiring_visitors(
  p_organization_id := 'uuid',
  p_days_until_expiry := 7
);
```

### What Gets Deleted

When a visitor record is deleted:

| Data Type | Soft Delete | Immediate Delete |
|-----------|-------------|------------------|
| Person record | Marked `deleted_at` | Deleted |
| Face records | Retained | Deleted |
| ID documents | Retained | Deleted |
| Access entries | Retained | Anonymized (person_id set to NULL) |
| Access permissions | Retained | Deleted |
| Visitor registrations | Retained | Deleted |

## Privacy & Compliance

### NZ Biometric Processing Privacy Code 2025

The system is designed to comply with New Zealand's Biometric Processing Privacy Code 2025 (effective November 2025):

1. **Necessity Test**: Only collect biometric data when necessary and proportionate
2. **Privacy Impact Assessment**: Document rationale for biometric use
3. **Transparency**: Inform individuals before collection
4. **Alternatives**: Offer non-biometric alternatives where possible
5. **Right to Erasure**: Delete biometric data on request

### GDPR Compliance (for international clients)

- **Explicit Consent**: `biometric_consents` table tracks consent for biometric processing
- **Article 9 Compliance**: Special category data handling for biometrics
- **Data Protection Impact Assessment**: Required before deployment
- **Right to Erasure**: `delete_visitor_with_data(immediate=true)`
- **Purpose Limitation**: Biometric data only used for stated access control purpose

### Biometric Consent Tracking

```sql
-- Record consent before processing biometric data
INSERT INTO biometric_consents (
  organization_id, person_record_id, consent_type,
  consent_given, data_purpose, data_retention_period,
  alternative_offered, alternative_description
) VALUES (
  'org-uuid', 'person-uuid', 'face_recognition',
  true, 'Facility access control verification',
  '2 years from last access',
  true, 'PIN code or badge-only access available on request'
);

-- Check consent before face verification
SELECT has_valid_biometric_consent('person-uuid', 'face_recognition');
```

### This system supports:

- **GDPR**: Right to erasure via `delete_visitor_with_data(immediate=true)`
- **Privacy Act 2020 (NZ)**: Data minimization via automatic retention periods
- **NZ Biometric Code 2025**: Consent tracking via `biometric_consents` table
- **Access Control Standards**: Complete audit trail retained even when visitor data is deleted

---

## Industry Standard Features

### Anti-Passback Enforcement

Prevents credential sharing by ensuring users cannot re-enter without first exiting:

```sql
-- Check anti-passback before granting entry
SELECT check_anti_passback('org-uuid', 'person-uuid', 'zone-uuid', 'entry');

-- Returns:
-- { "allowed": false, "reason": "already_inside", "violation": true, "violation_count": 1 }
```

#### Zone Configuration

| Setting | Description |
|---------|-------------|
| `anti_passback_enabled` | Enable/disable anti-passback |
| `anti_passback_timeout_minutes` | 0 = strict (must exit), >0 = timed reset |

### Tailgating Detection

Flag when someone follows another person through a door without authenticating:

- `tailgate_detection_enabled` zone setting
- `tailgate_detected` flag on access_entries
- Integration ready for AI/sensor-based detection systems

### Occupancy Limits

Track and enforce zone capacity:

```sql
-- Get current zone occupancy
SELECT get_zone_occupancy('zone-uuid');

-- Returns:
-- {
--   "zone_id": "...",
--   "current_occupancy": 45,
--   "max_occupancy": 50,
--   "at_capacity": false,
--   "occupancy_percentage": 90.0,
--   "persons_inside": [...]
-- }
```

### Multi-Factor Authentication (MFA)

Support for multiple authentication factors:

| Factor | Description |
|--------|-------------|
| Badge/Card | RFID, NFC, or mobile credential |
| Biometric | Face, fingerprint, iris, palm, voice |
| PIN | Knowledge-based verification |

MFA attempts are logged in `access_mfa_log` for audit.

### Watchlist Screening

Screen visitors against blocked, restricted, and alert lists:

```sql
-- Check if person is on any watchlist
SELECT * FROM check_access_watchlist('org-uuid', 'person-uuid');

-- Returns matches with list_type: blocked, restricted, alert, vip, terminated, court_order, etc.
```

#### Watchlist Types

| Type | Action |
|------|--------|
| `blocked` | Deny access completely |
| `restricted` | Allow with escort only |
| `alert` | Allow but notify security |
| `vip` | Fast-track access |
| `terminated` | Former employee - revoked |
| `court_order` | Legal restriction |

### Credential Management

Manage physical and mobile credentials:

| Credential Type | Description |
|----------------|-------------|
| `proximity_card` | 125kHz RFID |
| `smart_card` | 13.56MHz (MIFARE, DESFire) |
| `nfc_mobile` | NFC phone credential |
| `ble_mobile` | Bluetooth phone credential |
| `key_fob` | Key fob |
| `pin_code` | PIN only |
| `qr_code` | QR code badge |

### Emergency Evacuation Support

Real-time headcount and roll call during emergencies:

```sql
-- Initiate evacuation
SELECT initiate_emergency_evacuation(
  'org-uuid',
  'fire',
  'Building A Fire Alarm',
  ARRAY['zone1-uuid', 'zone2-uuid']::uuid[],
  'Fire alarm activated in Building A'
);

-- Get evacuation status with headcount
SELECT get_evacuation_status('event-uuid');

-- Returns summary:
-- {
--   "summary": {
--     "total": 50,
--     "evacuated": 45,
--     "unaccounted": 3,
--     "missing": 1,
--     "requires_assistance": 1
--   },
--   "unaccounted_persons": [...]
-- }
```

### Hardware Integration Readiness

The system is designed for integration with physical access control hardware:

| Field | Purpose |
|-------|---------|
| `reader_id` | Physical reader device ID |
| `door_id` | Door/portal identifier |
| `credential_number` | Card/badge number |
| `facility_code` | Wiegand facility code |

#### Supported Protocols

- **OSDP** (Recommended): Encrypted, bi-directional, IEC 60839-11-5 compliant
- **Wiegand** (Legacy): One-way, unencrypted, for existing systems

---

## New Database Tables

### biometric_consents
Tracks explicit consent for biometric data processing (NZ Biometric Code 2025 / GDPR compliance).

### access_watchlist
Blocked, restricted, alert, and VIP lists for access screening.

### access_credentials
Physical and mobile credentials (RFID, NFC, mobile, PIN).

### access_location_state
Real-time entry/exit tracking for anti-passback enforcement.

### access_mfa_log
Multi-factor authentication audit trail.

### emergency_events
Emergency evacuation events.

### evacuation_roll_call
Roll call status during emergency evacuations.

---

## API Reference (Additional Functions)

### has_valid_biometric_consent
Check if person has given valid consent for biometric processing.

```sql
SELECT has_valid_biometric_consent('person-uuid', 'face_recognition');
-- Returns: true/false
```

### check_access_watchlist
Check if person is on any watchlist.

```sql
SELECT * FROM check_access_watchlist('org-uuid', 'person-uuid');
```

### check_anti_passback
Validate entry/exit complies with anti-passback rules.

```sql
SELECT check_anti_passback('org-uuid', 'person-uuid', 'zone-uuid', 'entry');
```

### update_access_location_state
Update location tracking after access event.

```sql
SELECT update_access_location_state('org-uuid', 'person-uuid', 'zone-uuid', 'entry', 'entry-uuid');
```

### get_zone_occupancy
Get current zone occupancy with person list.

```sql
SELECT get_zone_occupancy('zone-uuid');
```

### initiate_emergency_evacuation
Start emergency evacuation and create roll call.

```sql
SELECT initiate_emergency_evacuation('org-uuid', 'fire', 'Fire Alarm', ARRAY['zone-uuid']::uuid[]);
```

### get_evacuation_status
Get evacuation headcount and status.

```sql
SELECT get_evacuation_status('event-uuid');
```
