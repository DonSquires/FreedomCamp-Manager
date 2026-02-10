# FreedomCamp Manager - Database & Architecture Documentation

**Version:** 1.0  
**Last Updated:** January 26, 2026  
**Database Provider:** Supabase PostgreSQL  
**Project ID:** xbfnlzmpumthnjmtqufp

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Technology Stack](#technology-stack)
3. [Database Schema](#database-schema)
4. [Security & Access Control](#security--access-control)
5. [Storage Buckets](#storage-buckets)
6. [Edge Functions](#edge-functions)
7. [Key Features & Workflows](#key-features--workflows)

---

## System Overview

FreedomCamp Manager is a comprehensive vehicle tracking and compliance management system for Nelson City Council. The system enables patrol officers to:

- Verify vehicles through plate scanning (ALPR + AI OCR)
- Track compliance with zone-based overnight parking limits
- Manage enforcement actions and incidents
- Conduct real-time patrol operations in handheld or driving mode
- Generate court-ready PDF reports with evidence integrity
- Monitor homeless vehicle status with compassionate exemptions

### Core Architectural Patterns

- **Canonical Vehicle Architecture**: One global record per plate number across all zones/organizations
- **Compliance Matrix Versioning**: Historical tracking of rule changes with drift detection
- **Evidence Integrity**: SHA-256 hashing, GPS metadata, photo retention policies
- **Centralized Compliance Engine**: Single source of truth via PostgreSQL function

---

## Technology Stack

### Frontend
- React 18 + TypeScript
- Vite (build tool)
- Tailwind CSS + shadcn/ui components
- Leaflet (geofencing & maps)
- Recharts (data visualization)
- Zustand (state management)

### Backend
- Supabase PostgreSQL (database)
- Row Level Security (RLS) policies
- Deno Edge Functions (serverless)
- Real-time subscriptions
- Materialized views for reporting

### Authentication
- Supabase Auth
- Role-based access control (master/admin/officer)
- WebAuthn biometric authentication support

### Third-Party Services
- Plate Recognizer ANPR (primary plate recognition)
- OnSpace AI (fallback OCR + image analysis)
- Stripe (payments - optional)

---

## Database Schema

### Core Tables (30 total)

#### 1. User Management

##### `user_profiles`
**Purpose:** User accounts linked to Supabase Auth  
**Primary Key:** `id` (UUID)  
**Key Columns:**
- `organization_id` (UUID) - FK to organizations
- `email` (TEXT, UNIQUE) - User email
- `first_name`, `last_name` (TEXT) - User name
- `role` (TEXT) - 'master', 'admin', or 'officer'
- `permissions` (JSONB) - Array of permission strings
- `organization_ids` (UUID[]) - Multi-org support for master users
- `is_active` (BOOLEAN)

**Foreign Keys:**
- `id` → `auth.users.id` (ON DELETE CASCADE)
- `organization_id` → `organizations.id` (ON DELETE SET NULL)

**RLS Policies:**
- Users can view/update own profile
- Admins/masters can manage other profiles in their org
- Service role has full access

---

##### `organizations`
**Purpose:** Client organizations (e.g., Nelson City Council)  
**Primary Key:** `id` (UUID)  
**Key Columns:**
- `name` (TEXT) - Organization name
- `contact_email`, `contact_phone` (TEXT)
- `is_active` (BOOLEAN)

**RLS Policies:**
- Users can view own organization
- Only master users can create/modify organizations

---

#### 2. Zone & Compliance Management

##### `zones`
**Purpose:** Patrol zones with parking rules  
**Primary Key:** `id` (UUID)  
**Key Columns:**
- `organization_id` (UUID) - FK to organizations
- `name` (TEXT) - Zone name (e.g., "Akertson Street - Marina")
- `description` (TEXT)
- `self_contained_required` (BOOLEAN) - Must have self-contained sticker
- `nights_per_month` (INTEGER, default: 28) - Maximum nights per calendar month
- `max_consecutive_nights` (INTEGER, default: 3) - Maximum consecutive nights
- `day_visit_only` (BOOLEAN) - No overnight parking allowed
- `allowed_days` (JSONB) - Array of allowed weekdays
- `geometry` (JSONB) - GeoJSON polygon for geofencing
- `location_lat`, `location_lng` (NUMERIC) - Zone center coordinates
- `is_active` (BOOLEAN)
- `merged_into_zone_id` (UUID) - Zone consolidation support

**Foreign Keys:**
- `organization_id` → `organizations.id` (ON DELETE CASCADE)
- `merged_into_zone_id` → `zones.id` (ON DELETE SET NULL)

**Unique Constraint:** `organization_id + name`

**RLS Policies:**
- Users can view zones in their organization
- Admins/masters can create/modify zones

---

##### `zone_compliance_matrix`
**Purpose:** Versioned compliance criteria history per zone  
**Primary Key:** `id` (UUID)  
**Key Columns:**
- `zone_id` (UUID) - FK to zones
- `organization_id` (UUID) - FK to organizations
- `version` (INTEGER) - Incrementing version number
- `effective_from`, `effective_to` (TIMESTAMPTZ) - Version validity period
- `self_contained_required` (BOOLEAN)
- `nights_per_month`, `max_consecutive_nights` (INTEGER)
- `day_visit_only` (BOOLEAN)
- `allowed_days` (JSONB)
- `homeless_exemption` (BOOLEAN)
- `created_by` (UUID) - FK to user_profiles
- `change_reason`, `change_notes` (TEXT) - Audit trail

**Foreign Keys:**
- `zone_id` → `zones.id` (ON DELETE CASCADE)
- `organization_id` → `organizations.id` (ON DELETE CASCADE)
- `created_by` → `user_profiles.id`

**Unique Constraint:** `zone_id + version`

**Indices:**
- `idx_zcm_zone`, `idx_zcm_org`, `idx_zcm_version`, `idx_zcm_effective`

**RLS Policies:**
- Users can view matrix for org zones
- Admins/masters can create/modify matrix versions

---

#### 3. Vehicle Management

##### `canonical_vehicles`
**Purpose:** Global vehicle registry - one record per plate number  
**Primary Key:** `vehicle_id` (UUID)  
**Key Columns:**
- `plate_number` (TEXT, UNIQUE) - License plate (global unique)
- `vehicle_make`, `vehicle_model`, `vehicle_color` (TEXT)
- `first_seen_at`, `last_seen_at` (TIMESTAMPTZ)
- `total_observations` (INTEGER) - Count of sightings
- `is_homeless` (BOOLEAN) - Self-declared homeless status
- `homeless_confirmed` (BOOLEAN) - Admin-verified homeless status
- `homeless_confirmed_by` (UUID) - FK to user_profiles
- `homeless_confirmed_at` (TIMESTAMPTZ)
- `homeless_notes` (TEXT)
- `is_flagged` (BOOLEAN) - Safety concern flag
- `flagged_priority` (TEXT) - 'low', 'medium', 'high', 'urgent'
- `flagged_reason`, `flagged_notes` (TEXT)
- `flagged_at` (TIMESTAMPTZ)
- `flagged_by` (UUID) - FK to user_profiles

**Foreign Keys:**
- `homeless_confirmed_by` → `user_profiles.id` (ON DELETE SET NULL)
- `flagged_by` → `user_profiles.id` (ON DELETE SET NULL)

**Indices:**
- `idx_canonical_vehicles_plate`, `idx_canonical_vehicles_homeless`, `idx_canonical_vehicles_flagged`

**RLS Policies:**
- All officers can view (read-only for safety)
- Admins/masters can manage canonical vehicles

---

##### `vehicle_observations`
**Purpose:** All vehicle sightings with full provenance  
**Primary Key:** `observation_id` (UUID)  
**Key Columns:**
- `vehicle_id` (UUID) - FK to canonical_vehicles
- `organization_id` (UUID) - FK to organizations
- `zone_id` (UUID) - FK to zones
- `recorded_by` (UUID) - FK to user_profiles
- `recorded_at` (TIMESTAMPTZ) - Sighting timestamp
- `source_type` (TEXT) - 'patrol', 'driving_scan', 'manual'
- `is_self_contained` (BOOLEAN)
- `is_compliant` (BOOLEAN) - Deprecated (use compliance_results)
- `gps_latitude`, `gps_longitude`, `gps_accuracy` (NUMERIC)
- `evidence_photos` (JSONB) - Array of photo URLs
- `notes` (TEXT)
- `original_record_id` (UUID) - Link to legacy vehicle_records

**Foreign Keys:**
- `vehicle_id` → `canonical_vehicles.vehicle_id` (ON DELETE CASCADE)
- `organization_id` → `organizations.id` (ON DELETE CASCADE)
- `zone_id` → `zones.id` (ON DELETE CASCADE)
- `recorded_by` → `user_profiles.id` (ON DELETE SET NULL)

**Indices:**
- `idx_observations_vehicle`, `idx_observations_zone`, `idx_observations_org`, `idx_observations_recorded_at`

**RLS Policies:**
- Users can view observations in their org
- Officers can create observations
- Admins can edit org observations (24hr window for officers)

---

##### `compliance_results`
**Purpose:** Compliance evaluations linked to matrix versions  
**Primary Key:** `id` (UUID)  
**Key Columns:**
- `observation_id` (UUID) - FK to vehicle_observations
- `vehicle_id` (UUID) - FK to canonical_vehicles
- `zone_id` (UUID) - FK to zones
- `organization_id` (UUID) - FK to organizations
- `matrix_id` (UUID) - FK to zone_compliance_matrix
- `matrix_version` (INTEGER) - Snapshot of version
- `is_compliant` (BOOLEAN) - Compliance verdict
- `violation_reasons` (TEXT[]) - Array of violation types
- `metrics_json` (JSONB) - Detailed compliance metrics
- `matrix_snapshot` (JSONB) - Full matrix criteria at evaluation time
- `evaluated_at` (TIMESTAMPTZ)

**Foreign Keys:**
- `observation_id` → `vehicle_observations.observation_id` (ON DELETE CASCADE)
- `vehicle_id` → `canonical_vehicles.vehicle_id` (ON DELETE CASCADE)
- `zone_id` → `zones.id` (ON DELETE CASCADE)
- `organization_id` → `organizations.id` (ON DELETE CASCADE)
- `matrix_id` → `zone_compliance_matrix.id`

**Unique Constraint:** `observation_id + matrix_id`

**Indices:**
- `idx_compliance_results_observation`, `idx_compliance_results_vehicle`, `idx_compliance_results_zone`, `idx_compliance_results_matrix`

**RLS Policies:**
- Users can view compliance results in their org
- System can insert compliance results

---

##### `vehicle_records` (Legacy)
**Purpose:** Original vehicle records table - being phased out  
**Primary Key:** `id` (UUID)  
**Note:** This table is maintained for backward compatibility. New records create both a canonical_vehicle entry and a vehicle_observation entry. Contains similar fields to vehicle_observations plus:
- `homeless_claimed`, `homeless_confirmed` (BOOLEAN)
- `behavioral_flags` (JSONB) - Officer safety flags
- `requires_followup`, `followup_reason`, `followup_priority` (TEXT)
- `plate_input_method` (TEXT) - 'ocr', 'manual', 'auto_populated'

---

#### 4. Enforcement & Incidents

##### `enforcement_actions`
**Purpose:** Warnings, notices, and tow requests issued  
**Primary Key:** `id` (UUID)  
**Key Columns:**
- `organization_id` (UUID) - FK to organizations
- `user_id` (UUID) - FK to user_profiles (issuing officer)
- `vehicle_record_id` (UUID) - FK to vehicle_records
- `zone_id` (UUID) - FK to zones
- `incident_id` (UUID) - FK to incidents (optional)
- `action_type` (TEXT) - 'warning', 'notice', 'tow_request', 'breach_notice', 'infringement', 'verbal_warning', 'no_action_homeless', 'no_action'
- `delivery_method` (TEXT) - 'in_person', 'email', 'windscreen'
- `recipient_name`, `recipient_email` (TEXT)
- `location_lat`, `location_lng` (NUMERIC)
- `notes` (TEXT)
- `attachments` (JSONB) - Photos/documents
- `status` (TEXT) - 'pending', 'delivered', 'acknowledged'
- `delivered_at`, `acknowledged_at` (TIMESTAMPTZ)

**Foreign Keys:**
- `organization_id` → `organizations.id` (ON DELETE CASCADE)
- `user_id` → `user_profiles.id` (ON DELETE CASCADE)
- `vehicle_record_id` → `vehicle_records.id` (ON DELETE CASCADE)
- `zone_id` → `zones.id` (ON DELETE CASCADE)
- `incident_id` → `incidents.id` (ON DELETE SET NULL)

**RLS Policies:**
- Users can insert enforcement actions in their org
- Org users can view enforcement actions
- Admins can update enforcement actions

---

##### `incidents`
**Purpose:** Enhanced incident reports with court-ready features  
**Primary Key:** `id` (UUID)  
**Key Columns:**
- `organization_id` (UUID) - FK to organizations
- `user_id` (UUID) - FK to user_profiles (reporting officer)
- `zone_id` (UUID) - FK to zones
- `vehicle_id` (UUID) - FK to canonical_vehicles
- `enforcement_action_id` (UUID) - FK to enforcement_actions
- `incident_type` (TEXT) - Type of incident
- `description` (TEXT) - Detailed description
- `status` (TEXT) - 'pending', 'resolved', 'escalated'
- `severity` (TEXT) - 'low', 'medium', 'high', 'critical'
- `resolution_notes` (TEXT)
- `resolved_by` (UUID) - FK to user_profiles
- `gps_latitude`, `gps_longitude`, `gps_accuracy` (NUMERIC)
- `photos` (TEXT[]) - Array of photo URLs
- `photo_hashes` (TEXT[]) - SHA-256 hashes for evidence integrity
- `photo_metadata_ids` (UUID[]) - FK to photo_metadata
- `happened_at` (TIMESTAMPTZ) - Incident occurrence time
- `court_ready` (BOOLEAN) - Approved for legal proceedings
- `approved_by` (UUID) - FK to user_profiles
- `approved_at` (TIMESTAMPTZ)
- `evidence_notes` (TEXT)
- `homeless_status` (TEXT) - 'claimed', 'confirmed', 'none'
- `hs_issues` (BOOLEAN) - Health & safety concerns
- `issue_detected` (BOOLEAN) - Generic issue flag
- `enforcement_required` (BOOLEAN) - Requires enforcement action

**Foreign Keys:** (multiple - see above)

**Indices:**
- `idx_incidents_org`, `idx_incidents_zone`, `idx_incidents_status`, `idx_incidents_severity`, `idx_incidents_homeless_status`, `idx_incidents_issue_detected`, `idx_incidents_enforcement_required`

**RLS Policies:**
- Officers can create incidents in their org
- Officers can update own incidents (if not court-ready)
- Admins can manage all incidents in org
- All officers can view incidents (for safety)

---

##### `incident_vehicles`
**Purpose:** Multiple vehicles associated with a single incident  
**Primary Key:** `id` (UUID)  
**Key Columns:**
- `incident_id` (UUID) - FK to incidents
- `vehicle_id` (UUID) - FK to canonical_vehicles
- `vehicle_role` (TEXT) - 'primary', 'secondary', 'witness'
- `notes` (TEXT)

**Unique Constraint:** `incident_id + vehicle_id`

**RLS Policies:**
- Users can manage incident vehicles if they can manage the incident

---

##### `incident_persons`
**Purpose:** Persons involved in incidents  
**Primary Key:** `id` (UUID)  
**Key Columns:**
- `incident_id` (UUID) - FK to incidents
- `person_name` (TEXT)
- `person_role` (TEXT) - 'offender', 'witness', 'victim', 'contact'
- `contact_email`, `contact_phone` (TEXT)
- `id_verified` (BOOLEAN)
- `notes` (TEXT)

**RLS Policies:**
- Users can manage incident persons if they can manage the incident

---

##### `incident_actions`
**Purpose:** Audit trail for incident changes and approvals  
**Primary Key:** `id` (UUID)  
**Key Columns:**
- `incident_id` (UUID) - FK to incidents
- `action_type` (TEXT) - 'created', 'updated', 'approved', 'rejected'
- `performed_by` (UUID) - FK to user_profiles
- `changes` (JSONB) - Changed fields
- `notes` (TEXT)
- `timestamp` (TIMESTAMPTZ)

**RLS Policies:**
- System can insert actions
- Users can view actions for incidents they can view

---

#### 5. Photo & Evidence Management

##### `photo_metadata`
**Purpose:** Tracks all uploaded photos with retention policies  
**Primary Key:** `id` (UUID)  
**Key Columns:**
- `photo_url` (TEXT, UNIQUE) - Full URL to photo
- `file_name` (TEXT)
- `bucket_name`, `storage_path` (TEXT) - Storage location
- `photo_hash` (TEXT) - SHA-256 hash for integrity
- `photo_type` (TEXT) - 'full', 'cropped', 'thumbnail'
- `file_size_bytes`, `width`, `height` (INTEGER)
- `mime_type` (TEXT)
- `organization_id` (UUID) - FK to organizations
- `user_id` (UUID) - FK to user_profiles (uploader)
- `incident_id` (UUID) - FK to incidents
- `vehicle_record_id` (UUID) - FK to vehicle_records
- `observation_id` (UUID) - FK to vehicle_observations
- `retention_policy` (TEXT) - 'standard', 'extended', 'permanent'
- `court_ready` (BOOLEAN) - Protected from auto-deletion
- `delete_after_days` (INTEGER, default: 90)
- `scheduled_deletion_at` (TIMESTAMPTZ)
- `gps_latitude`, `gps_longitude`, `gps_accuracy` (NUMERIC)
- `captured_at` (TIMESTAMPTZ) - Photo capture time
- `uploaded_at` (TIMESTAMPTZ)
- `deleted_at` (TIMESTAMPTZ)

**Foreign Keys:** (multiple - see above)

**Indices:**
- `idx_photo_metadata_hash`, `idx_photo_metadata_org`, `idx_photo_metadata_user`, `idx_photo_metadata_incident`, `idx_photo_metadata_retention`, `idx_photo_metadata_scheduled_deletion`, `idx_photo_metadata_court_ready`

**Triggers:**
- `trigger_set_scheduled_deletion` - Auto-calculate deletion date

**RLS Policies:**
- Users can insert photos
- Users can view photos in their org
- Admins can manage photo metadata

---

##### `photo_retention_policies`
**Purpose:** Configurable retention policies per organization  
**Primary Key:** `id` (UUID)  
**Key Columns:**
- `organization_id` (UUID) - FK to organizations
- `policy_name` (TEXT)
- `policy_type` (TEXT) - 'standard', 'extended', 'permanent'
- `delete_after_days` (INTEGER)
- `applies_to_photo_type` (TEXT[]) - Array of photo types
- `exclude_court_ready` (BOOLEAN, default: true)
- `is_active` (BOOLEAN)

**Unique Constraint:** `organization_id + policy_name`

**RLS Policies:**
- Admins can manage retention policies
- Users can view org retention policies

---

#### 6. Patrol Management

##### `patrols`
**Purpose:** Scheduled patrol shifts  
**Primary Key:** `id` (UUID)  
**Key Columns:**
- `organization_id` (UUID) - FK to organizations
- `zone_id` (UUID) - FK to zones
- `patrol_date` (DATE)
- `shift` (TEXT) - 'morning', 'afternoon', 'evening', 'night'
- `assigned_to` (UUID) - FK to user_profiles
- `checked_in_at` (TIMESTAMPTZ)
- `check_in_location_lat`, `check_in_location_lng` (NUMERIC)
- `completed_at` (TIMESTAMPTZ)
- `status` (TEXT) - 'scheduled', 'active', 'completed', 'cancelled'
- `notes` (TEXT)

**Unique Constraint:** `zone_id + patrol_date + shift`

**RLS Policies:**
- Admins can manage patrols
- Users can view patrols in their org

---

##### `plate_scans`
**Purpose:** Bulk plate scans from driving mode - requires admin review  
**Primary Key:** `id` (UUID)  
**Key Columns:**
- `organization_id` (UUID) - FK to organizations
- `zone_id` (UUID) - FK to zones
- `scanned_by` (UUID) - FK to user_profiles
- `plate_number` (TEXT)
- `scan_mode` (TEXT) - 'driving', 'handheld'
- `scanned_photo` (TEXT) - Photo URL
- `confidence_score` (NUMERIC)
- `gps_latitude`, `gps_longitude`, `gps_accuracy` (NUMERIC)
- `ai_vehicle_make`, `ai_vehicle_model`, `ai_vehicle_color` (TEXT)
- `ai_likely_self_contained` (BOOLEAN)
- `ai_detected_stickers` (JSONB) - Array of detected stickers
- `reviewed` (BOOLEAN)
- `reviewed_by` (UUID) - FK to user_profiles
- `reviewed_at` (TIMESTAMPTZ)
- `review_notes` (TEXT)
- `review_action` (TEXT) - 'approve', 'reject', 'flag'
- `flagged_vehicle_detected`, `breach_detected` (BOOLEAN)
- `violation_summary` (TEXT)
- `vehicle_record_id` (UUID) - FK to vehicle_records (if converted)
- `converted_to_record` (BOOLEAN)
- `scanned_at` (TIMESTAMPTZ)

**Indices:**
- `idx_plate_scans_org`, `idx_plate_scans_zone`, `idx_plate_scans_plate`, `idx_plate_scans_scanned_by`, `idx_plate_scans_reviewed`, `idx_plate_scans_scan_mode`, `idx_plate_scans_scanned_at`

**RLS Policies:**
- Users can insert scans
- Users can view own scans
- Admins can view/update org scans
- Officers can update own scans (if not reviewed)

---

#### 7. Investigation & Reporting

##### `investigation_jobs`
**Purpose:** Investigation jobs for homeless occupation, abandoned vehicles  
**Primary Key:** `id` (UUID)  
**Key Columns:**
- `organization_id` (UUID) - FK to organizations
- `reference_number` (TEXT) - Unique job reference
- `job_type` (TEXT) - 'homeless_occupation', 'abandoned_vehicle', 'unauthorized_structure'
- `location_address` (TEXT)
- `property_details` (TEXT)
- `gps_latitude`, `gps_longitude` (NUMERIC)
- `briefing_notes`, `instructions` (TEXT)
- `client_name`, `client_reference` (TEXT)
- `assigned_to` (UUID) - FK to user_profiles
- `assigned_at` (TIMESTAMPTZ)
- `assigned_by` (UUID) - FK to user_profiles
- `status` (TEXT) - 'pending', 'assigned', 'in_progress', 'completed', 'cancelled'
- `priority` (TEXT) - 'low', 'medium', 'high', 'urgent'
- `due_date` (DATE)
- `created_by` (UUID) - FK to user_profiles
- `completed_at` (TIMESTAMPTZ)
- `completed_by` (UUID) - FK to user_profiles
- `vehicle_id` (UUID) - FK to canonical_vehicles

**Unique Constraint:** `organization_id + reference_number`

**RLS Policies:**
- Admins can create/update jobs
- Officers can view org jobs
- Officers can update assigned jobs

---

##### `investigation_findings`
**Purpose:** Field officer findings and completion reports  
**Primary Key:** `id` (UUID)  
**Key Columns:**
- `job_id` (UUID) - FK to investigation_jobs
- `visit_date` (TIMESTAMPTZ)
- `arrived_at`, `departed_at` (TIMESTAMPTZ)
- `findings_summary` (TEXT)
- `structures_found`, `vehicles_found` (TEXT)
- `persons_contacted` (JSONB) - Array of person objects
- `evidence_photos`, `vehicle_photos`, `structure_photos` (TEXT[])
- `recommendations`, `officer_notes` (TEXT)
- `follow_up_required` (BOOLEAN)
- `follow_up_notes` (TEXT)
- `weather_conditions`, `access_notes` (TEXT)
- `completed_at` (TIMESTAMPTZ)
- `completed_by` (UUID) - FK to user_profiles

**RLS Policies:**
- Officers can create findings for assigned jobs
- Officers can update own findings
- Users can view findings for org jobs

---

##### `investigation_attachments`
**Purpose:** Documents and files attached to investigation jobs  
**Primary Key:** `id` (UUID)  
**Key Columns:**
- `job_id` (UUID) - FK to investigation_jobs
- `file_url` (TEXT)
- `file_name`, `file_type` (TEXT)
- `file_size` (INTEGER)
- `uploaded_by` (UUID) - FK to user_profiles
- `uploaded_at` (TIMESTAMPTZ)

**RLS Policies:**
- Users can upload attachments to org jobs
- Users can view attachments for org jobs

---

#### 8. Flagged Vehicles & Breaches

##### `flagged_vehicles`
**Purpose:** Known problem vehicles requiring attention  
**Primary Key:** `id` (UUID)  
**Key Columns:**
- `organization_id` (UUID) - FK to organizations
- `plate_number` (TEXT)
- `last_known_site` (TEXT)
- `date_recorded` (DATE)
- `vehicle_description` (TEXT)
- `name_contact` (TEXT)
- `confirmed_homeless` (BOOLEAN)
- `notes` (TEXT)
- `priority` (TEXT) - 'low', 'medium', 'high', 'urgent'
- `is_active` (BOOLEAN)
- `created_by` (UUID) - FK to user_profiles

**Unique Constraint:** `organization_id + plate_number`

**RLS Policies:**
- Admins can manage flagged vehicles
- All officers can view active flagged vehicles (safety)
- Org users can view flagged vehicles

---

##### `breach_alerts`
**Purpose:** Automated breach notifications  
**Primary Key:** `id` (UUID)  
**Key Columns:**
- `organization_id` (UUID) - FK to organizations
- `patrol_id` (UUID) - FK to patrols
- `vehicle_record_id` (UUID) - FK to vehicle_records
- `zone_id` (UUID) - FK to zones
- `breach_type` (TEXT) - 'consecutive_nights', 'monthly_limit', 'day_visit_breach'
- `breach_details` (JSONB) - Additional breach info
- `due_date` (DATE)
- `notification_sent` (BOOLEAN)
- `notification_method` (TEXT) - 'email', 'sms', 'in_app'
- `notified_at` (TIMESTAMPTZ)
- `notified_by` (UUID) - FK to user_profiles
- `status` (TEXT) - 'pending', 'notified', 'resolved', 'escalated'
- `resolution_notes` (TEXT)
- `resolved_at` (TIMESTAMPTZ)

**RLS Policies:**
- Users can view breach alerts in their org
- Users can manage breach alerts

---

#### 9. Drift Detection & Recalculation

##### `drift_events`
**Purpose:** Tracks compliance drift when matrix criteria change  
**Primary Key:** `id` (UUID)  
**Key Columns:**
- `zone_id` (UUID) - FK to zones
- `organization_id` (UUID) - FK to organizations
- `matrix_version_from`, `matrix_version_to` (INTEGER)
- `matrix_id_from`, `matrix_id_to` (UUID) - FK to zone_compliance_matrix
- `observations_affected` (INTEGER) - Count of re-evaluated observations
- `compliance_changed` (INTEGER) - Count where verdict changed
- `criteria_changed` (JSONB) - Which criteria were modified
- `detected_at` (TIMESTAMPTZ)
- `detected_by` (UUID) - FK to user_profiles
- `status` (TEXT) - 'pending', 'reviewed', 'approved', 'overridden'
- `remediation_notes` (TEXT)
- `reviewed_at` (TIMESTAMPTZ)
- `reviewed_by` (UUID) - FK to user_profiles

**RLS Policies:**
- Admins can manage drift events
- Users can view org drift events

---

##### `admin_recalculation_actions`
**Purpose:** Audit trail for compliance recalculation operations  
**Primary Key:** `id` (UUID)  
**Key Columns:**
- `scope_type` (TEXT) - 'zone', 'organization', 'date_range'
- `target_zone_ids` (UUID[]) - Zones targeted
- `target_org_ids` (UUID[]) - Organizations targeted
- `date_range_start`, `date_range_end` (DATE)
- `observations_processed` (INTEGER)
- `compliance_changed` (INTEGER)
- `drift_events_created` (INTEGER)
- `status` (TEXT) - 'running', 'completed', 'failed'
- `error_message` (TEXT)
- `performed_by` (UUID) - FK to user_profiles
- `performed_at` (TIMESTAMPTZ)
- `completed_at` (TIMESTAMPTZ)
- `duration_seconds` (INTEGER)

**RLS Policies:**
- Admins/masters can create recalculation actions
- Admins/masters can update recalculation actions
- Admins/masters can view recalculation actions

---

#### 10. Legacy & Historical

##### `person_records`
**Purpose:** Individual person records (non-vehicle freedom campers)  
**Primary Key:** `id` (UUID)

##### `health_safety_reports`
**Purpose:** H&S incident reports  
**Primary Key:** `id` (UUID)

##### `verification_results`
**Purpose:** Legacy verification tracking  
**Primary Key:** `id` (UUID)

##### `import_history`
**Purpose:** CSV import tracking and audit trail  
**Primary Key:** `id` (UUID)

##### `audit_log`
**Purpose:** Global audit log for all system changes  
**Primary Key:** `id` (UUID)

##### `plate_history`
**Purpose:** Legacy plate sighting history  
**Primary Key:** `id` (UUID)

---

## Security & Access Control

### Row Level Security (RLS)

**ALL tables have RLS enabled.** Key patterns:

#### 1. User Isolation
```sql
-- Users can only view/modify records in their organization
USING (organization_id = get_user_organization_id(auth.uid()))

-- Master users can view all organizations
USING (get_user_role(auth.uid()) = 'master' OR organization_id = get_user_organization_id(auth.uid()))
```

#### 2. Role-Based Access
```sql
-- Admins and masters can manage data
USING (get_user_role(auth.uid()) = ANY (ARRAY['admin', 'master']))

-- Officers can create but not modify
WITH CHECK (recorded_by = auth.uid())
```

#### 3. Officer Safety Override
```sql
-- All officers can view flagged vehicles and incidents (safety)
USING (true)  -- Read-only access for safety
```

#### 4. Service Role Full Access
```sql
-- Edge functions use service role for unrestricted operations
USING (true)
WITH CHECK (true)
```

#### 5. Super Delete Permission
```sql
-- Only Don Squire with super_delete permission can delete records
USING (
  EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid()
    AND email = 'don.squire@firstsecurity.co.nz'
    AND permissions @> '["super_delete"]'::jsonb
  )
)
```

### PostgreSQL Functions

#### Helper Functions
- `get_user_role(user_id UUID)` - Returns user's role
- `get_user_organization_id(user_id UUID)` - Returns user's primary org
- `get_user_organization_ids(user_id UUID)` - Returns all orgs for master users
- `check_user_has_role(role_name TEXT)` - Boolean role check

#### Core Business Logic
- `calculate_vehicle_compliance(plate TEXT, zone_id UUID)` - **SINGLE SOURCE OF TRUTH** for compliance calculations
- `get_or_create_canonical_vehicle(plate TEXT)` - Vehicle deduplication
- `get_vehicle_stay_summary(plate TEXT, zone_id UUID)` - Stay statistics
- `get_active_matrix(zone_id UUID)` - Current compliance matrix
- `create_matrix_version(zone_id UUID)` - Version control for matrices
- `find_nearest_zone(lat NUMERIC, lng NUMERIC)` - Geofence detection

#### Triggers
- `update_updated_at_column` - Auto-update timestamps
- `increment_vehicle_observations` - Update canonical vehicle totals
- `trigger_set_enforcement_flag` - Auto-flag enforcement needed
- `trigger_set_scheduled_deletion` - Calculate photo deletion dates
- `trigger_log_incident_actions` - Audit trail for incidents
- `trigger_log_vehicle_changes` - Audit trail for vehicles
- `trigger_log_zone_changes` - Audit trail for zones
- `on_auth_user_created` - Create user profile on auth signup

---

## Storage Buckets

### 1. `evidence` (Public)
**Purpose:** Evidence photos from patrol operations  
**File Size Limit:** 10 MB  
**Allowed Types:** image/jpeg, image/jpg, image/png, image/webp  
**Policies:**
- Authenticated users can upload
- Public can read (for sharing with courts/authorities)
- Service role has full access
- Users can delete own photos within 24 hours

### 2. `incident-evidence` (Private)
**Purpose:** Court-ready incident evidence  
**File Size Limit:** 10 MB  
**Allowed Types:** image/jpeg, image/jpg, image/png, image/webp, application/pdf  
**Policies:**
- Officers can upload
- Users can view (org-scoped via RLS)
- Admins can delete
- Service role has full access

---

## Edge Functions

### Plate Recognition & AI
1. **`recognize-plate`** - Plate Recognizer ANPR (primary)
2. **`extract-plate`** - OnSpace AI OCR (fallback)
3. **`process-driving-scan`** - Backend-driven processing for driving mode

### Data Processing
4. **`import-data`** - CSV import for bulk data
5. **`process-homeless-data`** - Homeless status import/processing
6. **`scan-breaches`** - Automated breach detection
7. **`correct-zone-assignments`** - Fix incorrect zone assignments
8. **`recalculate-compliance`** - Single-zone compliance recalculation
9. **`recalculate-all-compliance`** - Multi-zone bulk recalculation
10. **`get-compliance-statistics`** - Compliance reporting

### Compliance & Policy
11. **`update-compliance-policy`** - Update zone compliance rules

### Investigation
12. **`process-investigation-document`** - AI document reading for investigation jobs

### Utilities
13. **`get-weather`** - Weather data for evidence context
14. **`stream-webhook`** - Webhook for streaming integrations

### User Management
15. **`create-user`** - Admin user creation
16. **`update-user-password`** - Password management

### Reporting
17. **`generate-incident-pdf`** - Court-ready PDF generation with evidence

---

## Key Features & Workflows

### 1. Vehicle Scanning & Verification

**Handheld Mode:**
1. Officer selects zone and camera
2. Captures photo or uploads image
3. System runs ALPR/OCR to extract plate + vehicle details
4. Checks database for previous records of this plate
5. If found, auto-populates vehicle details (skips AI if data exists)
6. Displays warnings: flagged vehicle, homeless status, breach detection, duplicate scan
7. Officer verifies self-contained sticker (green/blue)
8. Officer can claim homeless status
9. Navigates to evidence collection

**Driving Mode:**
1. Auto-capture every 1-3 seconds (dynamic based on GPS speed)
2. Background processing via Edge Function
3. Duplicate detection (60-second cooldown per plate)
4. Visual + audio alerts for breaches/flagged vehicles
5. Records appear in scanned vehicles list
6. GPS speed detection (primary) or manual speed ranges (fallback)

### 2. Evidence Collection

1. GPS location captured at high accuracy (5-10m)
2. Vehicle profile photo (one per plate globally)
3. Additional evidence photos
4. Behavioral flags (officer safety)
5. Notes and weather conditions
6. Follow-up flagging
7. Submit to create vehicle_record + vehicle_observation + canonical_vehicle entry

### 3. Compliance Calculation

**Single Source of Truth:** `calculate_vehicle_compliance()` PostgreSQL function

**Inputs:**
- Plate number
- Zone ID

**Calculation:**
1. Get all observations for this plate in this zone (current month)
2. Load active compliance matrix for zone
3. Count unique dates (nights stayed)
4. Calculate consecutive days
5. Check against matrix criteria:
   - Self-contained requirement
   - Nights per month limit
   - Max consecutive nights
   - Day-visit-only zones
   - Allowed days of week
6. Apply homeless exemption if confirmed
7. Return verdict + violation details + fine amount + recommended action

**Result Storage:**
- Create `compliance_results` record
- Link to specific matrix version
- Store matrix snapshot (JSON) for audit trail
- Enable drift detection when matrix changes

### 4. Compliance Matrix Versioning & Drift Detection

**Version Creation:**
1. Admin modifies zone compliance rules
2. System creates new matrix version with incremented version number
3. Old version gets `effective_to` timestamp
4. New version becomes active

**Drift Detection:**
1. Admin triggers multi-zone recalculation
2. System re-evaluates all observations with current matrix
3. Compares new verdict vs. stored compliance_results
4. If different, creates `drift_event` record
5. Tracks: observations affected, compliance changed, criteria changed
6. Admin reviews drift events and takes action

**Recalculation Workflow:**
1. Admin selects: zones, date range (optional)
2. System displays preview: X observations, Y zones
3. Admin confirms (blocking UI with progress)
4. Synchronous processing (<30s typical)
5. Creates `admin_recalculation_actions` audit record
6. Generates drift_events for review
7. Returns summary: observations processed, compliance changed

### 5. Incident Reporting (Court-Ready)

**Phase 1: Optional Enforcement (Current)**
1. Officer completes vehicle verification
2. If issues detected (breach, H&S, enforcement needed), system shows enforcement action dialog
3. Officer selects action: warning, notice, tow request, or "No Action - Homeless Confirmed"
4. System creates enforcement_actions record
5. Can optionally create full incident report

**Multi-Vehicle/Person Support:**
- Junction tables: `incident_vehicles`, `incident_persons`
- Can link multiple vehicles to one incident
- Track person roles: offender, witness, victim, contact

**Evidence Integrity:**
- Photos uploaded to Storage Bucket
- SHA-256 hash calculated and stored
- GPS coordinates captured at photo time
- Metadata stored in `photo_metadata` table
- Link to incident via `photo_metadata_ids` array

**Court-Ready Approval:**
1. Officer submits incident with photos + GPS + timestamps
2. Admin reviews
3. Admin sets `court_ready = true` (locks editing)
4. System creates `incident_actions` audit record
5. PDF can be generated with full evidence pack

### 6. PDF Generation (Court-Ready Evidence Pack)

**Edge Function:** `generate-incident-pdf`

**PDF Contents:**
1. Incident header (ID, date, location, officer)
2. Vehicle details (plate, make, model, color)
3. Compliance matrix snapshot (narrative + JSON)
   - Human-readable: "Zone: Akertson Street - Marina. Self-contained required: YES. Max consecutive nights: 3..."
   - JSON block: Full matrix criteria as forensic audit trail
4. Embedded photos with:
   - SHA-256 hash
   - GPS coordinates
   - Timestamp
   - Photo type (full/cropped/profile)
5. Incident details (description, severity, status)
6. Involved persons list
7. Enforcement actions taken
8. Audit trail (all changes via `incident_actions`)
9. Digital signature block (officer signature placeholder)

**Security:**
- Server-side generation (Edge Function)
- Uses pdfkit library
- Prevents client-side tampering
- Stores reference to photo_metadata for hash verification

### 7. Photo Retention & Auto-Deletion

**Retention Policies:**
- Standard: 90 days
- Extended: 180 days
- Permanent: Never delete
- Court-ready photos: Exempt from auto-deletion

**Workflow:**
1. Photo uploaded → `photo_metadata` record created
2. Trigger calculates `scheduled_deletion_at = uploaded_at + delete_after_days`
3. Nightly cron job (Edge Function) deletes expired photos
4. If `court_ready = true`, skip deletion
5. Storage statistics tracked via materialized view

### 8. Homeless Support & Exemptions

**Vehicle-Level Status:**
- `canonical_vehicles.is_homeless` - Self-declared
- `canonical_vehicles.homeless_confirmed` - Admin-verified
- `canonical_vehicles.homeless_notes` - Support context

**Compliance Exemptions:**
- Confirmed homeless vehicles bypass Freedom Camping Act restrictions
- Still recorded but not issued infringements
- Officer can select "No Action - Homeless Confirmed (Exempt)" in enforcement dialog
- Warnings display: "⚠️ IMPORTANT: This vehicle has confirmed homeless status. Handle with care and compassion."

**Admin Review:**
- Homeless Analytics dashboard shows pending claims
- Admin approves/rejects with notes
- System tracks confirmation timestamp + reviewer

### 9. Geofencing & Auto-Zone Detection

**Workflow:**
1. User clicks "Auto-Detect" on landing page
2. System requests high-accuracy GPS
3. Uses point-in-polygon ray casting algorithm (`src/lib/geofence.ts`)
4. Checks if GPS point is inside any zone's `geometry` (GeoJSON polygon)
5. If match found, auto-populates organization + zone
6. Fallback: 500m proximity search if no exact match
7. Displays GPS accuracy and zone name

**Benefits:**
- Reduces manual configuration
- Prevents zone selection errors
- Faster patrol startup
- Works offline (geofence data cached)

### 10. Offline Support (PWA)

**Service Worker Features:**
- Cache critical assets
- Offline scanning queue (IndexedDB)
- Background sync when connection restored
- Installable as standalone app
- Splash screen + app icons

**Offline Workflow:**
1. Officer scans plate while offline
2. Photo + GPS + metadata stored in IndexedDB
3. App shows "Queued for sync" badge
4. When connection restored, background sync triggers
5. Queued scans uploaded to server
6. Success/failure notifications

---

## Database Performance Optimizations

### Materialized Views
- `mv_vehicle_summary` - Vehicle statistics per plate
- `mv_zone_performance` - Zone compliance metrics
- `mv_compliance_trends` - Time-series compliance data
- `mv_storage_statistics` - Storage usage analytics

**Refresh Strategy:** Manual refresh via admin dashboard or scheduled refresh

### Indices
- **Foreign keys**: All FK columns indexed
- **Common queries**: plate_number, zone_id, organization_id, recorded_at
- **Composite indices**: For multi-column WHERE clauses
- **JSONB indices**: GIN indices on JSONB columns (permissions, behavioral_flags)

### Query Optimizations
- Use `calculate_vehicle_compliance()` instead of manual aggregations
- Materialize frequently-accessed aggregates
- Partition large tables by date (future consideration)
- Use canonical vehicle architecture to avoid cross-zone JOINs

---

## Data Migration & Backfilling

**Big Bang Migration (Completed):**
1. Created `canonical_vehicles` table
2. Deduplicated all plates from `vehicle_records`
3. Created `vehicle_observations` from all historical records
4. Preserved original timestamps
5. Linked via `original_record_id`
6. Backfilled `total_observations` counter
7. Migrated flagged vehicles to canonical level
8. Updated homeless status to canonical level

**Backward Compatibility:**
- `vehicle_records` table still exists
- New records create BOTH vehicle_record + observation
- Gradual deprecation of direct vehicle_records queries

---

## API Rate Limits & Costs

### Plate Recognizer
- **Free Tier:** 2,500 API calls/month
- **Paid:** $0.025 per recognition
- **Strategy:** Primary for driving mode, fallback for low-confidence

### OnSpace AI
- **Included:** Built-in AI service
- **No per-call cost:** Requires OnSpace AI authorization
- **Strategy:** Fallback for ALPR failures, sticker detection

---

## Known Issues & Technical Debt

### Current Issues (from error log)
1. ✅ **FIXED:** Yellow background - RGB vs HSL color format mismatch
2. ✅ **FIXED:** Vehicle year column missing - removed from schema
3. ✅ **FIXED:** Speed detection stuck at 0 - replaced optical flow with GPS
4. ✅ **FIXED:** Plate recognition failures - added autofocus, retry logic
5. ✅ **FIXED:** Dashboard crash - infinite loop in useEffect

### Technical Debt
1. **Gradual deprecation of vehicle_records** - Move all queries to canonical + observations
2. **Partition large tables** - Consider date-based partitioning for vehicle_observations
3. **Materialized view refresh** - Automate via cron or triggers
4. **Photo auto-deletion job** - Needs Edge Function + cron scheduler
5. **Duplicate plate detection** - 60-second cooldown in-memory, should persist to DB
6. **Compliance matrix UI** - ComplianceMatrixManagement.tsx not yet implemented

---

## Future Enhancements (Pending)

### MVP 2 Features
1. **ComplianceMatrixManagement.tsx** - Admin UI for matrix versioning
2. **Drift Dashboard** - View/remediate drift events
3. **Master multi-org recalculation** - Bulk recalc across organizations
4. **Build-wide recalculation** - Freedom Camping Act changes
5. **Advanced analytics** - Heatmaps, cross-zone movement patterns

### Long-term Roadmap
1. **Mobile app** (React Native) - Dedicated iOS/Android app
2. **Real-time officer tracking** - Live GPS on map
3. **Automated breach notifications** - Email/SMS to vehicle owners
4. **Integration with council CRM** - Sync with existing systems
5. **ML-powered sticker detection** - Improve AI accuracy
6. **Predictive analytics** - Forecast breach hotspots

---

## Deployment & Environment

**Production:**
- **URL:** https://xbfnlzmpumthnjmtqufp.supabase.co
- **Status:** ACTIVE_HEALTHY
- **Region:** Auto-selected by Supabase

**Development:**
- **Local Supabase:** Optional via Supabase CLI
- **Environment Variables:** Auto-injected (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)

**CI/CD:**
- Edge Functions deployed via Supabase CLI
- Database migrations via SQL scripts
- Frontend deployed via OnSpace platform

---

## Compliance & Legal

**Data Privacy:**
- GDPR-compliant data handling
- User consent for photo capture
- Retention policies enforce data minimization

**Evidence Integrity:**
- SHA-256 hashing prevents tampering
- GPS + timestamp metadata for court admissibility
- Audit trails for all critical operations
- Court-ready approval workflow

**Homeless Protections:**
- Exemption from Freedom Camping Act enforcement
- Compassionate handling protocols
- Admin verification required for homeless status
- Support service referral notes

---

## Contact & Support

**System Administrator:** Don Squire  
**Email:** don.squire@firstsecurity.co.nz  
**Organization:** Nelson City Council  
**Developer:** OnSpace AI Platform

---

**END OF DOCUMENTATION**
