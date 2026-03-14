# Live Database Functions — Authoritative Reference

> ⚠️ **GOVERNANCE NOTICE**
> This file is the single source of truth for all live Supabase database functions
> (stored procedures, trigger functions, RPC endpoints, and extension functions).
> **No function may be created, altered, or dropped without an approved Pull Request
> reviewed by `@DonSquires`.** New migrations that add or modify functions must update
> this document in the same PR.
> See [SCHEMA_VALIDATION_CHECKLIST.md](../SCHEMA_VALIDATION_CHECKLIST.md) and
> [LIVE_SCHEMA.md](LIVE_SCHEMA.md) for the full governance policy.

**Last verified:** 2026-03-13  
**Verified by:** Copilot schema alignment audit against live Supabase instance

---

## How to Keep This Document Current

Re-query the live database whenever a migration adds or modifies a function:

```sql
SELECT
  n.nspname           AS schema,
  p.proname           AS function_name,
  pg_get_function_arguments(p.oid) AS arguments,
  pg_get_function_result(p.oid)    AS return_type,
  l.lanname           AS language,
  CASE p.prokind WHEN 'f' THEN 'function' WHEN 'p' THEN 'procedure'
                 WHEN 'a' THEN 'aggregate' WHEN 'w' THEN 'window' END AS kind,
  CASE p.provolatile WHEN 'i' THEN 'immutable'
                     WHEN 's' THEN 'stable'
                     WHEN 'v' THEN 'volatile' END AS volatility,
  p.prosecdef         AS security_definer
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_language  l ON l.oid = p.prolang
WHERE n.nspname IN ('public','cron','extensions','graphql','graphql_public','pgbouncer')
  AND p.prokind = 'f'
ORDER BY n.nspname, p.proname;
```

Update this file, then open a PR for review by `@DonSquires`.

---

## Section Index

1. [Application Functions (public schema)](#1-application-functions-public-schema)
   - 1a. [Compliance & Enforcement](#1a-compliance--enforcement)
   - 1b. [Trigger Functions](#1b-trigger-functions)
   - 1c. [Utility & GPS Helpers](#1c-utility--gps-helpers)
   - 1d. [Data Migration & Maintenance](#1d-data-migration--maintenance)
   - 1e. [Access Control (security_definer)](#1e-access-control-security_definer)
   - 1f. [PostGIS Application Wrappers](#1f-postgis-application-wrappers)
   - 1g. [Analytics & Query RPCs (get_* functions)](#1g-analytics--query-rpcs-get_-functions)
   - 1h. [Action & Write RPCs](#1h-action--write-rpcs)
   - 1i. [Additional Trigger Functions](#1i-additional-trigger-functions)
2. [Cron Functions (cron schema)](#2-cron-functions-cron-schema)
3. [Extension Functions (extensions schema)](#3-extension-functions-extensions-schema)
4. [GraphQL Functions (graphql / graphql_public schemas)](#4-graphql-functions-graphql--graphql_public-schemas)
5. [PgBouncer Functions (pgbouncer schema)](#5-pgbouncer-functions-pgbouncer-schema)
6. [PostGIS Internal Functions (public schema — system-owned)](#6-postgis-internal-functions-public-schema--system-owned)
7. [pg_trgm Extension Functions (public schema — system-owned)](#7-pg_trgm-extension-functions-public-schema--system-owned)
8. [Realtime Functions (realtime schema)](#8-realtime-functions-realtime-schema)
9. [Storage Functions (storage schema)](#9-storage-functions-storage-schema)
10. [Vault Functions (vault schema)](#10-vault-functions-vault-schema)

---

## 1. Application Functions (public schema)

These functions are defined by the application's migrations and implement core business logic.
Any change requires a new migration and an approved PR.

### 1a. Compliance & Enforcement

#### `public.calculate_vehicle_compliance_v3`

```sql
calculate_vehicle_compliance_v3(
  p_plate_number       text,
  p_zone_id            uuid,
  p_check_date         date,
  p_observation_id     uuid,
  p_observation_time   timestamp with time zone
)
RETURNS TABLE (
  is_compliant            boolean,
  at_risk                 boolean,
  breach_type             text,
  violation_reasons       text[],
  nights_stayed           integer,
  nights_allowed          integer,
  consecutive_nights      integer,
  consecutive_allowed     integer,
  is_overnight_stay       boolean,
  is_day_visit_only_zone  boolean,
  is_homeless_exempt      boolean,
  matrix_snapshot         jsonb
)
```

| Property | Value |
|---|---|
| Language | plpgsql |
| Volatility | volatile |
| Security definer | false |

**Purpose:** Core v3 compliance engine. Evaluates a single plate against the zone compliance matrix rules in effect at `p_observation_time`. Returns full compliance state including breach type, violation reasons, night counts, and the matrix snapshot used.

**Called by:** `recalculate-compliance-v3` edge function, `auto_evaluate_compliance` trigger.

> ⚠️ **Do not modify without updating `supabase/functions/recalculate-compliance-v3/index.ts` and all callers.**

---

#### `public.check_vehicle_compliance_v3`

```sql
check_vehicle_compliance_v3(
  p_plate_number  text,
  p_zone_id       uuid,
  ...
)
RETURNS TABLE (
  is_compliant          boolean,
  violation_type        text,
  violation_message     text,
  consecutive_nights    integer,
  month_nights          integer,
  fc_act_exempt         boolean,
  will_breach_tonight   boolean
)
```

| Property | Value |
|---|---|
| Language | plpgsql |
| Volatility | stable |
| Security definer | **true** |

**Purpose:** Lightweight compliance check RPC, callable by authenticated clients via PostgREST. Returns a simplified compliance summary — use for real-time UI status checks without a full recalculation.

**Called by:** Field officer scan flow, vehicle detail pages.

---

#### `public.calculate_compliance_status`

```sql
calculate_compliance_status(p_employer_org_id uuid)
RETURNS text
```

| Property | Value |
|---|---|
| Language | plpgsql |
| Volatility | stable |
| Security definer | false |

**Purpose:** Returns the compliance status text for a given employer organisation. Used by credential checks and officer workflow gates.

---

#### `public.check_organization_compliance`

```sql
check_organization_compliance(p_user_id uuid, ...)
RETURNS TABLE (
  can_work       boolean,
  missing_items  text[],
  employer_name  text
)
```

| Property | Value |
|---|---|
| Language | plpgsql |
| Volatility | volatile |
| Security definer | **true** |

**Purpose:** Checks whether a given user meets all credential and organisational requirements to begin a work shift. Returns `can_work` flag plus a list of any missing items (e.g. expired COA, unverified warrant).

**Called by:** Officer login flow, compliance gate in `App.tsx`.

---

#### `public.format_violation_reasons`

```sql
format_violation_reasons(
  violation_reasons  text[],
  after_hours        boolean,
  ...
)
RETURNS text
```

| Property | Value |
|---|---|
| Language | plpgsql |
| Volatility | volatile |
| Security definer | false |

**Purpose:** Formats a `violation_reasons` array into a human-readable text string for display in breach alerts and enforcement notices.

---

### 1b. Trigger Functions

Trigger functions return `trigger` and are wired to `observations` and `canonical_vehicles` via `CREATE TRIGGER`. They must not be called directly.

> ⚠️ **Any change to a trigger function requires a migration. The trigger body and the calling table/event must be documented here.**

| Function | Table | Timing | Event | Purpose |
|---|---|---|---|---|
| `auto_evaluate_compliance()` | observations | BEFORE | INSERT | Calls `calculate_vehicle_compliance_v3`; sets `is_compliant`, `consecutive_nights`, `nights_stayed_this_month`, `compliance_snapshot`, `breach_type`, `breach_reason` on `NEW` |
| `auto_create_compliance_result()` | observations | AFTER | INSERT | Inserts a row in `compliance_results` from the computed values on `NEW` |
| `log_observation_deletion()` | observations | BEFORE | DELETE | Copies deleted row snapshot into `observation_deletions` |
| `populate_observation_from_canonical()` | observations | BEFORE | INSERT | Looks up `canonical_vehicles` by `plate_number`; denormalises `vehicle_make`, `vehicle_model`, `vehicle_color`, `vehicle_year` (cast TEXT→INTEGER via regex guard, see 20260409000001), `self_contained`, `self_contained_expiry` onto `NEW`. Top-level `EXCEPTION` block prevents type drift from blocking INSERTs. |
| `sync_homeless_to_canonical()` | observations | AFTER | INSERT | When `has_homeless_claim = true`, updates `canonical_vehicles.is_homeless` and `homeless_status` |
| `update_canonical_stats_v2()` | observations | AFTER | INSERT | Increments `total_observations`, `last_seen_at`, and related counters on `canonical_vehicles` |
| `update_monthly_stays_on_observation()` | observations | AFTER | INSERT | Upserts `vehicle_monthly_stays` for the month of `recorded_at`; increments `nights_stayed`, `consecutive_nights` |

**COALESCE type safety note:** All trigger functions that use `COALESCE` must cast through `::text` first. PostgreSQL evaluates `COALESCE` types before applying casts. Use `BEGIN/EXCEPTION` blocks for ultra-defensive type conversion. See `SCHEMA_VALIDATION_CHECKLIST.md §5`.

---

#### `public.can_user_modify_observation`

```sql
can_user_modify_observation(
  p_observation_id  uuid,
  p_user_id         uuid
)
RETURNS boolean
```

| Property | Value |
|---|---|
| Language | plpgsql |
| Volatility | volatile |
| Security definer | **true** |

**Purpose:** Returns `true` if the given user is permitted to UPDATE or DELETE the specified observation. Logic: recorded_by = user within 24 h of creation, OR user has admin/master role. Used inside RLS policies so the check executes with elevated permissions.

---

### 1c. Utility & GPS Helpers

#### `public.calculate_gps_distance`

```sql
calculate_gps_distance(
  lat1  numeric,
  lng1  numeric,
  lat2  numeric,
  lng2  numeric
)
RETURNS numeric
```

| Property | Value |
|---|---|
| Language | plpgsql |
| Volatility | immutable |
| Security definer | false |

**Purpose:** Haversine formula — returns distance in metres between two GPS coordinates. Used by `recalculate-compliance-v3` for GPS-verified consecutive night detection.

---

#### `public.find_zone_by_gps`

```sql
find_zone_by_gps(
  p_latitude   numeric,
  p_longitude  numeric,
  ...
)
RETURNS TABLE (
  zone_id         uuid,
  zone_name       text,
  match_type      text,
  distance_meters integer
)
```

| Property | Value |
|---|---|
| Language | plpgsql |
| Volatility | stable |
| Security definer | false |

**Purpose:** Returns matching zones for a GPS coordinate. `match_type` is `'inside'` (point in polygon), `'nearby'` (within geofence radius), or `'nearest'` (closest available zone). Used by patrol geofence check-in and observation auto-zone assignment.

---

#### `public.nz_now`

```sql
nz_now()
RETURNS timestamptz
```

| Property | Value |
|---|---|
| Language | sql |
| Volatility | stable |
| Security definer | false |

**Purpose:** Returns `NOW()` cast to `Pacific/Auckland` timezone. Used as a column default on NZ-localised timestamp columns (`deleted_at`, `created_at` on many tables). **Never replace with `NOW()` directly in NZ-timezone columns.**

---

#### `public.detect_missing_photos`

```sql
detect_missing_photos(
  p_organization_id  uuid,
  p_date_from        date,
  ...
)
RETURNS TABLE (
  inserted_count  bigint,
  already_queued  bigint
)
```

| Property | Value |
|---|---|
| Language | plpgsql |
| Volatility | volatile |
| Security definer | **true** |

**Purpose:** Scans observations that have no photo and queues them in `alert_queue` for follow-up. Returns counts of newly queued vs already-queued alerts. Used by the `daily-photo-reconciler` edge function.

---

### 1d. Data Migration & Maintenance

#### `public.migrate_legacy_vehicle_records`

```sql
migrate_legacy_vehicle_records()
RETURNS TABLE (
  plates_processed      integer,
  records_created       integer,
  observations_processed integer
)
```

| Property | Value |
|---|---|
| Language | plpgsql |
| Volatility | volatile |
| Security definer | false |

**Purpose:** One-time migration utility that copies rows from `vehicle_records_deprecated_20250131` into `canonical_vehicles` and `observations`. Safe to re-run (idempotent); logs results to `vehicle_migration_log`. Used by `import-historical-data` edge function.

> **Note:** `vehicle_records_deprecated_20250131` is frozen — do not insert into it.

---

#### `public.check_unmigrated_vehicle_records`

```sql
check_unmigrated_vehicle_records()
RETURNS TABLE (
  unmigrated_count  bigint,
  oldest_record     timestamp with time zone,
  newest_record     timestamp with time zone,
  unique_plates     bigint
)
```

| Property | Value |
|---|---|
| Language | sql |
| Volatility | volatile |
| Security definer | false |

**Purpose:** Diagnostic query — returns count of rows in `vehicle_records_deprecated_20250131` that have not yet been migrated to the canonical schema.

---

#### `public.cleanup_duplicate_canonical_vehicles`

```sql
cleanup_duplicate_canonical_vehicles()
RETURNS TABLE (
  plate_number  text,
  count         bigint,
  vehicle_ids   uuid[]
)
```

| Property | Value |
|---|---|
| Language | sql |
| Volatility | volatile |
| Security definer | false |

**Purpose:** Finds duplicate `vehicle_id` values in `canonical_vehicles`. Should return 0 rows in a healthy database; any results indicate a data integrity issue requiring manual review.

---

### 1e. Access Control (security_definer)

Functions marked `security_definer = true` execute with the permissions of their owner (the migration user), not the calling user. They bypass RLS. **Any new security_definer function must be reviewed with extra scrutiny.**

| Function | Returns | Purpose |
|---|---|---|
| `check_vehicle_compliance_v3` | TABLE | Compliance check bypassing RLS to read zone matrix |
| `check_organization_compliance` | TABLE | Reads across org hierarchy to check credentials |
| `can_user_modify_observation` | boolean | Used inside RLS policy — needs elevated perms |
| `detect_missing_photos` | TABLE | Cross-org photo audit queue insertion |

> **Security rule:** `security_definer` functions must validate the calling user's identity and org membership themselves before accessing cross-org data.

---

### 1f. PostGIS Application Wrappers

These are PostGIS helper functions used by migrations or directly by application code.
They wrap low-level PostGIS C functions and are managed via `CREATE EXTENSION postgis`.

| Function | Purpose |
|---|---|
| `addgeometrycolumn(schema, table, column, srid, type, dim)` | Adds a geometry column to a table (used in migrations) |
| `dropgeometrycolumn(schema, table, column)` | Removes a geometry column |
| `dropgeometrytable(schema, table)` | Drops a table with geometry columns |
| `find_srid(schema, table, column)` | Returns the SRID for a geometry column |

> These are managed entirely by `CREATE EXTENSION postgis`. Do not define or alter them manually.

---

### 1g. Analytics & Query RPCs (get_* functions)

These functions are the primary read-only RPC endpoints used by the admin dashboard and reporting pages.
All are callable via PostgREST (`/rpc/<function_name>`). Most are `security_definer = true` so they can
read across organisation boundaries under controlled conditions.

| Function | Returns | Volatility | sec_def | Purpose |
|---|---|---|---|---|
| `get_active_breaches(p_organization_id uuid, p_date_from ...)` | TABLE (plate, zone, breach stats, compliance metrics) | volatile | false | Full active breach list for an org with vehicle stats, enforcement status, night counts |
| `get_admin_dashboard_stats(p_start_date timestamp)` | TABLE (observation counts, compliance rate, breach stats, officer/patrol/vehicle counts) | stable | **true** | All KPIs for the admin dashboard in a single call |
| `get_available_job_types(...)` | TABLE(id uuid, name text, description text, is_custom boolean) | volatile | **true** | Returns investigation job types visible to the calling user's org |
| `get_compliance_analytics_summary(p_start timestamp)` | jsonb | stable | **true** | Aggregated compliance analytics as a single JSON object (used by analytics charts) |
| `get_compliance_stats(p_start timestamp, ...)` | TABLE(total_observations, breach_count, compliant_count, compliance_rate, flagged_vehicles, homeless_vehicles) | stable | **true** | Summary compliance counts for a date range |
| `get_effective_homeless_status(p_organization_id uuid)` | text | stable | false | Returns the effective homeless exemption policy text for an org |
| `get_gps_verified_breach_evidence(p_plate_number text, p_zone_id uuid, ...)` | jsonb | volatile | false | Returns GPS-verified consecutive night evidence for a plate/zone pair |
| `get_import_batch_status(...)` | TABLE(batch_id, batch_name, status, progress counters, enrichment_rate, completion_pct, timestamps) | volatile | **true** | Live import batch progress for the import wizard UI |
| `get_active_officers(...)` | TABLE(user_id, first_name, last_name, phone, org, GPS coords, recent_scans, welfare_status) | volatile | **true** | All active officers with GPS and activity summary (officer welfare dashboard) |
| `get_recent_scans(...)` | TABLE(observation_id, plate, zone, recorded_at, officer, breach/compliance/homeless flags, can_edit, can_delete, photo) | volatile | **true** | Recent scan feed for the field portal and admin live view |
| `get_observation_edit_status(p_observation_id uuid, p_user_id uuid)` | TABLE(can_edit bool, can_delete bool, hours_remaining numeric, is_own_scan bool) | stable | **true** | Returns edit/delete permission flags for a specific observation (used before showing edit UI) |
| `get_active_patrol(...)` | TABLE(patrol_id, zone_id, zone_name, patrol_date, shift, geofence info, timestamps, geometry) | stable | **true** | Returns the active patrol for the calling officer |
| `get_active_investigation_job(...)` | TABLE(job_id, reference_number, job_type, location, instructions, priority, GPS, timestamps) | stable | **true** | Returns the active investigation job assigned to the calling officer |
| `get_org_scans_24h(p_user_id uuid, p_filter_breaches boolean)` | TABLE(observation_id, plate, zone, recorded_at, officer, flags, can_edit, can_delete, photo, GPS) | stable | **true** | All org scans from the last 24 h — main feed for the admin scan view |
| `get_pending_alerts(...)` | TABLE(alert_id, alert_type, priority, title, message, can_dismiss, created_at, vehicle_plate, zone_name) | stable | **true** | Pending alerts from `alert_queue` for the calling user's notification centre |
| `get_person_interactions(...)` | TABLE(interaction_id, interaction_type, officer_name, zone_name, interaction_at, notes, outcome) | stable | **true** | Interaction history for a person record |
| `get_person_observations(...)` | TABLE(id, observation_type, recorded_at, officer_name, zone_name, plate, notes, evidence_photos, vehicle details) | volatile | **true** | Person-linked observation records |
| `get_shift_period(observation_time timestamp)` | text | immutable | false | Returns `'morning'`/`'afternoon'`/`'evening'`/`'night'` for a given timestamp — used in compliance analytics |
| `get_user_org()` | uuid | stable | **true** | Returns the `organization_id` of the currently authenticated user |
| `get_user_accessible_zones()` | uuid[] | stable | **true** | Returns all zone UUIDs accessible to the current user (respects `authorized_work_locations`) |
| `get_user_role()` | text | stable | **true** | Returns the `role` of the currently authenticated user |
| `get_vehicle_profile(...)` | TABLE(plate, make, model, year int, color, self_contained, self_contained_expiry, homeless fields, flagged fields, photo, observation/breach/incident/enforcement counts, timestamps) | stable | **true** | Full canonical vehicle profile — used by vehicle detail pages |
| `get_vehicle_notes(...)` | TABLE(observation_id, officer_notes, recorded_at, recorded_by_name, zone_name) | volatile | **true** | Officer notes linked to a vehicle's observation history |
| `get_vehicle_overnight_status(p_plate_number text, p_zone_id uuid)` | TABLE(already_scanned_today bool, nights_stayed_this_month int, max_consecutive_nights int, is_about_to_breach bool, is_breach bool) | volatile | **true** | Overnight stay summary for the scan confirmation screen |
| `get_vehicle_observation_history(...)` | TABLE(observation_id, recorded_at, is_compliant, GPS coords, evidence_photos, notes, zone_name, violation_reasons) | volatile | **true** | Full observation history for a vehicle on the vehicle detail page |
| `get_zone_compliance_breakdown(p_start timestamp)` | TABLE(zone_id, zone_name, org_name, is_active, nights/consecutive limits, self_contained, day_visit, obs_count, breach_count, compliance_pct) | stable | **true** | Per-zone compliance breakdown for the compliance reports page |
| `get_deactivation_queue()` | TABLE(user_id uuid, email text, action text, should_disable boolean) | stable | **true** | Returns users pending deactivation processing |

> **Note on unnamed functions:** Several of the above have no explicit name visible in the raw dump (their rows showed only return type). Names are inferred from their return-type signatures and from TypeScript callers in `src/lib/edgeFunctions.ts`. Verify with:
> ```sql
> SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname LIKE 'get_%' ORDER BY proname;
> ```

---

### 1h. Action & Write RPCs

These functions perform writes and are called from edge functions or directly from the frontend via PostgREST RPC.
All are `security_definer = true` unless noted — they validate the caller's identity internally.

| Function | Arguments (summary) | Returns | Purpose |
|---|---|---|---|
| `is_same_calendar_day(p_plate_number, p_zone_id)` | plate, zone | boolean | Returns true if the plate already has an observation for today in the zone — prevents duplicate scans |
| `log_compliance_check(p_user_id, p_check_type, ...)` | user, check type, result fields | void | Inserts a row into `compliance_audit_log`; called at every login/shift start |
| `log_officer_activity(p_user_id, p_activity_type, p_gps_latitude, p_gps_longitude, p_gps_accuracy, ...)` | user, activity, GPS | uuid | Inserts into `officer_activity_log`; returns new log entry ID |
| `log_officer_gps_update(p_user_id, p_latitude, p_longitude, ...)` | user, GPS coords | uuid | Updates `user_profiles` GPS fields and inserts an activity log entry |
| `mark_deactivation_processed(queue_user_id, success, ...)` | user, success flag | void | Marks a `user_deactivation_queue` row as processed |
| `migrate_legacy_vehicles(p_dry_run, p_organization_id, ...)` | dry_run flag, org | TABLE(action, plate, vehicle_id, obs_created, message) | Migrates legacy vehicle records to canonical schema; supports dry-run mode |
| `patrol_auto_checkin(p_patrol_id, p_gps_lat, p_gps_lng, ...)` | patrol ID, GPS | jsonb | Checks officer GPS against patrol zone geofence; marks patrol as checked-in if inside radius |
| `patrol_complete(...)` | patrol ID, completion data | jsonb | Marks a patrol as completed; updates `patrols.status` and timestamps |
| `quick_complete_investigation_job(p_job_id, p_completion_summary, p_vehicles_found, p_structures_found, ...)` | job ID, summary text, found items | jsonb | Fast-path completion for investigation jobs from the field; sets `quick_completion = true` |
| `queue_deactivation(...)` | user, action | text | Inserts a pending deactivation into `user_deactivation_queue` |
| `take_breach_action(p_breach_alert_id, p_action_status, p_user_id, p_monitoring_until, p_monitoring_notes, ...)` | breach alert ID, new status, user, monitoring dates | jsonb | Updates breach alert status (acknowledged/enforcement_started/resolved/dismissed); logs audit trail |
| `update_alert(...)` | alert ID, updates | jsonb | Updates an `alert_queue` row's status or acknowledgement fields |
| `update_import_batch_progress(p_batch_id, p_processed, ...)` | batch ID, counters | void | Atomically increments import batch progress counters in `import_batches` |
| `upsert_canonical_vehicle(p_plate_number, p_vehicle_make, p_vehicle_model, p_vehicle_year int, p_vehicle_color, ...)` | plate + vehicle fields | text | INSERT or UPDATE on `canonical_vehicles`; returns `'inserted'` or `'updated'` |
| `verify_vehicle_observation_counts()` | — | TABLE(vehicle_id, plate, stored_count int, actual_count bigint, mismatch bool) | Diagnostic — compares `canonical_vehicles.total_observations` against actual observation rows; any `mismatch=true` rows need manual reconciliation |
| `verify_officer_compliance(...)` | user ID | boolean | Returns true if officer meets all credential requirements to begin a shift |
| `nz_today()` | — | date | Returns today's date in `Pacific/Auckland` timezone — used as a default for date columns |

---

### 1i. Additional Trigger Functions

Beyond the core observation triggers in §1b, the following triggers are wired to other tables.
All return `trigger` and must not be called directly.

| Function | Table | Timing | Event | sec_def | Purpose |
|---|---|---|---|---|---|
| `set_updated_at()` | Multiple | BEFORE | UPDATE | false | Generic `updated_at = NOW()` stamp trigger; applied to most tables |
| `audit_log_changes()` | Multiple | AFTER | INSERT/UPDATE/DELETE | false | Writes old/new values to `audit_log` for auditable tables |
| `notify_breach_alert()` | breach_alerts | AFTER | INSERT | false | Sends a Postgres NOTIFY for Realtime subscription |
| `update_alert_queue_updated_at()` | alert_queue | BEFORE | UPDATE | false | Stamps `updated_at` on alert_queue changes |
| `handle_new_user()` | auth.users (via trigger) | AFTER | INSERT | **true** | Creates a `user_profiles` row when a new Supabase Auth user is created |
| `on_user_profile_change()` | user_profiles | AFTER | UPDATE | **true** | Handles credential status changes; may queue deactivation |
| `propagate_homeless_status()` | canonical_vehicles | AFTER | UPDATE | false | When `is_homeless` changes, propagates to linked observations |
| `refresh_drift_events()` | observations / vehicle_monthly_stays | AFTER | INSERT/UPDATE | false | Creates or refreshes `drift_events` when compliance state changes |
| `update_zone_snapshot()` | zones | AFTER | INSERT/UPDATE | false | Triggers `zone_geofence_monthly_snapshots` refresh |
| `update_investigation_job_timestamps()` | investigation_jobs | BEFORE | UPDATE | false | Stamps `updated_at`; validates status transitions |
| `update_patrol_timestamps()` | patrols | BEFORE | UPDATE | false | Stamps `updated_at` |

---

## 2. Cron Functions (cron schema)

These functions are part of the `pg_cron` extension and manage scheduled jobs.
Cron jobs that call application functions are documented here.

| Function | Arguments | Returns | Purpose |
|---|---|---|---|
| `cron.schedule` | `job_name text, schedule text, command text` | bigint | Creates or replaces a scheduled job; returns job ID |
| `cron.schedule_in_database` | `job_name text, schedule text, command text, database text, ...` | bigint | Schedules a job in a specific database |
| `cron.unschedule` | `job_name text` OR `job_id bigint` | boolean | Removes a scheduled job by name or ID |
| `cron.alter_job` | `job_id bigint, schedule text, command text, ...` | void | Updates an existing job's schedule or command |

### Active Cron Jobs

Cron jobs are defined in migrations and stored in `cron.job`. The following are expected:

| Job name | Schedule | Command | Purpose |
|---|---|---|---|
| `nightly-privacy-cleanup` | `0 2 * * *` (2 AM NZ) | `SELECT ...` | Calls `nightly-privacy-cleanup` edge function |
| `monitor-officer-welfare` | `*/5 * * * *` (every 5 min) | `SELECT ...` | Welfare check — man-down detection |

> **Governance:** Adding or modifying a cron job requires a migration (to call `cron.schedule`) and must be documented in this table. Do not add jobs via the Supabase dashboard.

**Validation:**
```sql
SELECT jobid, jobname, schedule, command, active
FROM cron.job
ORDER BY jobname;
```

---

## 3. Extension Functions (extensions schema)

These are managed by the `pg_stat_statements` extension. They provide query performance statistics.
Do not call these in application code.

| Function | Purpose |
|---|---|
| `extensions.pg_stat_statements(showtext boolean)` | Returns per-query execution statistics (plans, exec time, rows, I/O) |
| `extensions.pg_stat_statements_info()` | Returns metadata about the pg_stat_statements module |
| `extensions.pg_stat_statements_reset(userid, dbid, queryid)` | Resets collected statistics |

**Useful diagnostic query:**
```sql
SELECT query, calls, mean_exec_time, rows
FROM extensions.pg_stat_statements
WHERE query LIKE '%observations%'
ORDER BY mean_exec_time DESC
LIMIT 10;
```

---

## 4. GraphQL Functions (graphql / graphql_public schemas)

These are managed by the `pg_graphql` extension. Do not modify them.

| Function | Schema | Arguments | Returns | Purpose |
|---|---|---|---|---|
| `_internal_resolve` | graphql | `query text, variables jsonb, ...` | jsonb | Internal GraphQL execution engine |
| `resolve` | graphql | `query text, variables jsonb, "operationName" text` | jsonb | GraphQL resolver entry point |
| `graphql` | graphql_public | `"operationName" text, query text, variables jsonb` | jsonb | **Public API** — exposed via PostgREST as `rpc/graphql` |

> The project does not currently use the GraphQL API. All data access goes through PostgREST REST endpoints or Supabase Edge Functions.

---

## 5. PgBouncer Functions (pgbouncer schema)

| Function | Returns | Security definer | Purpose |
|---|---|---|---|
| `pgbouncer.get_auth(username text)` | `TABLE(username text, password text)` | **true** | Called by PgBouncer to look up connection pool credentials |

> **Security:** This function is security_definer and reads from `auth.users`. It is managed by Supabase infrastructure — do not modify.

---

## 6. PostGIS Internal Functions (public schema — system-owned)

The following categories of functions are installed by `CREATE EXTENSION postgis` and `CREATE EXTENSION postgis_topology`. They are **not application code** and must not be modified.

Hundreds of functions exist in this category. Key groups:

| Group | Prefix examples | Purpose |
|---|---|---|
| ST_ geometry functions | `ST_Area`, `ST_Distance`, `ST_Within`, `ST_Buffer`, `ST_Intersects`, `ST_Transform`, etc. | Core spatial operations used by zone boundary queries |
| ST_ geography functions | `ST_Distance(geography)`, `ST_DWithin(geography)` | Spheroid-accurate distance calculations |
| Geometry type I/O | `geometry_in`, `geometry_out`, `geography_in`, `geography_out` | Type serialisation |
| BRIN index support | `geom2d_brin_inclusion_add_value`, `geog_brin_inclusion_add_value`, etc. | Spatial BRIN index operations |
| GiST index support | `geometry_gist_*`, `geography_gist_*` | Spatial GiST index operations |
| Box/envelope | `box2d`, `box3d`, `ST_Envelope`, `ST_Extent` | Bounding box operations |
| Internal deprecation | `_postgis_deprecate`, `_postgis_selectivity`, `_st_*` | Internal helpers; not for direct use |
| Voronoi/topology | `_st_voronoi`, topology functions | Advanced spatial analysis |

**Validation — confirm PostGIS version:**
```sql
SELECT postgis_full_version();
-- Expected: POSTGIS="3.x.x ..."
```

---

## 7. pg_trgm Extension Functions (public schema — system-owned)

These functions are installed by `CREATE EXTENSION pg_trgm` and provide trigram-based fuzzy text search.
They underpin `ILIKE`-style plate number and vehicle name searches using GIN trigram indexes.
**Do not modify these functions.** They are managed entirely by the extension.

| Function | Purpose |
|---|---|
| `similarity(text, text)` | Returns a real-valued similarity score (0–1) between two strings |
| `word_similarity(text, text)` | Word-level similarity — partial match of one string against another |
| `strict_word_similarity(text, text)` | Stricter word-level similarity |
| `show_trgm(text)` | Returns the trigram set for a string — useful for debugging index performance |
| `show_limit()` / `set_limit(real)` | Gets/sets the similarity threshold for `%` operator |
| `gin_extract_value_trgm(text, internal)` | GIN index extraction support |
| `gin_extract_query_trgm(text, internal, ...)` | GIN query extraction support |
| `gin_trgm_consistent(internal, ...)` | GIN index consistency check |
| `gin_trgm_triconsistent(internal, ...)` | GIN triConsistency check |
| `gtrgm_in(cstring)` / `gtrgm_out(gtrgm)` | GiST type I/O |
| `gtrgm_consistent(internal, ...)` | GiST consistency check |
| `gtrgm_distance(internal, ...)` | GiST distance for KNN queries |
| `gtrgm_compress(internal)` / `gtrgm_decompress(internal)` | GiST compression support |
| `gtrgm_penalty(internal, ...)` | GiST penalty function |
| `gtrgm_picksplit(internal, internal)` | GiST split function |
| `gtrgm_union(internal, internal)` | GiST union function |
| `gtrgm_same(gtrgm, gtrgm, internal)` | GiST same-value comparison |
| `gtrgm_options(internal)` | GiST option handling |

**Validation — confirm pg_trgm is active:**
```sql
SELECT extname, extversion FROM pg_extension WHERE extname = 'pg_trgm';
-- Expected: pg_trgm | 1.6
```

**Usage in this project:** Plate number fuzzy search in `UniversalSearch.tsx`, vehicle registry filter, and the `plate_number_trgm_idx` GIN index on `observations.plate_number`.

---

## 8. Realtime Functions (realtime schema)

These functions are managed by Supabase Realtime. **Do not modify them.**
They handle WAL (Write-Ahead Log) replication and broadcast change events to subscribed clients.

| Function | Returns | Purpose |
|---|---|---|
| `realtime.apply_rls(wal jsonb, ...)` | SETOF realtime.wal_rls | Applies RLS filtering to WAL events before broadcasting to subscribers |
| `realtime.broadcast_changes(topic_name text, event_name text, ...)` | void | Broadcasts a change event to a named Realtime channel topic |
| `realtime.build_prepared_statement_sql(prepared_statement_name text, ...)` | text | Constructs parameterised SQL for subscription prepared statements |
| `realtime.cast(val text, type_ regtype)` | jsonb | Type-safe cast helper for WAL column values |
| `realtime.check_equality_op(op equality_op, type_ regtype, ...)` | boolean | Validates equality operators for subscription filters |
| `realtime.is_visible_through_filters(columns wal_column[], ...)` | boolean | Returns true if a WAL row passes all subscription column filters |
| `realtime.list_changes(publication name, slot_name name, ...)` | SETOF realtime.wal_rls | Core WAL consumer — reads changes from the replication slot and applies RLS |
| `realtime.quote_wal2json(entity regclass)` | text | Returns the quoted table identifier for wal2json output |
| `realtime.send(payload jsonb, event text, topic text, private boolean)` | void | Sends a message to a Realtime channel from SQL (used in triggers and cron jobs) |
| `realtime.subscription_check_filters(...)` | trigger | Trigger that validates subscription filter syntax on INSERT to `realtime.subscription` |
| `realtime.to_regrole(role_name text)` | regrole | Converts a role name to a regrole value for subscription claims |
| `realtime.topic()` | text | Returns the current Realtime topic name in a trigger context |

**Governance:** The `realtime.send()` function is safe to call from application triggers to push custom events to frontend subscribers. All other functions are Supabase-internal.

---

## 9. Storage Functions (storage schema)

These functions are managed by Supabase Storage. **Do not modify them.**
They implement the object storage API used by the `scans` bucket and other file storage.

| Function | Returns | Purpose |
|---|---|---|
| `storage.can_insert_object(bucketid, name, owner, metadata)` | void | Validates that an object INSERT satisfies bucket RLS policies; raises exception if not |
| `storage.extension(name text)` | text | Extracts the file extension from a storage object name |
| `storage.filename(name text)` | text | Extracts the filename (without path) from a storage object name |
| `storage.foldername(name text)` | text[] | Returns path components of a storage object name |
| `storage.get_common_prefix(p_key, p_prefix, p_delimiter)` | text | Returns the common path prefix for a group of objects (used in folder listing) |
| `storage.get_size_by_bucket()` | TABLE(size bigint, bucket_id text) | Returns total storage size per bucket |
| `storage.list_multipart_uploads_with_delimiter(bucket_id, prefix, delimiter, ...)` | TABLE(key, id, created_at) | Lists in-progress multipart uploads under a prefix with delimiter support |
| `storage.list_objects_with_delimiter(bucket_id, prefix, delimiter, ...)` | TABLE(name, id, metadata, timestamps) | Lists objects under a prefix, collapsing sub-paths at the delimiter |
| `storage.operation()` | text | Returns the current storage operation type in a trigger context (`INSERT`/`UPDATE`/`DELETE`) |
| `storage.search(prefix, bucketname, limits, ...)` | TABLE(name, id, updated_at, created_at, last_accessed_at, metadata) | Full-featured object search used by the Storage API for file browser queries |
| `storage.search_by_timestamp(p_prefix, p_bucket_id, p_limit, ...)` | TABLE(key, name, id, timestamps, metadata) | Timestamp-ordered object search variant |
| `storage.search_v2(prefix, bucket_name, limits, ...)` | TABLE(key, name, id, timestamps, metadata) | v2 search implementation with key-based pagination |
| `storage.update_updated_at_column()` | trigger | Trigger that stamps `updated_at` on object modifications |

**Governance for this project:**
- The `scans` bucket is **public-read**; RLS restricts uploads/deletes to `/{auth.uid()}/...` paths
- See migration `20260306_scans_bucket_rls.sql` for the RLS policy definitions
- Storage policies are version-controlled — any change requires a migration + PR review by `@DonSquires`

**Useful diagnostics:**
```sql
-- Check bucket sizes
SELECT * FROM storage.get_size_by_bucket();

-- List recent uploads in the scans bucket
SELECT name, created_at FROM storage.objects
WHERE bucket_id = 'scans'
ORDER BY created_at DESC LIMIT 20;
```

---

## 10. Vault Functions (vault schema)

These functions are managed by the Supabase Vault extension (`supabase_vault`).
They provide encrypted secret storage using `pgsodium` AEAD encryption.
**Do not modify these functions.** Access to vault secrets is restricted to `service_role`.

| Function | Arguments | Returns | sec_def | Purpose |
|---|---|---|---|---|
| `vault.create_secret(new_secret text, new_name text, ...)` | secret text, name, description | uuid | **true** | Creates an encrypted secret in `vault.secrets`; returns the secret UUID |
| `vault.update_secret(secret_id uuid, new_secret text, new_name text, ...)` | secret ID, new values | void | **true** | Updates an existing vault secret |
| `vault._crypto_aead_det_decrypt(message bytea, additional bytea, key_id uuid, ...)` | ciphertext + key info | bytea | false | Low-level AEAD decryption (pgsodium) |
| `vault._crypto_aead_det_encrypt(message bytea, additional bytea, key_id uuid, ...)` | plaintext + key info | bytea | false | Low-level AEAD encryption (pgsodium) |
| `vault._crypto_aead_det_noncegen()` | — | bytea | false | Generates a deterministic nonce for AEAD encryption (used as `vault.secrets.nonce` default) |

**Governance:** Vault secrets store sensitive values (API keys, webhook secrets) referenced by edge functions via `vault.decrypted_secrets`. Any new secret must be:
1. Created via a migration or the Supabase dashboard (never committed in plaintext)
2. Referenced in edge functions using `SELECT secret FROM vault.decrypted_secrets WHERE name = '...'`
3. Documented in `docs/LIVE_SCHEMA.md` §Vault (by name only — never the value)

```sql
-- List vault secret names (safe — does NOT expose values)
SELECT id, name, description, created_at FROM vault.secrets ORDER BY name;
```

---



### When adding a new function

1. Write the function in a new migration file (`supabase/migrations/YYYYMMDD_add_<function_name>.sql`)
2. Add the function to this document in the correct section
3. If `security_definer = true`, add a note explaining what cross-permission access is needed and how the calling user's identity is validated
4. Update `SCHEMA_VALIDATION_CHECKLIST.md` if the function is called from a trigger
5. Open a PR and request review from `@DonSquires`

### When modifying a trigger function

Trigger functions are especially dangerous because they run on every INSERT/UPDATE/DELETE.

Before modifying:
- Confirm the exact type of every column accessed (`information_schema.columns`)
- Use `BEGIN/EXCEPTION` blocks around any COALESCE or type conversion
- Test with `EXPLAIN ANALYZE` on a representative INSERT
- Update the trigger table in §1b of this document

### When dropping a function

1. Confirm no active migrations, edge functions, or RLS policies call it
2. Search the codebase: `grep -r "function_name" supabase/ src/`
3. Drop in a migration; update this document
4. Open a PR for review

---

## Security Summary

| Risk | Mitigation |
|---|---|
| `security_definer` functions bypass RLS | All 4 such functions validate caller identity internally before cross-org access |
| Trigger functions run on every INSERT | Wrapped in EXCEPTION blocks; COALESCE type drift handled by adaptive insert in `_shared/observationInsert.ts` |
| Cron jobs run as superuser | Jobs only call well-defined Edge Function HTTP endpoints or narrow SQL statements |
| PostGIS functions | System-managed via extension; no application code modifies them |
| GraphQL `graphql_public.graphql` | Currently unused by the application; not exposed in any frontend routes |

---

## See Also

- **[LIVE_TRIGGERS.md](LIVE_TRIGGERS.md)** — Complete trigger inventory (54 triggers), execution order on observations INSERT, governance rules
