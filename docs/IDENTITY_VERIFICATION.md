# Identity Verification & Access Control System

## Overview

The Identity Verification system provides secure face recognition-based access control for restricted zones such as military bases, secure facilities, and controlled entry points.

## Features

### 1. Face Recognition Verification
- Compare live face capture against stored profile photos
- Uses AI-powered 384-D face embeddings for accurate matching
- Configurable confidence thresholds per zone

### 2. Geofence-Restricted Verification
- Verification only works when the operator is inside the designated zone
- GPS-based location verification
- Prevents unauthorized remote access attempts

### 3. Access Permissions
- Grant time-based or permanent access to individuals
- Support for escort-required access
- Clearance level tracking (public, restricted, confidential, secret, top_secret)

### 4. Complete Audit Trail
- All verification attempts are logged
- Entry/exit/denied events recorded with timestamps
- Face photos captured during verification stored for audit

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

This system supports:

- **GDPR**: Right to erasure via `delete_visitor_with_data(immediate=true)`
- **Privacy Act 2020 (NZ)**: Data minimization via automatic retention periods
- **Access Control Standards**: Complete audit trail retained even when visitor data is deleted
