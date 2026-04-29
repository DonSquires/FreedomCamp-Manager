# Live Database Schema — Authoritative Reference

> ⚠️ **GOVERNANCE NOTICE**
> This file is the single source of truth for the live Supabase database schema.
> **Any changes to this file or to `supabase/migrations/` require explicit written approval
> from the repository owner (@DonSquires) via a reviewed and approved Pull Request.**
> See [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) for the full governance policy.

**Last verified:** 2026-04-27  
**Verified by:** Migration file analysis (not live DB query) — full table inventory across 303 migration files through 20260425000001 — Business Management section added 2026-04-27  
**Live row counts at verification:** observations 30,789 · canonical_vehicles 61,535 · zones 3,731 · breach_alerts 1,484 · user_profiles 7 · compliance_results 1,959 (from last live query 2026-04-25)

> 📋 **Source note:** This document was updated via static analysis of `supabase/migrations/*.sql` files, not a live database query. Column definitions reflect the CREATE TABLE statements in the migration files. Run the information_schema query above to verify against the live DB.

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
| vehicle_attribute_sources | jsonb | YES | — |
| id | uuid | YES | gen_random_uuid() |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

> **⛔ COLUMNS THAT DO NOT EXIST** (remove from any new code):
> `compliance_summary` (use `compliance_snapshot`),
> `image_url` (use `photo` or `photo_url`)
>
> **Note:** `weather_conditions` is **NOT present** in the live DB (Schema Extract #20 confirmed
> absent — column was referenced in migrations but not present in supabase gen types output).
> `processing_status`, `plate_confidence`, `sticker_presence`, `movement_moved`, etc. **are present**
> in the live DB (added by migrations 20260312000010, 20260401000001). Previously listed as absent
> in the checklist — corrected in Schema Extract #8.
> `has_discrepancies` + `discrepancy_flags` added by `20260406000001`.
> `vehicle_attribute_sources` added by `20260417000001`: tracks source (nzscv/canonical/inference/alpr) per attribute.

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
>
> **⚠️ V3 BREAKING CHANGE — SCV lookups:** `canonical_vehicles.self_contained` / `self_contained_expiry` are no longer authoritative. Use `canonical_scv.is_self_contained` / `certificate_expiry` instead (query by `plate_number`).
>
> **⚠️ V3 BREAKING CHANGE — Homeless lookups:** `canonical_vehicles.homeless_status` is no longer authoritative. Use `canonical_homeless.status` instead (query by `plate_number`).

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
> The `compliance_results` table **EXISTS** in the live DB (Schema Extract #20: 1,959 rows).
> Compliance state is ALSO stored directly on `observations` rows (is_compliant, breach_type,
> breach_reason). Use `observation_id` (FK to observations) to link a breach alert to its source observation.
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

**Valid roles:** `admin`, `master`, `officer`, `admin_officer`, `grand_master`, `nzscv_monitor`

> `grand_master` added by `20260424000002`: platform owner — cross-org access, billing, org CRUD.  
> `nzscv_monitor` added by `20260419000001`: read-only SCV monitoring (superseded by grand_master's broader access).

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
| land_managing_agency | text | — |
| bylaw_reference | text | — |
| seasonal_open_month | smallint | — |
| seasonal_close_month | smallint | — |
| created_at | timestamptz | — |
| updated_at | timestamptz | — |

**CHECK constraints:**
- `land_managing_agency` ∈ `{council, doc, linz, nzta, crown, private, other}` — identifies governing legislation
- `seasonal_open_month` / `seasonal_close_month` ∈ 1–12 — supports wrap-around (e.g. Oct–Mar)

> `land_managing_agency`, `bylaw_reference`, `seasonal_open_month`, `seasonal_close_month` added by `20260425000001`.
> **Unique partial index:** `(organization_id, lower(name))` — enforces zone name uniqueness per org (added `20260403000001`).

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

## public.zone_signage_evidence

**Primary key:** `id` (uuid, NOT NULL)

| Column | Type | Nullable | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| zone_id | uuid | NO | — |
| photo_url | text | NO | — |
| photo_sha256 | text | NO | — |
| signage_type | text | YES | — |
| captured_by | uuid | YES | — |
| captured_at | timestamptz | YES | now() |
| gps_latitude | numeric | YES | — |
| gps_longitude | numeric | YES | — |
| notes | text | YES | — |
| is_current | boolean | YES | true |
| created_at | timestamptz | YES | now() |

**CHECK constraints:** `signage_type` ∈ `{restriction_notice, bylaw_reference, prohibitory, regulatory, warning}`

---

## public.infringement_notice_counters

**Primary key:** `(organization_id, year_code)` (composite)

| Column | Type | Nullable | Default |
|---|---|---|---|
| organization_id | uuid | NO | — |
| year_code | text | NO | — |
| last_seq | integer | NO | 0 |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

**CHECK constraints:** `last_seq >= 0`

---

## public.enforcement_cases

**Primary key:** `id` (uuid, NOT NULL)

| Column | Type | Nullable | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| observation_id | uuid | YES | — |
| plate_number | text | NO | — |
| organization_id | uuid | YES | — |
| zone_id | uuid | YES | — |
| case_number | text | NO | — |
| case_status | text | NO | 'open' |
| created_by | uuid | YES | — |
| assigned_to | uuid | YES | — |
| violation_summary | text | YES | — |
| evidence_snapshot | jsonb | YES | — |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

**Unique:** `case_number`

---

## public.enforcement_case_events

**Primary key:** `id` (uuid, NOT NULL)

| Column | Type | Nullable | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| case_id | uuid | YES | — |
| event_type | text | NO | — |
| event_data | jsonb | YES | — |
| performed_by | uuid | YES | — |
| occurred_at | timestamptz | YES | now() |

---

## public.patrol_checkpoints

**Primary key:** `id` (uuid, NOT NULL)

| Column | Type | Nullable | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| organization_id | uuid | NO | — |
| zone_id | uuid | YES | — |
| name | text | NO | — |
| description | text | YES | — |
| location_lat | double precision | YES | — |
| location_lng | double precision | YES | — |
| qr_code | text | NO | — |
| nfc_tag_id | text | YES | — |
| is_active | boolean | NO | true |
| required_on_patrol | boolean | NO | false |
| check_in_radius_metres | integer | NO | 50 |
| created_by | uuid | YES | — |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

**Unique:** `qr_code`

---

## public.checkpoint_visits

**Primary key:** `id` (uuid, NOT NULL)

| Column | Type | Nullable | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| checkpoint_id | uuid | NO | — |
| officer_id | uuid | NO | — |
| patrol_id | uuid | YES | — |
| organization_id | uuid | NO | — |
| scan_method | text | NO | — |
| gps_latitude | double precision | YES | — |
| gps_longitude | double precision | YES | — |
| gps_accuracy | double precision | YES | — |
| gps_distance_from_checkpoint | double precision | YES | — |
| within_radius | boolean | YES | — |
| visited_at | timestamptz | NO | now() |
| notes | text | YES | — |
| created_at | timestamptz | NO | now() |

**CHECK constraints:** `scan_method` ∈ `{qr_camera, nfc, manual_code, url_deep_link}`

---

## public.incident_attachments

**Primary key:** `id` (uuid, NOT NULL)

| Column | Type | Nullable | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| incident_id | uuid | YES | — |
| file_url | text | NO | — |
| file_name | text | NO | — |
| file_type | text | NO | — |
| file_hash | text | YES | — |
| uploaded_by | uuid | YES | — |
| uploaded_at | timestamptz | YES | now() |

---

## public.privacy_access_log

**Primary key:** `id` (uuid, NOT NULL)

| Column | Type | Nullable | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| organization_id | uuid | NO | — |
| actor | uuid | NO | — |
| target_table | text | NO | — |
| target_record_id | text | NO | — |
| field_accessed | text | NO | — |
| access_reason | text | YES | — |
| ip_address | inet | YES | — |
| user_agent | text | YES | — |
| accessed_at | timestamptz | NO | now() |

---

## public.privacy_curtain_settings

**Primary key:** `id` (uuid, NOT NULL)  
**Unique:** `organization_id` (one row per org)

| Column | Type | Nullable | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| organization_id | uuid | NO | — |
| auto_redact_enabled | boolean | NO | true |
| redact_owner_name | boolean | NO | true |
| redact_owner_address | boolean | NO | true |
| redact_phone_number | boolean | NO | true |
| redact_plate_in_exports | boolean | NO | false |
| require_reason_for_unredact | boolean | NO | true |
| unredact_roles | text[] | NO | {admin,master} |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

---

## public.retention_policies

**Primary key:** `id` (uuid, NOT NULL)

| Column | Type | Nullable | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| organization_id | uuid | NO | — |
| record_type | text | NO | — |
| retention_days | integer | NO | — |
| litigation_hold | boolean | YES | false |
| auto_purge | boolean | YES | true |
| public_records_act_schedule | text | YES | — |
| notes | text | YES | — |
| created_by | uuid | YES | — |
| created_at | timestamptz | YES | now() |

**CHECK constraints:** `record_type` ∈ `{observations, incidents, infringement_notices, audit_logs, investigation_jobs, enforcement_actions}`  
**Unique:** `(organization_id, record_type)`

---

## Business Management & CRM Tables

The following tables support the **two-lane admin architecture**:
- **CRM Layer**: Client site management, contracts, service delivery locations
- **Business Management Layer**: Officer availability, skills tracking, roster scheduling, shift marketplace

### public.client_sites

**Primary key:** `id` (uuid, NOT NULL)  
**Organization scoping:** `organization_id` (one-to-many)  
**Zone linking:** `zone_id` (nullable FK to zones.id)  
**Contract tracking:** `contract_start_date`, `contract_end_date`, `m365_customer_id`, `m365_contract_ref`, `purchase_order_number`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | Site UUID |
| organization_id | uuid | NO | — | Parent organization (CRM account) |
| name | string | NO | — | Site name / location identifier |
| site_code | text | YES | — | Customer-facing site reference code |
| site_type | text | NO | — | Type: campus, warehouse, retail, event, other |
| zone_id | uuid | YES | — | Linked enforcement zone (if applicable) |
| address | text | YES | — | Street address |
| city | text | YES | — | City/suburb |
| gps_lat | numeric | YES | — | Geofence center latitude |
| gps_lng | numeric | YES | — | Geofence center longitude |
| geofence_radius_metres | numeric | NO | 500 | Geofence boundary (meters) |
| contact_name | text | YES | — | Primary site contact name |
| contact_phone | text | YES | — | Primary site contact phone |
| contact_email | text | YES | — | Primary site contact email |
| emergency_contact_name | text | YES | — | Emergency contact name |
| emergency_contact_phone | text | YES | — | Emergency contact phone |
| access_instructions | text | YES | — | Gate codes, access procedures |
| special_instructions | text | YES | — | Site-specific operational notes |
| hazards | text | YES | — | Known hazards (vehicle types, biosecurity, etc.) |
| default_pay_rate | numeric | YES | — | Default guard hourly rate (NZD) |
| default_charge_rate | numeric | YES | — | Default charge-out rate (NZD) |
| overtime_pay_multiplier | numeric | YES | — | OT multiplier (1.5x, 2x, etc.) |
| default_response_minutes | integer | YES | — | SLA response time in minutes |
| invoice_frequency | text | YES | — | Invoice cycle: weekly, fortnightly, monthly |
| currency_code | text | YES | 'NZD' | Currency (NZD primary) |
| m365_customer_id | text | YES | — | Microsoft 365 customer ID for invoicing |
| m365_cost_centre | text | YES | — | Microsoft 365 cost centre for P&L |
| m365_contract_ref | text | YES | — | Microsoft 365 contract reference |
| contract_start_date | text | YES | — | Contract commencement (ISO date) |
| contract_end_date | text | YES | — | Contract termination (ISO date) |
| priority_override | text | YES | — | Priority rank for dispatch (high/normal/low) |
| is_active | boolean | NO | true | Site operational flag |
| notes | text | YES | — | Admin notes |
| created_by | uuid | YES | — | FK: user_profiles.id (creator) |
| created_at | timestamptz | NO | now() | Creation timestamp |
| updated_at | timestamptz | NO | now() | Last update timestamp |

**Relationships:**
- FK `organization_id` → `organizations.id` (one-to-many)
- FK `zone_id` → `zones.id` (optional link to enforcement zone)
- FK `created_by` → `user_profiles.id` (creator audit)
- Reverse FK: `roster_shifts.client_site_id` (shifts assigned to this site)

---

### public.officer_availability

**Primary key:** `id` (uuid, NOT NULL)  
**Officer scoping:** `officer_id` (one-to-many)  
**Organization scoping:** `organization_id` (one-to-many)  
**Granularity:** Daily pattern or specific date overrides

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | Availability record UUID |
| officer_id | uuid | NO | — | FK: user_profiles.id (officer being tracked) |
| organization_id | uuid | NO | — | Parent organization |
| is_available | boolean | NO | true | Officer can be scheduled (true/false) |
| day_of_week | integer | YES | — | Recurring pattern: 0 (Mon) – 6 (Sun), NULL for specific dates |
| specific_date | text | YES | — | Non-recurring override (ISO date): "2026-04-28" |
| available_from | text | YES | — | Start time (HH:MM, e.g. "06:30") |
| available_to | text | YES | — | End time (HH:MM, e.g. "18:00") |
| unavailability_reason | text | YES | — | Flag (sick, holiday, training, unavailable, other) |
| notes | text | YES | — | Admin notes on unavailability |
| created_at | timestamptz | NO | now() | Creation timestamp |
| updated_at | timestamptz | NO | now() | Last update timestamp |

**Relationships:**
- FK `officer_id` → `user_profiles.id` (one-to-many per officer)
- FK `organization_id` → `organizations.id` (org scoping)

**Query patterns:**
- Get officer availability for today: `WHERE officer_id = ?, specific_date IS NULL AND day_of_week = EXTRACT(DOW FROM NOW())`
- Get officer availability overrides: `WHERE officer_id = ? AND specific_date >= TODAY()`

---

### public.officer_skills

**Primary key:** `id` (uuid, NOT NULL)  
**Officer scoping:** `officer_id` (one-to-many)  
**Organization scoping:** `organization_id` (one-to-many)  
**Verification chain:** `verified_by` (audit trail)

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | Skill record UUID |
| officer_id | uuid | NO | — | FK: user_profiles.id (officer) |
| organization_id | uuid | NO | — | Parent organization |
| skill_name | text | NO | — | Skill category (SIA, First Aid, Dog Handler, ALPR, Conflict de-escalation, etc.) |
| skill_category | text | YES | — | Broader category (security, medical, enforcement, tech, other) |
| is_verified | boolean | NO | false | Skill has been certified/verified |
| verified_by | uuid | YES | — | FK: user_profiles.id (verifier, typically admin) |
| verified_at | timestamptz | YES | — | Verification timestamp |
| issued_at | timestamptz | YES | — | Original certificate issue date |
| expires_at | timestamptz | YES | — | Certificate expiration date (if applicable) |
| certification_number | text | YES | — | Certificate reference code |
| document_url | text | YES | — | Storage URL for certificate scan/PDF |
| notes | text | YES | — | Verification notes or qualification details |
| created_at | timestamptz | NO | now() | Record creation timestamp |
| updated_at | timestamptz | NO | now() | Last update timestamp |

**Relationships:**
- FK `officer_id` → `user_profiles.id` (one-to-many per officer)
- FK `organization_id` → `organizations.id` (org scoping)
- FK `verified_by` → `user_profiles.id` (admin who verified)

---

### public.open_shifts

**Primary key:** `id` (uuid, NOT NULL)  
**Organization scoping:** `organization_id` (one-to-many)  
**Marketplace model:** Officers claim shifts; `claimed_by` tracks claim owner  
**Zone linking:** `zone_id` (optional, may be NULL if site-specific)

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | Shift UUID |
| organization_id | uuid | NO | — | Parent organization |
| title | text | NO | — | Shift title ("Tower Guard - Mon", "Mobile Patrol", etc.) |
| description | text | YES | — | Shift description / duties |
| shift_date | text | NO | — | Shift date (ISO date, e.g. "2026-04-28") |
| start_time | text | YES | — | Shift start time (HH:MM, e.g. "06:00") |
| end_time | text | YES | — | Shift end time (HH:MM, e.g. "18:00") |
| shift_type | text | YES | — | Shift category (patrol, static, event, training, other) |
| status | text | NO | 'open' | Shift status: open, claimed, confirmed, cancelled, completed |
| priority | text | YES | 'normal' | Shift priority: high, normal, low |
| requirements | text | YES | — | Comma-separated required skills |
| zone_id | uuid | YES | — | FK: zones.id (optional zone context) |
| officer_shift_id | uuid | YES | — | FK: officer_shifts.id (if confirmed against live shift) |
| created_by | uuid | NO | — | FK: user_profiles.id (shift creator/dispatcher) |
| claimed_by | uuid | YES | — | FK: user_profiles.id (officer who claimed shift) |
| claimed_at | timestamptz | YES | — | Timestamp when claimed |
| created_at | timestamptz | NO | now() | Creation timestamp |
| updated_at | timestamptz | NO | now() | Last update timestamp |

**Relationships:**
- FK `organization_id` → `organizations.id` (org scoping)
- FK `created_by` → `user_profiles.id` (dispatcher)
- FK `claimed_by` → `user_profiles.id` (officer who claimed)
- FK `officer_shift_id` → `officer_shifts.id` (live shift instance)
- FK `zone_id` → `zones.id` (optional zone context)

---

### public.roster_shifts

**Primary key:** `id` (uuid, NOT NULL)  
**Site-centric model:** Shifts assigned to specific `client_sites`  
**Officer assignment:** `officer_id` (nullable until confirmed)  
**Contract scoping:** `contractor_org_id` (multi-org staffing contractor)

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | Shift UUID |
| organization_id | uuid | NO | — | Primary organization (site owner) |
| contractor_org_id | uuid | YES | — | FK: organizations.id (staffing contractor, if outsourced) |
| client_site_id | uuid | YES | — | FK: client_sites.id (site this shift is for) |
| officer_id | uuid | YES | — | FK: user_profiles.id (assigned officer, NULL if unassigned) |
| officer_shift_id | uuid | YES | — | FK: officer_shifts.id (live shift lifecycle link) |
| shift_date | text | NO | — | Shift date (ISO date, e.g. "2026-04-28") |
| start_time | text | YES | — | Scheduled start (HH:MM, e.g. "06:00") |
| end_time | text | YES | — | Scheduled end (HH:MM, e.g. "18:00") |
| break_minutes | integer | NO | 0 | Paid break duration (minutes) |
| shift_type | text | YES | — | Type: patrol, static, training, incident_response, other |
| position_title | text | YES | — | Role title if different from officer's role |
| service_type | text | YES | — | Service category (security, cleaning, maintenance, event, other) |
| status | text | NO | 'draft' | Shift status: draft, published, confirmed, in_progress, completed, cancelled |
| is_template | boolean | NO | false | If true, shift is a recurrence template; `parent_template_id` is NULL |
| parent_template_id | uuid | YES | — | FK: roster_shifts.id (if shift is instance of recurring template) |
| recurrence_rule | text | YES | — | iCal RRULE for recurring shifts (e.g. "FREQ=WEEKLY;UNTIL=2026-12-31") |
| has_conflict | boolean | NO | false | Officer has scheduling conflict |
| conflict_reason | text | YES | — | Reason for conflict (already assigned, unavailable, etc.) |
| required_skills | text[] | YES | — | Array of skill names required |
| notes | text | YES | — | Internal operational notes |
| internal_notes | text | YES | — | Private admin notes |
| officer_notes | text | YES | — | Officer's notes on shift completion |
| guard_cost_rate | numeric | YES | — | Cost to client (NZD/hour) |
| client_charge_rate | numeric | YES | — | Charge to client (NZD/hour) |
| rate_type | text | YES | — | Rate category (standard, overtime, weekend, holiday, on-call) |
| published_at | timestamptz | YES | — | Timestamp when roster was published to officers |
| confirmed_at | timestamptz | YES | — | Timestamp when officer confirmed acceptance |
| officer_response | text | YES | — | Officer response: accepted, tentative, declined |
| officer_response_at | timestamptz | YES | — | Timestamp of officer response |
| cancelled_at | timestamptz | YES | — | Cancellation timestamp (if cancelled) |
| cancel_reason | text | YES | — | Reason for cancellation |
| created_by | uuid | YES | — | FK: user_profiles.id (creator/scheduler) |
| created_at | timestamptz | NO | now() | Creation timestamp |
| updated_at | timestamptz | NO | now() | Last update timestamp |
| zone_id | uuid | YES | — | FK: zones.id (optional enforcement zone context) |

**Relationships:**
- FK `organization_id` → `organizations.id` (primary org)
- FK `contractor_org_id` → `organizations.id` (staffing agency, if multi-org)
- FK `client_site_id` → `client_sites.id` (site where shift occurs)
- FK `officer_id` → `user_profiles.id` (assigned officer)
- FK `officer_shift_id` → `officer_shifts.id` (live shift tracking)
- FK `parent_template_id` → `roster_shifts.id` (recursive: template relationship)
- FK `created_by` → `user_profiles.id` (creator audit)
- FK `zone_id` → `zones.id` (optional zone context)

**Key patterns:**
- **Template shifts:** `is_template = true`, `recurrence_rule` is set; `parent_template_id = NULL`
- **Instance shifts:** `is_template = false`, `parent_template_id` points to template
- **Unscheduled:** `officer_id = NULL`, `status = 'published'` (waiting for assignment)
- **Conflict detection:** `has_conflict = true` → operator needs to resolve (assign different officer, reschedule, etc.)

---

## Other Public Tables (summary)

### Compliance & Canonical Data
| Table | PK | Notes |
|---|---|---|
| canonical_scv | plate_number | **Authoritative SCV source:** `is_self_contained`, `certificate_expiry`, `source`, `verified_at`, `notes` — replaces `canonical_vehicles.self_contained` — added `20260421000001` |
| canonical_homeless | plate_number | **Authoritative homeless source:** `status` (confirmed/claimed/suspected/declined/none), `confirmed_by`, `confirmed_at`, `source`, `notes` — replaces `canonical_vehicles.homeless_status` — added `20260421000001` |
| dispute_intake | id | Public/staff-submitted disputes: `organization_id`, `zone_id`, `source_type` (notice_to_vacate/infringement/homeless_status/other), `source_reference`, `plate_number`, `claimant_name/email/phone`, `message`, `request_homeless_review`, `hardship_context`, `evidence_statement`, `submitted_via`, `status` (received/under_review/info_requested/upheld/varied/rejected/closed), `assigned_to`, `admin_notes`, `submitted_at` — added `20260418000006`, extended `20260418000007` |

### Audit & Operations
| Table | PK | Notes |
|---|---|---|
| patrol_checkpoints | id | QR/NFC scan checkpoints per zone — see full section above |
| checkpoint_visits | id | Officer checkpoint scan records — see full section above |
| privacy_access_log | id | Privacy field access audit — see full section above |
| privacy_curtain_settings | id | Per-org data redaction config — see full section above |
| zone_signage_evidence | id | Zone signage photo evidence — see full section above |
| infringement_notice_counters | (organization_id, year_code) | Sequential notice number counters — see full section above |
| enforcement_cases | id | Formal enforcement case files — see full section above |
| enforcement_case_events | id | Audit events per enforcement case — see full section above |
| incident_attachments | id | File attachments for incidents — see full section above |
| retention_policies | id | Data retention rules per record type — see full section above |
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
| zone_legal_config | id (zone_id unique) | Zone legal configuration; V3 adds: `payment_online_url`, `payment_bank_account`, `payment_instructions`, `objections_email`, `objections_postal_address` (added `20260418000002`), `dispute_portal_url` (added `20260418000006`) |
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
| notice-artifacts | Authenticated read / service write | `/{org_id}/{notice_id}/{filename}` — infringement notice HTML artifacts (added `20260417000003`) |

---

## public.canonical_scv

**Primary key:** `plate_number` (text, NOT NULL)  
**Source migration:** `supabase/migrations/20260421000001_canonical_scv_and_homeless_tables.sql`

| Column | Type | Nullable | Default |
|---|---|---|---|
| plate_number | text | NO | — |
| is_self_contained | boolean | NO | false |
| certificate_expiry | date | YES | — |
| source | text | YES | 'unknown' |
| verified_at | timestamptz | YES | — |
| notes | text | YES | — |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

---

## public.canonical_homeless

**Primary key:** `plate_number` (text, NOT NULL)  
**Source migration:** `supabase/migrations/20260421000001_canonical_scv_and_homeless_tables.sql`

| Column | Type | Nullable | Default |
|---|---|---|---|
| plate_number | text | NO | — |
| status | text | NO | 'none' |
| confirmed_by | uuid | YES | — |
| confirmed_at | timestamptz | YES | — |
| source | text | YES | 'unknown' |
| notes | text | YES | — |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

---

## public.zone_legal_config

**Primary key:** `id` (uuid, NOT NULL)  
**Source migration:** `supabase/migrations/20250202000002_notice_to_vacate_system.sql`

| Column | Type | Nullable | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| zone_id | uuid | NO | — |
| organization_id | uuid | NO | — |
| org_office_name | text | NO | — |
| org_building | text | YES | — |
| org_street_address | text | NO | — |
| org_po_box | text | YES | — |
| org_city | text | NO | — |
| org_postcode | text | NO | — |
| org_country | text | YES | 'New Zealand' |
| org_phone | text | YES | — |
| org_fax | text | YES | — |
| org_email | text | YES | — |
| org_website | text | YES | — |
| legal_description | text | NO | — |
| land_act | text | NO | — |
| land_owner | text | NO | — |
| managing_authority | text | YES | — |
| max_stay_nights | integer | YES | 3 |
| max_consecutive_nights | integer | YES | 3 |
| self_contained_required | boolean | YES | true |
| breach_template | text | NO | — |
| enforcement_type | text | NO | — |
| enforcement_authority | text | YES | — |
| trespass_duration_years | integer | YES | 2 |
| fine_amount | numeric(10,2) | YES | — |
| vacate_hours | integer | YES | 4 |
| authorized_signatories | jsonb | YES | '[]' |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

---

## public.notices_to_vacate

**Primary key:** `id` (uuid, NOT NULL)  
**Source migration:** `supabase/migrations/20250202000002_notice_to_vacate_system.sql`

| Column | Type | Nullable | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| reference_number | text | NO | — |
| organization_id | uuid | NO | — |
| zone_id | uuid | NO | — |
| vehicle_id | uuid | YES | — |
| plate_number | text | NO | — |
| recipient_name | text | YES | — |
| breach_reason | text | NO | — |
| nights_stayed | integer | YES | — |
| breach_date | date | NO | — |
| breach_details | jsonb | YES | '{}' |
| notice_document_url | text | YES | — |
| notice_html | text | YES | — |
| delivery_method | text | YES | — |
| delivered_to_email | text | YES | — |
| delivered_to_officer | uuid | YES | — |
| delivered_at | timestamptz | YES | — |
| status | text | YES | 'draft' |
| issued_by | uuid | NO | — |
| issued_at | timestamptz | YES | — |
| authorized_by | uuid | YES | — |
| authorized_at | timestamptz | YES | — |
| vacate_deadline | timestamptz | YES | — |
| complied_at | timestamptz | YES | — |
| compliance_verified_by | uuid | YES | — |
| escalated_at | timestamptz | YES | — |
| escalation_notes | text | YES | — |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

---

## public.infringement_notices

**Primary key:** `id` (uuid, NOT NULL)  
**Source migration:** `supabase/migrations/20260219000002_evidence_integrity_and_legal_compliance.sql`

| Column | Type | Nullable | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| organization_id | uuid | NO | — |
| observation_id | uuid | YES | — |
| breach_alert_id | uuid | YES | — |
| template_id | uuid | YES | — |
| notice_number | text | NO | — |
| plate_number | text | NO | — |
| offence_description | text | NO | — |
| legal_basis | text | NO | — |
| offence_date | timestamptz | NO | — |
| offence_location | text | NO | — |
| offence_location_gps | text | YES | — |
| fee_amount | numeric(10,2) | NO | — |
| payment_methods | jsonb | YES | '[]' |
| payment_deadline | date | NO | — |
| payment_reference | text | YES | — |
| summary_of_rights | text | NO | — |
| service_method | text | NO | — |
| served_at | timestamptz | YES | — |
| delivery_evidence | jsonb | YES | '{}' |
| recipient_name | text | YES | — |
| recipient_address | text | YES | — |
| recipient_email | text | YES | — |
| status | text | YES | 'draft' |
| issued_by | uuid | YES | — |
| issued_at | timestamptz | YES | — |
| reminder_sent_at | timestamptz | YES | — |
| court_referral_date | date | YES | — |
| withdrawn_reason | text | YES | — |
| notice_pdf_url | text | YES | — |
| notice_pdf_hash | text | YES | — |
| evidence_bundle_url | text | YES | — |
| evidence_bundle_hash | text | YES | — |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

---

## public.patrol_schedule_zones

**Primary key:** `id` (uuid, NOT NULL)  
**Source migration:** `supabase/migrations/20260409000002_patrol_schedule_and_kpis.sql`

| Column | Type | Nullable | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| patrol_id | uuid | NO | — |
| zone_id | uuid | NO | — |
| visit_order | integer | NO | 0 |
| estimated_duration_minutes | integer | YES | — |
| actual_duration_minutes | integer | YES | — |
| visited_at | timestamptz | YES | — |
| completed_at | timestamptz | YES | — |
| created_at | timestamptz | NO | now() |

---

## public.officer_shifts

**Primary key:** `id` (uuid, NOT NULL)  
**Source migration:** `supabase/migrations/20260409000002_patrol_schedule_and_kpis.sql`

| Column | Type | Nullable | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| officer_id | uuid | NO | — |
| organization_id | uuid | NO | — |
| parent_zone_id | uuid | YES | — |
| started_at | timestamptz | NO | now() |
| ended_at | timestamptz | YES | — |
| end_reason | text | YES | — |
| gps_start_lat | double precision | YES | — |
| gps_start_lng | double precision | YES | — |
| gps_end_lat | double precision | YES | — |
| gps_end_lng | double precision | YES | — |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

---

## public.officer_welfare_settings

**Primary key:** `id` (uuid, NOT NULL)  
**Source migration:** `supabase/migrations/20250201000002_officer_welfare_system.sql`

| Column | Type | Nullable | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| organization_id | uuid | NO | — |
| user_id | uuid | NO | — |
| auto_logoff_enabled | boolean | YES | true |
| welfare_check_enabled | boolean | YES | true |
| inactivity_warning_time | integer | YES | 10 |
| auto_logoff_time | integer | YES | 20 |
| gps_inactivity_threshold | integer | YES | 10 |
| admin_escalation_time | integer | YES | 5 |
| critical_escalation_time | integer | YES | 5 |
| investigation_exception_enabled | boolean | YES | true |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

---

## public.officer_welfare_alerts

**Primary key:** `id` (uuid, NOT NULL)  
**Source migration:** `supabase/migrations/20250201000002_officer_welfare_system.sql`

| Column | Type | Nullable | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| officer_id | uuid | NO | — |
| organization_id | uuid | NO | — |
| alert_type | text | NO | — |
| status | text | YES | 'pending' |
| officer_name | text | NO | — |
| officer_phone | text | YES | — |
| gps_latitude | numeric(10,8) | YES | — |
| gps_longitude | numeric(11,8) | YES | — |
| gps_accuracy | numeric(10,2) | YES | — |
| last_activity_at | timestamptz | NO | — |
| alert_sent_at | timestamptz | YES | now() |
| acknowledged_at | timestamptz | YES | — |
| acknowledged_by | uuid | YES | — |
| resolved_at | timestamptz | YES | — |
| resolved_by | uuid | YES | — |
| escalation_level | integer | YES | 1 |
| escalated_at | timestamptz | YES | — |
| acknowledgement_notes | text | YES | — |
| resolution_notes | text | YES | — |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

---

## public.officer_activity_log

**Primary key:** `id` (uuid, NOT NULL)  
**Source migration:** `supabase/migrations/20250201000002_officer_welfare_system.sql`

| Column | Type | Nullable | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| user_id | uuid | NO | — |
| organization_id | uuid | NO | — |
| activity_type | text | NO | — |
| gps_latitude | numeric(10,8) | YES | — |
| gps_longitude | numeric(11,8) | YES | — |
| gps_accuracy | numeric(10,2) | YES | — |
| metadata | jsonb | YES | '{}' |
| recorded_at | timestamptz | YES | now() |
| created_at | timestamptz | YES | now() |

---

## public.health_safety_reports

**Primary key:** `id` (uuid, NOT NULL)  
**Source migration:** `supabase/migrations/20250101_initial_schema.sql`

| Column | Type | Nullable | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| organization_id | uuid | NO | — |
| zone_id | uuid | YES | — |
| reported_by | uuid | YES | — |
| incident_type | text | YES | — |
| description | text | YES | — |
| severity | text | YES | — |
| status | text | YES | 'open' |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

---

## public.person_records

**Primary key:** `id` (uuid, NOT NULL)  
**Source migration:** `supabase/migrations/20250101_initial_schema.sql`

| Column | Type | Nullable | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| organization_id | uuid | YES | — |
| first_name | text | YES | — |
| last_name | text | YES | — |
| date_of_birth | date | YES | — |
| is_of_interest | boolean | YES | false |
| notes | text | YES | — |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

---

## public.person_observations

**Primary key:** `id` (uuid, NOT NULL)  
**Source migration:** `supabase/migrations/20260220000005_core_pipeline_rebuild.sql`

| Column | Type | Nullable | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| person_id | uuid | YES | — |
| organization_id | uuid | YES | — |
| zone_id | uuid | YES | — |
| observed_by | uuid | YES | — |
| observed_at | timestamptz | NO | — |
| gps_latitude | numeric(10,8) | YES | — |
| gps_longitude | numeric(11,8) | YES | — |
| notes | text | YES | — |
| attachments | jsonb | YES | '[]' |
| created_at | timestamptz | YES | now() |

---

## public.person_vehicle_links

**Primary key:** `id` (uuid, NOT NULL)  
**Source migration:** `supabase/migrations/20260220000005_core_pipeline_rebuild.sql`

| Column | Type | Nullable | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| person_id | uuid | YES | — |
| plate_number | text | YES | — |
| relationship_type | text | YES | — |
| confidence | text | YES | — |
| linked_at | timestamptz | YES | now() |
| linked_by | uuid | YES | — |

---

## public.person_interactions

**Primary key:** `id` (uuid, NOT NULL)  
**Source migration:** `supabase/migrations/20250212000006_streamlined_reporting_system.sql`

| Column | Type | Nullable | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| organization_id | uuid | NO | — |
| person_id | uuid | NO | — |
| interaction_type | text | NO | — |
| zone_id | uuid | YES | — |
| gps_latitude | numeric(10,8) | YES | — |
| gps_longitude | numeric(11,8) | YES | — |
| officer_id | uuid | NO | — |
| officer_notes | text | YES | — |
| vehicle_id | text | YES | — |
| incident_id | uuid | YES | — |
| hs_report_id | uuid | YES | — |
| photos | text[] | YES | — |
| attachments | jsonb | YES | — |
| outcome | text | YES | — |
| requires_follow_up | boolean | YES | false |
| follow_up_date | date | YES | — |
| interaction_at | timestamptz | YES | nz_now() |
| created_at | timestamptz | YES | nz_now() |

---

## public.audit_log

**Primary key:** `id` (uuid, NOT NULL)  
**Source migration:** `supabase/migrations/20250101_initial_schema.sql`

| Column | Type | Nullable | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| action | text | NO | — |
| entity_type | text | YES | — |
| entity_id | text | YES | — |
| old_values | jsonb | YES | — |
| new_values | jsonb | YES | — |
| performed_by | uuid | YES | — |
| created_at | timestamptz | YES | now() |

---

## public.dispute_intake

**Primary key:** `id` (uuid, NOT NULL)  
**Source migration:** `supabase/migrations/20260418000006_dispute_portal_and_intake.sql`

| Column | Type | Nullable | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| organization_id | uuid | YES | — |
| zone_id | uuid | YES | — |
| source_type | text | NO | — |
| source_reference | text | YES | — |
| plate_number | text | YES | — |
| claimant_name | text | YES | — |
| claimant_email | text | YES | — |
| claimant_phone | text | YES | — |
| message | text | NO | — |
| request_homeless_review | boolean | NO | false |
| hardship_context | text | YES | — |
| evidence_statement | text | YES | — |
| submitted_via | text | NO | 'public_portal' |
| status | text | NO | 'received' |
| assigned_to | uuid | YES | — |
| admin_notes | text | YES | — |
| submitted_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

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
  - Tables with full Row/Insert/Update types: `organizations`, `user_profiles`, `zones`, `canonical_vehicles`, `observations`, `breach_alerts`, `patrols`, `patrol_checkpoints`, `checkpoint_visits`, `privacy_curtain_settings`, `privacy_access_log`, `import_batches`, `enforcement_actions`, `health_safety_reports`, `officer_welfare_alerts`, `compliance_results`, `incidents`, `notifications`, `user_sessions`, `homeless_records`, `officer_activity_log`, `person_vehicle_links`, `infringement_notices`, `notices_to_vacate`, `admin_recalculation_actions`, `restrictions`, `zone_compliance_matrix`, `photo_metadata`, `vehicle_discrepancies`, `officer_shifts`, `patrol_site_visits`, `patrol_schedule_zones`, `flagged_vehicles`, `canonical_scv`, `canonical_homeless`, `dispute_intake`
  - Functions: includes `get_patrol_kpis`, `is_zone_seasonally_open` (added Schema Extract #29)
- `src/types/index.ts` — application-level interfaces (`Vehicle`, `Observation`, `BreachAlert`, etc.)

When this schema changes, **both files must be updated in the same PR** as the migration.
