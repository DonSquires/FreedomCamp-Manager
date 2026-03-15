# Live Database Triggers — Authoritative Reference

> ⚠️ **GOVERNANCE NOTICE**
> This file is the single source of truth for all live Supabase database triggers.
> **No trigger may be created, altered, or dropped without an approved Pull Request
> reviewed by `@DonSquires`.** New migrations that add or modify triggers must update
> this document in the same PR.
> See [LIVE_SCHEMA.md](LIVE_SCHEMA.md) and [LIVE_FUNCTIONS.md](LIVE_FUNCTIONS.md) for
> the full governance policy and the trigger function definitions.

**Last verified:** 2026-04-09  
**Verified by:** Copilot schema alignment audit against live Supabase instance  
**Total triggers:** 54 (49 public · 4 storage · 1 realtime · 1 cron — all enabled)

---

## How to Keep This Document Current

```sql
SELECT
  n.nspname     AS schema,
  t.tgname      AS trigger_name,
  c.relname     AS table_name,
  pg_get_triggerdef(t.oid) AS definition,
  CASE t.tgenabled WHEN 'O' THEN 'enabled' WHEN 'D' THEN 'disabled' END AS enabled
FROM pg_trigger t
JOIN pg_class     c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE NOT t.tgisinternal
  AND n.nspname IN ('public','storage','realtime','cron')
ORDER BY n.nspname, c.relname, t.tgname;
```

After any migration that creates, alters, or drops a trigger, update this document and open a PR for review by `@DonSquires`.

---

## Section Index

1. [Trigger Inventory by Table (public schema)](#1-trigger-inventory-by-table-public-schema)
   - [alert_queue](#alert_queue)
   - [breach_alerts](#breach_alerts)
   - [bug_reports](#bug_reports)
   - [canonical_vehicles](#canonical_vehicles)
   - [compliance_results](#compliance_results)
   - [enforcement_actions](#enforcement_actions)
   - [flagged_vehicles](#flagged_vehicles)
   - [investigation_jobs](#investigation_jobs)
   - [missing_photo_queue](#missing_photo_queue)
   - [notices_to_vacate](#notices_to_vacate)
   - [observations (critical path)](#observations-critical-path)
   - [officer_welfare_alerts](#officer_welfare_alerts)
   - [officer_welfare_settings](#officer_welfare_settings)
   - [organizations](#organizations)
   - [patrols](#patrols)
   - [person_interactions](#person_interactions)
   - [person_observations](#person_observations)
   - [person_records](#person_records)
   - [user_profiles](#user_profiles)
   - [vehicle_records_deprecated_20250131](#vehicle_records_deprecated_20250131)
   - [zone_legal_config](#zone_legal_config)
   - [zones](#zones)
2. [Infrastructure Schema Triggers](#2-infrastructure-schema-triggers)
   - [realtime.subscription](#realtimesubscription)
   - [storage.buckets](#storagebuckets)
   - [storage.objects](#storageobjects)
   - [cron.job](#cronjob)
3. [Trigger Execution Order on observations INSERT](#3-trigger-execution-order-on-observations-insert)
4. [Governance Rules for Triggers](#4-governance-rules-for-triggers)

---

## 1. Trigger Inventory by Table (public schema)

All triggers listed below are **enabled** (`enabled = O`). None are deferred.

---

### alert_queue

| Trigger name | Timing | Event | Function | Notes |
|---|---|---|---|---|
| `trigger_update_alert_queue_updated_at` | BEFORE | UPDATE | `update_alert_queue_updated_at()` | Stamps `updated_at` on every row update |

---

### breach_alerts

| Trigger name | Timing | Event | Function | Notes |
|---|---|---|---|---|
| `update_breach_alerts_updated_at` | BEFORE | UPDATE | `update_updated_at_column()` | Generic `updated_at` stamp |

---

### bug_reports

| Trigger name | Timing | Event | Function | Notes |
|---|---|---|---|---|
| `trigger_notify_admins_new_bug` | BEFORE | INSERT | `notify_admins_new_bug_report()` | Notifies admin users via `alert_queue` when a new bug report is submitted |
| `update_bug_reports_updated_at` | BEFORE | UPDATE | `update_updated_at_column()` | Generic `updated_at` stamp |

---

### canonical_vehicles

| Trigger name | Timing | Event | Columns | Function | Notes |
|---|---|---|---|---|---|
| `trg_canonical_vehicles_updated_at` | BEFORE | UPDATE | — | `update_updated_at()` | Generic `updated_at` stamp |
| `trigger_auto_fc_exempt` | BEFORE | INSERT OR UPDATE | `homeless_status` | `auto_mark_homeless_fc_exempt()` | When `homeless_status` changes, automatically sets `fc_act_exempt = true` if the vehicle qualifies for the Freedom Camping Act exemption |

---

### compliance_results

| Trigger name | Timing | Event | Condition | Function | Notes |
|---|---|---|---|---|---|
| `trg_compliance_results_updated_at` | BEFORE | UPDATE | — | `update_updated_at()` | Generic `updated_at` stamp |
| `trigger_auto_create_breach_alert` | AFTER | INSERT | — | `create_breach_alert_from_compliance()` | Creates a `breach_alerts` row on every non-compliant compliance result insert |
| `trigger_create_breach_alert_from_compliance` | AFTER | INSERT | `WHEN (new.is_compliant = false)` | `create_breach_alert_from_compliance()` | Conditional duplicate of above — only fires when `is_compliant = false`. **⚠️ Both triggers exist; verify one is not redundant after any compliance refactor.** |
| `trigger_sync_observation_compliance` | AFTER | INSERT OR UPDATE | — | `sync_observation_compliance_fields()` | Syncs `is_compliant`, `breach_type`, `violation_reasons` back to the linked `observations` row |

> **⚠️ Note on duplicate breach alert triggers:** Both `trigger_auto_create_breach_alert` (unconditional) and `trigger_create_breach_alert_from_compliance` (conditional on `is_compliant = false`) call the same function. If `create_breach_alert_from_compliance()` is idempotent (uses INSERT ... ON CONFLICT DO NOTHING), this is safe. Verify before modifying either.

---

### enforcement_actions

| Trigger name | Timing | Event | Function | Notes |
|---|---|---|---|---|
| `trg_enforcement_actions_updated_at` | BEFORE | UPDATE | `update_updated_at()` | Generic `updated_at` stamp |
| `trigger_set_enforcement_plate` | BEFORE | INSERT OR UPDATE | `set_enforcement_plate_number()` | Populates `plate_number` from the linked `observation_id` or `vehicle_record_id` if not already set |
| `trigger_update_enforcement_tally` | AFTER | INSERT OR UPDATE | `update_vehicle_enforcement_tally()` | Increments `canonical_vehicles.enforcement_count` and updates `last_enforcement_at`, `last_enforcement_type` |
| `trigger_validate_enforcement_credentials` | BEFORE | INSERT | `validate_enforcement_action()` | Checks that the creating officer has the required warrant/COA credentials to perform the enforcement action type; raises exception if not |

---

### flagged_vehicles

| Trigger name | Timing | Event | Function | Notes |
|---|---|---|---|---|
| `trg_flagged_vehicles_updated_at` | BEFORE | UPDATE | `update_updated_at()` | Generic `updated_at` stamp |

---

### investigation_jobs

| Trigger name | Timing | Event | Function | Notes |
|---|---|---|---|---|
| `trg_investigation_jobs_updated_at` | BEFORE | UPDATE | `update_updated_at()` | Generic `updated_at` stamp |
| `trigger_update_investigation_jobs_updated_at` | BEFORE | UPDATE | `update_investigation_jobs_updated_at()` | Secondary `updated_at` trigger — stamps and also validates status transitions |

> **⚠️ Note:** Two `updated_at` triggers fire on this table (`trg_investigation_jobs_updated_at` and `trigger_update_investigation_jobs_updated_at`). Both run BEFORE UPDATE. Verify they don't conflict after any status-flow refactor.

---

### missing_photo_queue

| Trigger name | Timing | Event | Function | Notes |
|---|---|---|---|---|
| `trg_missing_photo_queue_updated_at` | BEFORE | UPDATE | `update_missing_photo_queue_updated_at()` | Generic `updated_at` stamp on the missing photo alert queue table |

---

### notices_to_vacate

| Trigger name | Timing | Event | Function | Notes |
|---|---|---|---|---|
| `set_notice_reference_trigger` | BEFORE | INSERT | `set_notice_reference_number()` | Auto-generates the `reference_number` (e.g. `NTV-2026-00142`) before the row is inserted |
| `trigger_increment_breach_notice_count` | AFTER | INSERT | `increment_breach_notice_count()` | Increments a counter on the linked `breach_alerts` row when a notice is served |
| `update_notices_vacate_updated_at` | BEFORE | UPDATE | `update_updated_at_column()` | Generic `updated_at` stamp |

---

### observations (critical path)

These triggers form the **observation insert pipeline**. They fire in the order shown (BEFORE triggers first, then AFTER; within each phase, alphabetical by trigger name is the PostgreSQL default but explicit ordering is not guaranteed).

| # | Trigger name | Timing | Event | Condition | Function | Purpose |
|---|---|---|---|---|---|---|
| 1 | `trigger_populate_observation_from_canonical` | BEFORE | INSERT | — | `populate_observation_from_canonical()` | Looks up `canonical_vehicles` by `plate_number`; denormalises vehicle fields (`vehicle_make`, `vehicle_model`, `vehicle_color`, `vehicle_year` (both columns are INTEGER since migration 20260411000003 — no cast required), `self_contained`, `self_contained_expiry`) onto `NEW`. Has top-level `EXCEPTION` block to degrade gracefully on type drift. |
| 2 | `trg_auto_evaluate_compliance` | BEFORE | INSERT | — | `auto_evaluate_compliance()` | Calls `calculate_vehicle_compliance_v3`; sets `is_compliant`, `consecutive_nights`, `nights_stayed_this_month`, `compliance_snapshot`, `breach_type`, `breach_reason`, `is_breach` on `NEW` |
| 3 | `trigger_auto_create_compliance_result` | AFTER | INSERT | — | `auto_create_compliance_result()` | Inserts a row into `compliance_results` from the computed compliance values |
| 4 | `trigger_log_observation_deletion` | BEFORE | DELETE | — | `log_observation_deletion()` | Copies the full row snapshot into `observation_deletions` before the row is deleted |
| 5 | `trigger_sync_homeless_to_canonical` | AFTER | INSERT | `WHEN (new.has_homeless_claim = true)` | `sync_homeless_to_canonical()` | Updates `canonical_vehicles.is_homeless` and `homeless_status` when a homeless claim is recorded |
| 6 | `trigger_update_canonical_stats_v2` | AFTER | INSERT | — | `update_canonical_stats_v2()` | Increments `total_observations`, `last_seen_at`, and related counters on `canonical_vehicles` |
| 7 | `trigger_update_monthly_stays` | AFTER | INSERT | — | `update_monthly_stays_on_observation()` | Upserts `vehicle_monthly_stays`; increments `nights_stayed` and `consecutive_nights` for the observation month |

> **COALESCE type safety rule:** All BEFORE INSERT triggers that call `COALESCE` must cast column values through `::text` first. Use `BEGIN/EXCEPTION` blocks for type drift. See `SCHEMA_VALIDATION_CHECKLIST.md §5`.

> **Pipeline contract:** Edge functions that insert observations must use `adaptiveObservationInsert()` from `supabase/functions/_shared/observationInsert.ts`. This handles COALESCE type mismatch errors by stripping compliance columns on retry.

> **AFTER triggers fire post-INSERT only.** The `trigger_log_observation_deletion` trigger fires on DELETE, not INSERT — it is listed here for completeness.

---

### officer_welfare_alerts

| Trigger name | Timing | Event | Function | Notes |
|---|---|---|---|---|
| `update_welfare_alerts_updated_at` | BEFORE | UPDATE | `update_welfare_updated_at()` | Generic `updated_at` stamp |

---

### officer_welfare_settings

| Trigger name | Timing | Event | Function | Notes |
|---|---|---|---|---|
| `update_welfare_settings_updated_at` | BEFORE | UPDATE | `update_welfare_updated_at()` | Generic `updated_at` stamp |

---

### organizations

| Trigger name | Timing | Event | Columns | Function | Notes |
|---|---|---|---|---|---|
| `trg_organizations_updated_at` | BEFORE | UPDATE | — | `update_updated_at()` | Generic `updated_at` stamp |
| `trigger_auto_calculate_org_level` | BEFORE | INSERT OR UPDATE | `parent_organization_id` | `auto_calculate_org_level()` | Sets `organization_level` by traversing the `parent_organization_id` chain; root orgs get level 1 |
| `trigger_prevent_circular_org_reference` | BEFORE | INSERT OR UPDATE | `parent_organization_id` | `prevent_circular_org_reference()` | Raises an exception if the new `parent_organization_id` would create a circular reference in the org hierarchy |

---

### patrols

| Trigger name | Timing | Event | Function | Notes |
|---|---|---|---|---|
| `trg_patrols_updated_at` | BEFORE | UPDATE | `update_updated_at()` | Generic `updated_at` stamp |
| `trigger_notify_patrol_assignment` | BEFORE | INSERT OR UPDATE | `notify_patrol_assignment()` | Queues a notification in `alert_queue` when a patrol is assigned or reassigned to an officer |

---

### person_interactions

| Trigger name | Timing | Event | Function | Notes |
|---|---|---|---|---|
| `trigger_update_person_interaction_count` | AFTER | INSERT | `update_person_interaction_count()` | Increments `person_records.total_interactions` counter |

---

### person_observations

| Trigger name | Timing | Event | Function | Notes |
|---|---|---|---|---|
| `trigger_update_person_observation_count` | AFTER | INSERT | `update_person_observation_count()` | Increments a person-linked observation counter |
| `update_person_observations_updated_at` | BEFORE | UPDATE | `update_updated_at_column()` | Generic `updated_at` stamp |

---

### person_records

| Trigger name | Timing | Event | Function | Notes |
|---|---|---|---|---|
| `trg_person_records_updated_at` | BEFORE | UPDATE | `update_updated_at()` | Generic `updated_at` stamp |

---

### user_profiles

| Trigger name | Timing | Event | Columns | Function | Notes |
|---|---|---|---|---|---|
| `create_default_welfare_settings_trigger` | AFTER | INSERT | — | `create_default_welfare_settings()` | Creates a default `officer_welfare_settings` row when a new user profile is created |
| `trg_user_profiles_updated_at` | BEFORE | UPDATE | — | `update_updated_at()` | Generic `updated_at` stamp |
| `trigger_queue_user_deactivation` | AFTER | UPDATE | `is_active` | `queue_user_deactivation()` | When `is_active` changes to `false`, inserts a row into `user_deactivation_queue` for async auth user disabling |
| `trigger_update_compliance_status` | BEFORE | INSERT OR UPDATE | `employer_organization_id`, `coa_expiry_date`, `warrant_expiry_date`, `has_warrant` | `update_compliance_status_trigger()` | Recalculates `compliance_status` whenever credential fields change |

---

### vehicle_records_deprecated_20250131

| Trigger name | Timing | Event | Function | Notes |
|---|---|---|---|---|
| `trg_vehicle_records_updated_at` | BEFORE | UPDATE | `update_updated_at()` | Generic `updated_at` stamp on the deprecated table — kept to prevent errors if legacy code updates rows |

> **Note:** This table is frozen. Do not insert new rows. The trigger is retained as a safety measure only.

---

### zone_legal_config

| Trigger name | Timing | Event | Function | Notes |
|---|---|---|---|---|
| `update_zone_legal_config_updated_at` | BEFORE | UPDATE | `update_updated_at_column()` | Generic `updated_at` stamp |

---

### zones

| Trigger name | Timing | Event | Function | Notes |
|---|---|---|---|---|
| `prevent_other_location_deletion_trigger` | BEFORE | DELETE | `prevent_other_location_deletion()` | Prevents deletion of zones that have `zone_type = 'other_location'`; these are system-managed |
| `trg_zones_updated_at` | BEFORE | UPDATE | `update_updated_at()` | Generic `updated_at` stamp |
| `trigger_sync_zone_to_matrix` | AFTER | INSERT OR UPDATE | `sync_zone_to_matrix()` | Ensures a matching row exists in `zone_compliance_matrix` when a zone is created or its compliance settings change |

---

## 2. Infrastructure Schema Triggers

### realtime.subscription

| Trigger name | Timing | Event | Function | Notes |
|---|---|---|---|---|
| `tr_check_filters` | BEFORE | INSERT OR UPDATE | `realtime.subscription_check_filters()` | Validates subscription filter syntax (column name, operator, value type) before inserting into `realtime.subscription`; raises exception on invalid filters |

---

### storage.buckets

| Trigger name | Timing | Event | Columns | Function | Notes |
|---|---|---|---|---|---|
| `enforce_bucket_name_length_trigger` | BEFORE | INSERT OR UPDATE | `name` | `storage.enforce_bucket_name_length()` | Raises exception if bucket name exceeds the maximum allowed length |
| `protect_buckets_delete` | BEFORE | DELETE | — | `storage.protect_delete()` | FOR EACH STATEMENT trigger — prevents bulk deletion of buckets (statement-level, not row-level) |

---

### storage.objects

| Trigger name | Timing | Event | Function | Notes |
|---|---|---|---|---|
| `protect_objects_delete` | BEFORE | DELETE | `storage.protect_delete()` | FOR EACH STATEMENT trigger — prevents bulk deletion of storage objects |
| `update_objects_updated_at` | BEFORE | UPDATE | `storage.update_updated_at_column()` | Stamps `updated_at` on storage object modifications |

---

### cron.job

| Trigger name | Timing | Event | Function | Notes |
|---|---|---|---|---|
| `cron_job_cache_invalidate` | AFTER | INSERT OR DELETE OR UPDATE OR TRUNCATE | `cron.job_cache_invalidate()` | FOR EACH STATEMENT — flushes the pg_cron in-memory job cache when the job table is modified so new/changed schedules take effect immediately |

---

## 3. Trigger Execution Order on observations INSERT

Understanding this sequence is critical for debugging scan pipeline issues.

```
Client INSERT observations (plate_number, photo, recorded_at, zone_id, ...)
│
├─ BEFORE INSERT (fire in this order):
│   1. trigger_populate_observation_from_canonical
│      → reads canonical_vehicles by plate_number
│      → copies vehicle_make/model/color/year/self_contained/is_homeless onto NEW
│
│   2. trg_auto_evaluate_compliance
│      → calls calculate_vehicle_compliance_v3(plate, zone, date, ...)
│      → sets NEW.is_compliant, NEW.consecutive_nights, NEW.nights_stayed_this_month,
│              NEW.compliance_snapshot, NEW.breach_type, NEW.breach_reason, NEW.is_breach
│
│   (Row is now written to disk with both sets of denormalised values)
│
└─ AFTER INSERT (fire in this order):
    3. trigger_auto_create_compliance_result
       → INSERT INTO compliance_results (...)
       → this INSERT fires compliance_results triggers (see below)

    4. trigger_sync_homeless_to_canonical  [WHEN has_homeless_claim = true]
       → UPDATE canonical_vehicles SET is_homeless = true ...

    5. trigger_update_canonical_stats_v2
       → UPDATE canonical_vehicles SET total_observations = total_observations + 1,
                                       last_seen_at = NEW.recorded_at, ...

    6. trigger_update_monthly_stays
       → INSERT INTO vehicle_monthly_stays ... ON CONFLICT DO UPDATE
         SET nights_stayed = nights_stayed + 1, consecutive_nights = ...

compliance_results INSERT (fired from step 3):
    └─ trigger_sync_observation_compliance
       → UPDATE observations SET is_compliant = ..., breach_type = ... WHERE observation_id = NEW.observation_id

    └─ trigger_auto_create_breach_alert  [unconditional]  ⎫ Both call
    └─ trigger_create_breach_alert_from_compliance        ⎭ create_breach_alert_from_compliance()
       → INSERT INTO breach_alerts ... ON CONFLICT DO NOTHING
```

**Performance note:** A single observation INSERT causes writes to 4 tables: `observations`, `compliance_results`, `canonical_vehicles`, `vehicle_monthly_stays`, and potentially `breach_alerts`. Plan your RLS policies and index maintenance accordingly.

---

## 4. Governance Rules for Triggers

### Adding a trigger

1. Write a new migration: `supabase/migrations/YYYYMMDD_add_trigger_<name>.sql`
2. Add the trigger to this document in the correct table section
3. If the trigger fires on `observations`, update §3 (execution order)
4. If the trigger calls a new function, add the function to `LIVE_FUNCTIONS.md §1i`
5. Open a PR for review by `@DonSquires`

### Modifying an existing trigger

Trigger modifications are schema-breaking changes. Before modifying:

1. Run `EXPLAIN ANALYZE` on a representative INSERT/UPDATE to measure current cost
2. Check if other triggers on the same table depend on the same `NEW` fields
3. Write the change as a `DROP TRIGGER ... CREATE TRIGGER ...` migration (not `ALTER TRIGGER`)
4. Update this document and `LIVE_FUNCTIONS.md` in the same PR

### Disabling a trigger temporarily

Do **not** use `ALTER TABLE ... DISABLE TRIGGER` in production without an approved change. Use a feature flag or conditional logic inside the trigger function instead.

### Dropping a trigger

1. Confirm no frontend code, edge function, or other trigger depends on its side effects
2. Search: `grep -r "trigger_name" supabase/ src/`
3. Drop in a migration; update this document and `LIVE_FUNCTIONS.md`
4. Open a PR for review

---

## Quick Reference: Triggers by Function Called

| Function | Tables | Trigger count |
|---|---|---|
| `update_updated_at()` | canonical_vehicles, compliance_results, enforcement_actions, flagged_vehicles, investigation_jobs, organizations, patrols, person_records, user_profiles, vehicle_records_deprecated_20250131, zones | 11 |
| `update_updated_at_column()` | breach_alerts, bug_reports, notices_to_vacate, person_observations, zone_legal_config | 5 |
| `auto_evaluate_compliance()` | observations | 1 |
| `auto_create_compliance_result()` | observations | 1 |
| `create_breach_alert_from_compliance()` | compliance_results | 2 (see note) |
| `sync_observation_compliance_fields()` | compliance_results | 1 |
| `populate_observation_from_canonical()` | observations | 1 |
| `update_canonical_stats_v2()` | observations | 1 |
| `update_monthly_stays_on_observation()` | observations | 1 |
| `log_observation_deletion()` | observations | 1 |
| `sync_homeless_to_canonical()` | observations | 1 |
| `update_vehicle_enforcement_tally()` | enforcement_actions | 1 |
| `validate_enforcement_action()` | enforcement_actions | 1 |
| `set_enforcement_plate_number()` | enforcement_actions | 1 |
| `sync_zone_to_matrix()` | zones | 1 |
| `auto_calculate_org_level()` | organizations | 1 |
| `prevent_circular_org_reference()` | organizations | 1 |
| `update_compliance_status_trigger()` | user_profiles | 1 |
| `queue_user_deactivation()` | user_profiles | 1 |
| `create_default_welfare_settings()` | user_profiles | 1 |
| `auto_mark_homeless_fc_exempt()` | canonical_vehicles | 1 |
| `set_notice_reference_number()` | notices_to_vacate | 1 |
| `increment_breach_notice_count()` | notices_to_vacate | 1 |
| `notify_admins_new_bug_report()` | bug_reports | 1 |
| `notify_patrol_assignment()` | patrols | 1 |
| `update_person_interaction_count()` | person_interactions | 1 |
| `update_person_observation_count()` | person_observations | 1 |
| `prevent_other_location_deletion()` | zones | 1 |
| Infrastructure functions | storage, realtime, cron | 5 |
