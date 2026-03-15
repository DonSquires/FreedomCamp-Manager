# Live Database Schema — Authoritative Reference

> ⚠️ **GOVERNANCE NOTICE**
> This file is the single source of truth for the live Supabase database schema.
> **Any changes to this file or to `supabase/migrations/` require explicit written approval
> from the repository owner (@DonSquires) via a reviewed and approved Pull Request.**
> See [SCHEMA_VALIDATION_CHECKLIST.md](../SCHEMA_VALIDATION_CHECKLIST.md) for the full governance policy.

**Last verified:** 2026-03-15  
**Verified by:** Copilot schema alignment audit (Schema Extract #8 pass) against migrations through 20260416000001  
**Live row counts at verification:** observations 30,789 · canonical_vehicles 61,535 · zones 4,336 · breach_alerts 0 · user_profiles 7

---

## How to Keep This Document Current

Re-query the live database whenever a migration is merged (see `schema-extract.yml` workflow):

```sql
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;
```

Then update this file, update `src/types/database.ts`, and open a PR for review.

---

## public.observations

**Primary key:** `observation_id` (uuid, NOT NULL)  
**Secondary unique key:** `id` (uuid, nullable, unique) — legacy alias  
**Idempotency:** `idempotency_key` (text, nullable, partial unique index where NOT NULL)

| Column | Type | Nullable | Default |
|---|---|---|---|
| observation_id | uuid | NO | gen_random_uuid() |
| plate_number | text | NO | — |
| vehicle_make | text | YES | — |
| vehicle_model | text | YES | — |
| vehicle_year | integer | YES | — |
| vehicle_color | text | YES | — |
| self_contained | boolean | YES | false |
| self_contained_expiry | date | YES | — |
| photo | text | YES | — |
| photo_url | text | YES | — |
| photo_hash | text | YES | — |
| gps_latitude | numeric | YES | — |
| gps_longitude | numeric | YES | — |
| gps_accuracy | numeric | YES | — |
| recorded_at | timestamptz | NO | — |
| organization_id | uuid | NO | — |
| zone_id | uuid | NO | — |
| recorded_by | uuid | YES | — |
| officer_notes | text | YES | — |
| observation_notes | text | YES | — |
| portal_used | text | YES | — |
| has_notes | boolean | YES | false |
| notes_reference_previous | boolean | YES | false |
| has_hs_incident | boolean | YES | false |
| hs_incident_id | uuid | YES | — |
| has_incident | boolean | YES | false |
| incident_id | uuid | YES | — |
| has_homeless_claim | boolean | YES | false |
| homeless_claim_notes | text | YES | — |
| breach_warning | boolean | YES | false |
| breach_warning_reason | text | YES | — |
| is_breach | boolean | YES | false |
| breach_type | text | YES | — |
| breach_reason | text | YES | — |
| breach_details | jsonb | YES | — |
| breach_detected_at | timestamptz | YES | — |
| compliance_snapshot | jsonb | YES | — |
| is_compliant | boolean | YES | true |
| nights_stayed_this_month | integer | YES | 0 |
| consecutive_nights | integer | YES | 0 |
| vehicle_embedding | jsonb | YES | — |
| embedding_quality | double precision | YES | — |
| embedding_model_version | text | YES | — |
| embedding_created_at | timestamptz | YES | — |
| parkpow_session_id | integer | YES | — |
| parkpow_violation_id | integer | YES | — |
| zone_name_at_import | text | YES | — |
| deleted_at | timestamptz | YES | — |
| is_legacy_import | boolean | YES | false |
| legacy_source_tag | text | YES | — |
| idempotency_key | text | YES | — |
| processing_status | text | YES | 'pending' |
| processing_started_at | timestamptz | YES | — |
| processing_completed_at | timestamptz | YES | — |
| processing_error | text | YES | — |
| plate_confidence | real | YES | — |
| vehicle_make_confidence | real | YES | — |
| vehicle_model_confidence | real | YES | — |
| vehicle_color_confidence | real | YES | — |
| sticker_presence | boolean | YES | — |
| sticker_color | text | YES | — |
| sticker_bbox | jsonb | YES | — |
| sticker_detection_confidence | real | YES | — |
| sticker_color_confidence | real | YES | — |
| previous_observation_id | uuid | YES | — |
| movement_moved | boolean | YES | — |
| movement_background_similarity | real | YES | — |
| movement_vehicle_bbox_iou | real | YES | — |
| movement_decision | text | YES | — |
| has_discrepancies | boolean | YES | false |
| discrepancy_flags | jsonb | YES | — |
| id | uuid | YES | gen_random_uuid() |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

> **⛔ COLUMNS THAT DO NOT EXIST** (remove from any new code):
> `compliance_summary` (use `compliance_snapshot`),
> `image_url` (use `photo` or `photo_url`)
>
> **Note:** `weather_conditions`, `processing_status`, `plate_confidence`, `sticker_presence`,
> `movement_moved`, etc. are **present** in the live DB (added by migrations 20260220000004,
> 20260312000010, 20260401000001). They were previously listed as absent in the checklist —
> that was corrected in Schema Extract #8.

### Triggers on observations

| Trigger | Timing | Event | Function |
|---|---|---|---|
| trg_auto_evaluate_compliance | BEFORE | INSERT | auto_evaluate_compliance() |
| trigger_auto_create_compliance_result | AFTER | INSERT | auto_create_compliance_result() |
| trigger_log_observation_deletion | BEFORE | DELETE | log_observation_deletion() |
| trigger_populate_observation_from_canonical | BEFORE | INSERT | populate_observation_from_canonical() |
| trigger_sync_homeless_to_canonical | AFTER | INSERT | sync_homeless_to_canonical() |
| trigger_update_canonical_stats_v2 | AFTER | INSERT | update_canonical_stats_v2() |
| trigger_update_monthly_stays | AFTER | INSERT | update_monthly_stays_on_observation() |

### RLS Policies on observations

| Policy | Command | Who |
|---|---|---|
| users_view_observations_v2 | SELECT | master role, or own organization_id |
| users_create_observations_v2 | INSERT | any authenticated user_profiles member |
| admins_manage_observations_v2 | UPDATE | admin / admin_officer / master (own org) |
| officers_update_recent_scans | UPDATE | recorded_by = auth.uid() within 24 h |
| officers_delete_recent_scans | DELETE | recorded_by = auth.uid() within 24 h |

---

## public.canonical_vehicles

**Primary key:** `plate_number` (text)  
**Unique:** `vehicle_id` (uuid) — use this as the stable row identifier in code

| Column | Type | Nullable | Default |
|---|---|---|---|
| plate_number | text | NO | — |
| vehicle_id | uuid | NO | gen_random_uuid() |
| vehicle_make | text | YES | — |
| vehicle_model | text | YES | — |
| vehicle_color | text | YES | — |
| vehicle_year | integer | YES | — |
| self_contained | boolean | YES | false |
| self_contained_expiry | date | YES | — |
| nzscv_warrant_type | text | YES | — |
| nzscv_lookup_at | timestamptz | YES | — |
| nzscv_last_checked | timestamptz | YES | — |
| nzscv_source | text | YES | — |
| homeless_status | text | YES | 'none' |
| is_homeless | boolean | YES | false |
| homeless_confirmed | boolean | YES | false |
| homeless_confirmed_by | uuid | YES | — |
| homeless_confirmed_at | timestamptz | YES | — |
| homeless_notes | text | YES | — |
| is_flagged | boolean | YES | false |
| flagged_priority | text | YES | — |
| flagged_reason | text | YES | — |
| flagged_notes | text | YES | — |
| flagged_at | timestamptz | YES | — |
| flagged_by | uuid | YES | — |
| owner_first_name | text | YES | — |
| owner_last_name | text | YES | — |
| owner_company_name | text | YES | — |
| owner_address | text | YES | — |
| owner_address_verified | boolean | YES | false |
| profile_photo | text | YES | — |
| profile_photo_url | text | YES | — |
| profile_photo_score | integer | YES | — |
| profile_photo_selected_at | timestamptz | YES | — |
| profile_photo_metadata | jsonb | YES | — |
| profile_photo_updated_at | timestamptz | YES | — |
| total_notes | integer | YES | 0 |
| last_note_at | timestamptz | YES | — |
| last_note_preview | text | YES | — |
| first_seen_at | timestamptz | NO | now() |
| last_seen_at | timestamptz | NO | now() |
| total_observations | integer | YES | 0 |
| total_breaches | integer | YES | 0 |
| total_incidents | integer | YES | 0 |
| total_hs_reports | integer | YES | 0 |
| enforcement_count | integer | YES | 0 |
| last_enforcement_at | timestamptz | YES | — |
| last_enforcement_type | text | YES | — |
| fc_act_exempt | boolean | YES | false |
| is_exempt | boolean | NO | false |
| parkpow_vehicle_id | integer | YES | — |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

> **⛔ COLUMNS THAT DO NOT EXIST**: `id`, `make`, `model`, `colour` (use `vehicle_color`), `year` (use `vehicle_year`),
> `body_style`, `nzscv_warrant_number`, `nzscv_expires_on`, `vin`
>
> **vehicle_year** is **INTEGER** (normalised from TEXT by migration `20260411000003`). Use as `number | null` in TypeScript.

---

## public.breach_alerts

**Primary key:** `id` (uuid)

| Column | Type | Nullable | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| organization_id | uuid | NO | — |
| zone_id | uuid | NO | — |
| plate_number | text | YES | — |
| observation_id | uuid | YES | — |
| vehicle_record_id | uuid | YES | — |
| patrol_id | uuid | YES | — |
| breach_type | text | NO | — |
| breach_details | jsonb | NO | '{}' |
| due_date | date | YES | — |
| notification_sent | boolean | YES | false |
| notification_method | text | YES | — |
| notified_at | timestamptz | YES | — |
| notified_by | uuid | YES | — |
| status | text | YES | 'pending' |
| resolution_notes | text | YES | — |
| resolved_at | timestamptz | YES | — |
| assigned_to | uuid | YES | — |
| assigned_at | timestamptz | YES | — |
| assigned_by | uuid | YES | — |
| admin_reviewed_by | uuid | YES | — |
| admin_reviewed_at | timestamptz | YES | — |
| admin_review_notes | text | YES | — |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

**CHECK constraints:**
- `breach_type` ∈ `{consecutive_nights, monthly_limit, self_contained, after_hours, day_visit_violation, allowed_days_violation}`
- `status` ∈ `{pending, acknowledged, enforcement_started, resolved, dismissed}`

> **⛔ COLUMNS THAT DO NOT EXIST** (confirmed absent in live schema snapshot 2026-03-13):  
> `resolved_by` — use `admin_reviewed_by` instead
>
> **⚠️ DEPRECATED LINK** — `compliance_result_id` column exists but is always NULL.
> The `compliance_results` table was **DROPPED** in `20260221_rebuild_observations_clean.sql`.
> Compliance state lives directly on `observations` rows. Use `observation_id` (FK to observations)
> to link a breach alert to its source observation.
>
> **⚠️ CONDITIONAL COLUMN** — may exist as a generated alias:  
> `detected_at` — added by migration `20260313000002_schema_wiring_alignment.sql` as  
> `GENERATED ALWAYS AS (created_at) STORED`. Verify with:  
> `SELECT column_name FROM information_schema.columns WHERE table_name='breach_alerts' AND column_name='detected_at';`  
> If absent, use `created_at` directly.

---

## public.organizations

**Primary key:** `id` (uuid)

| Column | Type | Default |
|---|---|---|
| id | uuid | gen_random_uuid() |
| name | text | — |
| contact_email | text | — |
| contact_phone | text | — |
| address | text | — |
| is_active | boolean | true |
| enforcement_workflow | text | — |
| logo_url | text | — |
| parent_organization_id | uuid | — |
| organization_level | integer | 1 |
| organization_type | text | 'client' |
| requires_coa | boolean | false |
| requires_warrant_for_enforcement | boolean | true |
| overnight_verification_mode | text | 'two_photo_verification' |
| created_at | timestamptz | — |
| updated_at | timestamptz | — |

---

## public.user_profiles

**Primary key:** `id` (uuid → auth.users.id)

| Column | Type | Default |
|---|---|---|
| id | uuid | — |
| organization_id | uuid | — |
| employer_organization_id | uuid | — |
| authorized_work_locations | uuid[] | {} |
| email | text | — |
| first_name | text | — |
| last_name | text | — |
| role | text | 'officer' |
| phone | text | — |
| is_active | boolean | true |
| permissions | jsonb | '[]' |
| last_gps_latitude | numeric | — |
| last_gps_longitude | numeric | — |
| last_gps_accuracy | numeric | — |
| last_gps_update | timestamptz | — |
| authorized_activities | jsonb | '[]' |
| issuing_authority | text | — |
| coa_license_type | text | — |
| warrant_acts | text[] | — |
| credentials_verified | boolean | false |
| credentials_verified_at | timestamptz | — |
| credentials_verified_by | uuid | — |
| coa_number | text | — |
| coa_expiry_date | date | — |
| coa_document_url | text | — |
| coa_required | boolean | false |
| coa_verified | boolean | false |
| coa_expiry | date | — |
| has_warrant | boolean | false |
| warrant_number | text | — |
| warrant_expiry_date | date | — |
| warrant_document_url | text | — |
| warrant_required | boolean | false |
| warrant_verified | boolean | false |
| warrant_expiry | date | — |
| compliance_status | text | 'pending' |
| last_location | jsonb | — |
| portal_used | text | — |
| push_token | text | — |
| push_token_updated_at | timestamptz | — |
| notification_preferences | jsonb | — |
| bio | text | — |
| emergency_contact_name | text | — |
| emergency_contact_phone | text | — |
| profile_photo_url | text | — |
| created_at | timestamptz | now() |
| updated_at | timestamptz | now() |

**Valid roles:** `admin`, `master`, `officer`, `admin_officer`

---

## public.zones

**Primary key:** `id` (uuid)

| Column | Type | Default |
|---|---|---|
| id | uuid | gen_random_uuid() |
| organization_id | uuid | — |
| name | text | — |
| description | text | — |
| self_contained_required | boolean | — |
| nights_per_month | integer | 28 |
| max_consecutive_nights | integer | 3 |
| day_visit_only | boolean | false |
| allowed_days | text[] | — |
| is_active | boolean | true |
| location_lat | numeric | — |
| location_lng | numeric | — |
| geometry | jsonb | — |
| zone_type | text | 'specific' |
| parent_zone_id | uuid | — |
| boundary_source | text | — |
| parkpow_lot_id | integer | — |
| needs_admin_review | boolean | false |
| created_at | timestamptz | — |
| updated_at | timestamptz | — |

---

## public.compliance_results

**Primary key:** `id` (uuid)

| Column | Type | Default |
|---|---|---|
| id | uuid | gen_random_uuid() |
| observation_id | uuid | — |
| vehicle_id | uuid | — |
| zone_id | uuid | — |
| organization_id | uuid | — |
| matrix_id | uuid | — |
| matrix_version | integer | — |
| is_compliant | boolean | true |
| violation_type | text | — |
| violation_reasons | text[] | — |
| metrics_json | jsonb | — |
| matrix_snapshot | jsonb | — |
| evaluated_at | timestamptz | now() |
| after_hours_violation | boolean | false |
| stay_confirmed_by_gps | boolean | false |
| gps_distance_meters | numeric | — |
| gps_verified_consecutive_nights | integer | 0 |
| gps_evidence_json | jsonb | '[]' |
| fc_act_exempt | boolean | false |
| exemption_reason | text | — |
| is_exempt | boolean | false |
| created_at | timestamptz | now() |
| updated_at | timestamptz | now() |

---

## public.patrols

**Primary key:** `id` (uuid)

| Column | Type | Default |
|---|---|---|
| id | uuid | gen_random_uuid() |
| organization_id | uuid | — |
| zone_id | uuid | — |
| patrol_date | date | current_date |
| shift | text | — |
| assigned_to | uuid | — |
| status | text | 'scheduled' |
| notes | text | — |
| notification_sent | boolean | false |
| notification_sent_at | timestamptz | — |
| officer_accepted | boolean | false |
| officer_accepted_at | timestamptz | — |
| officer_declined | boolean | false |
| officer_decline_reason | text | — |
| auto_checkin_enabled | boolean | true |
| geofence_radius | integer | 100 |
| scheduled_start_time | timestamptz | — |
| scheduled_end_time | timestamptz | — |
| actual_start_time | timestamptz | — |
| actual_end_time | timestamptz | — |
| duration_minutes | integer | — |
| description | text | — |
| priority | text | 'normal' |
| recurrence | text | 'none' |
| shift_id | uuid | — |
| started_at | timestamptz | — |
| ended_at | timestamptz | — |
| vehicles_checked | integer | 0 |
| breaches_found | integer | 0 |
| created_at | timestamptz | — |
| updated_at | timestamptz | — |

> **Note:** `actual_start_time`/`actual_end_time` are the primary timestamps for patrol duration. `started_at`/`ended_at` are aliases added by migration `20260410000001`.

---

## public.enforcement_actions

**Primary key:** `id` (uuid)

Columns: `id`, `organization_id`, `zone_id`, `vehicle_record_id`, `observation_id`, `plate_number`, `action_type`, `status` (default 'pending'), `notes`, `created_by`, `compliance_result_id`, `assigned_to`, `assigned_at`, `assigned_by`, `completed_by`, `completed_at`, `completion_outcome`, `completion_notes`, `breach_status` (default 'active'), `created_at`, `updated_at`

---

## public.incidents

**Primary key:** `id` (uuid)

Columns: `id`, `organization_id`, `zone_id`, `reported_by`, `incident_type`, `description`, `severity`, `status` (default 'open'), `plate_number`, `evidence_count` (default 0), `primary_evidence_url`, `location_lat`, `location_lng`, `location_address`, `notes`, `metadata` (default '{}'), `user_id`, `deleted_at`, `created_at`, `updated_at`

---

## public.vehicle_monthly_stays

**Primary key:** `id` (uuid)

Columns: `id`, `plate_number`, `organization_id`, `zone_id`, `calendar_month`, `nights_stayed` (default 0), `consecutive_nights` (default 0), `last_observation_date`, `observation_ids` (uuid[], default {}), `reset_at`, `last_reset_at`, `created_at`, `updated_at`

---

## public.zone_compliance_matrix

**Primary key:** `id` (uuid)

Columns: `id`, `zone_id`, `organization_id`, `version` (default 1), `effective_from` (default '2025-12-01'), `effective_to`, `self_contained_required`, `requires_csc`, `nights_per_month` (default 28), `max_consecutive_nights` (default 3), `day_visit_only`, `allowed_days`, `homeless_exemption` (default true), `change_reason`, `change_notes`, `created_at`, `updated_at`

---

## public.import_batches

**Primary key:** `id` (uuid)

Columns: `id`, `organization_id`, `uploaded_by`, `batch_name`, `file_name`, `file_size_bytes`, `status`, `total_records`, `processed_records`, `successful_records`, `failed_records`, `plates_enriched`, `vehicles_enriched`, `homeless_inferred`, `hs_issues_inferred`, `zones_created`, `parsed_records`, `import_config` (default '{}'), `error_summary`, `created_at`, `started_at`, `completed_at`

---

## public.import_staging

**Primary key:** `id` (uuid)

Columns: `id`, `batch_id`, `raw_data`, `enriched_data`, `status` (default 'pending'), `confidence_scores`, `enrichment_log`, `error_log`, `validation_errors`, `vehicle_id`, `observation_id`, `created_at`, `enriched_at`, `imported_at`

---

## Other Public Tables (summary)

| Table | PK | Notes |
|---|---|---|
| spatial_ref_sys | srid | PostGIS reference |
| vehicle_records_deprecated_20250131 | id | Deprecated — do not use |
| photo_metadata | id | Evidence photo audit log |
| plate_scans | id | Legacy scan records |
| audit_log | id | General audit trail |
| flagged_vehicles | id | Flagged vehicle watchlist — columns: `id`, `organization_id`, `plate_number`, `reason`, `priority`, `flagged_by`, `notes`, `is_active` (bool, default true), `last_known_site`, `date_recorded`, `vehicle_description`, `name_contact`, `confirmed_homeless` (bool, default false), `created_by` (→ user_profiles), `attachments` (jsonb, default '[]'), `created_at`, `updated_at` |
| vehicle_discrepancies | id | Cross-source vehicle data conflicts (make/model/colour/SC mismatch); FK to observations.observation_id — added `20260406000001` |
| notifications | id | In-app / push notification records per user (type, title, body, data, priority, read, delivered) — added `20260315` |
| user_sessions | id | Active session tracking (profile page) — added `20260315` |
| restrictions | id | Spatial compliance restriction zones (GeoJSON upload) — added `20260315` |
| admin_recalculation_actions | id | Audit log for bulk compliance recalculation jobs — added `20260317` |
| officer_shifts | id | Officer shift lifecycle: started_at, ended_at, end_reason — added `20260409000001` |
| patrol_site_visits | id | Zone entry/exit per shift: entered_at, exited_at, shift_id — added `20260409000001` |
| patrol_schedule_zones | id | Junction table for multi-zone patrol routes — added `20260409000002` |
| infringement_notices | id | Formal infringement notice documents; FK to observations.observation_id — added `20260311`, extended `20260411000001` |
| drift_events | id | Compliance drift tracking |
| person_records | id | Person of interest records (legacy; columns: first_name, last_name — no full_name) |
| canonical_persons | id | Canonical person records — Phase 5 (has full_name, homeless_claimed/confirmed, location) |
| person_observations | id | Person observation log |
| person_interactions | id | Officer–person interaction log |
| person_vehicle_links | id | Many-to-many person↔vehicle relationships |
| investigation_jobs | id | Investigation job queue |
| investigation_job_types | id | Job type registry |
| investigation_job_templates | id | Job templates |
| notices_to_vacate | id | NTV documents |
| zone_legal_config | id (zone_id unique) | Zone legal configuration |
| health_safety_reports | id | H&S incident reports |
| officer_welfare_settings | id | Per-officer welfare config |
| officer_activity_log | id | Officer GPS/activity log |
| officer_welfare_alerts | id | Man-down / welfare alerts (acknowledged_by, acknowledged_at columns present) |
| observation_deletions | id | Deleted observation audit |
| alert_queue | id | In-app alert queue |
| alert_acknowledgements | id | Alert acknowledgements |
| bug_reports | id | In-app bug reports |
| credential_processing_log | id | COA/warrant AI processing |
| compliance_audit_log | id | Compliance check audit |
| user_deactivation_queue | id | Deferred user deactivation |
| zone_geofence_monthly_snapshots | id | Monthly geofence snapshots |
| vehicle_migration_log | id | Vehicle record migration log |

---

## Key Cross-Schema Relationships

```
auth.users.id
  └─ public.user_profiles.id (FK)

public.user_profiles.organization_id
  └─ public.organizations.id

public.observations.zone_id
  └─ public.zones.id

public.observations.plate_number
  └─ public.canonical_vehicles.plate_number (text join, NOT FK)

public.compliance_results.observation_id
  └─ public.observations.observation_id

public.breach_alerts.observation_id
  └─ public.observations.observation_id

public.vehicle_monthly_stays.(plate_number, organization_id, zone_id)
  └─ summary of public.observations
```

---

## Storage Buckets

| Bucket | Access | Path convention |
|---|---|---|
| scans | Public read / auth write | `/{user_id}/{filename}` |
| evidence | Authenticated only | `/{org_id}/{filename}` |

---

## Database Functions

The live database functions (stored procedures, triggers, RPCs, extensions) are documented in a dedicated companion file:

**[docs/LIVE_FUNCTIONS.md](LIVE_FUNCTIONS.md)** — complete authoritative reference for all functions.

## Database Triggers

The complete trigger inventory (all 54 live triggers, execution order, governance rules) is documented in:

**[docs/LIVE_TRIGGERS.md](LIVE_TRIGGERS.md)** — complete authoritative reference for all triggers.

Same governance applies: any new or modified function or trigger requires a migration, an update to the relevant doc file, and an approved PR reviewed by `@DonSquires`.

---

## TypeScript Mapping

The TypeScript types that must stay in sync with this document:

- `src/types/database.ts` — generated Supabase types (`Database['public']['Tables']`)
  - Tables with full Row/Insert/Update types: `organizations`, `user_profiles`, `zones`, `canonical_vehicles`, `observations`, `breach_alerts`, `patrols`, `patrol_checkpoints`, `checkpoint_visits`, `privacy_curtain_settings`, `privacy_access_log`, `import_batches`, `enforcement_actions`, `health_safety_reports`, `officer_welfare_alerts`, `compliance_results`, `incidents`, `notifications`, `user_sessions`, `homeless_records`, `officer_activity_log`, `person_vehicle_links`, `infringement_notices`, `notices_to_vacate`, `admin_recalculation_actions`, `restrictions`, `zone_compliance_matrix`, `photo_metadata`, `vehicle_discrepancies`, `officer_shifts`, `patrol_site_visits`, `patrol_schedule_zones`, `flagged_vehicles`
- `src/types/index.ts` — application-level interfaces (`Vehicle`, `Observation`, `BreachAlert`, etc.)

When this schema changes, **both files must be updated in the same PR** as the migration.
