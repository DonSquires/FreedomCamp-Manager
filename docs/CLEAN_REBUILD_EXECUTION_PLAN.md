# FreedomCamp Manager — Clean Rebuild Execution Plan

> Purpose: turn the existing design and architecture documents into an execution plan for a full rebuild of the product surface.
>
> Source documents: `docs/CLEAN_REBUILD_DESIGN.md`, `docs/BUILD_PLAN.md`, `docs/BUILD_PLAN_V3.md`, `docs/CAPABILITY_OVERVIEW.md`, `docs/LIVE_SCHEMA.md`, `docs/LIVE_FUNCTIONS.md`, `docs/NEW_PROJECT_SETUP.md`.
>
> Date: 2026-04-01

## 1. Decision

The rebuild should be done as a **clean replacement**, not as incremental deletion inside the current live schema and UI.

Reasons:

- The current database is the product of 200+ migrations and the docs explicitly describe a clean rebuild as the way out of the accumulated complexity.
- `docs/LIVE_SCHEMA.md` is the live reference, not the target simplified model.
- Deleting tables in-place before the replacement schema, functions, RLS, and UI exist would break the running product and make data migration harder.

Operational rule:

- **Do not drop current production tables or pages first.**
- Build the clean schema, clean edge functions, and clean UI in parallel.
- Cut over only after data migration, parity testing, and sign-off.

## 2. Target Product Scope

The clean rebuild target is the simplified product described in `docs/CLEAN_REBUILD_DESIGN.md`.

### 2.1 Roles

Keep these roles:

- `officer`
- `admin`
- `master`
- `grand_master`

Remove from the clean build surface:

- `admin_officer` as a separate product concept if portal switching covers the workflow
- `nzscv_monitor` as a top-level role unless retained as an internal support-only permission

### 2.2 Frontend Pages

Keep or rebuild as the core app surface:

- `Login`
- `PortalSelection`
- `AdminPortal`
- `FieldOfficerPortal`
- `Compliance`
- `Observations`
- `Breaches`
- `Enforcement`
- `Vehicles`
- `Zones`
- `LiveMap`
- `Patrols`
- `Reports`
- `DataImport`
- `Disputes`
- `Settings`
- `UserManagement`
- `Profile`

Delete from the clean production surface:

- all debug, cleanup, diagnostics, and temporary pages
- duplicated page variants that will be merged into the pages above
- service-line portals that are outside the freedom-camping core unless they are being intentionally productised in a separate platform

### 2.3 Database Tables

Use the simplified schema direction from `docs/CLEAN_REBUILD_DESIGN.md` as the target baseline.

Core tables to keep in the clean rebuild:

- `organizations`
- `user_profiles`
- `zones`
- `zone_compliance_matrix`
- `zone_legal_config`
- `zone_signage_evidence`
- `observations`
- `breach_alerts`
- `canonical_vehicles`
- `canonical_scv`
- `canonical_homeless`
- `infringement_notices`
- `infringement_notice_counters`
- `notices_to_vacate`
- `enforcement_cases`
- `enforcement_case_events`
- `patrols`
- `patrol_schedule_zones`
- `patrol_checkpoints`
- `checkpoint_visits`
- `officer_shifts`
- `officer_welfare_settings`
- `officer_welfare_alerts`
- `officer_activity_log`
- `incidents`
- `incident_attachments`
- `health_safety_reports`
- `person_records`
- `person_observations`
- `person_vehicle_links`
- `person_interactions`
- `audit_log`
- `dispute_intake`
- `privacy_access_log`
- `privacy_curtain_settings`
- `retention_policies`

Merge or remove from the clean rebuild baseline:

- merge `flagged_vehicles` and `homeless_records` into `canonical_homeless`
- do not carry forward pre-aggregated or legacy compatibility tables unless the clean UI requires them
- move niche or investigative features to phase 2 instead of day-1 schema

### 2.4 Edge Functions

Target the consolidated function set from `docs/CLEAN_REBUILD_DESIGN.md`.

Keep and rebuild:

- `process-officer-scan`
- `cleanup-and-recalculate`
- `generate-notice-to-vacate`
- `generate-infringement`
- `sync-scv-list`
- `create-user`
- `monitor-officer-welfare`
- `send-report-email`
- `export-data`
- `import-data`
- `submit-dispute-intake`
- `public-case-lookup`
- `hotspot-data`
- `process-homeless-data`
- `nightly-privacy-cleanup`
- `manage-user`
- `photo-maintenance`

Remove by consolidation:

- compliance recalculation variants
- fragmented scan pipeline steps that should live inside `process-officer-scan`
- diagnostics and internal-only support functions from the product surface
- duplicated reporting and import functions

## 3. Delivery Strategy

### Phase 0 — Freeze and Inventory

Goals:

- freeze schema expansion except for break/fix work
- stop adding new duplicated pages and edge functions
- map every current page, route, table, trigger, RPC, storage bucket, and edge function to one of: keep, merge, phase 2, remove

Outputs:

- final keep/merge/remove matrix
- cutover checklist
- data migration map from live schema to clean schema

### Phase 1 — New Clean Backend

Build a new baseline migration chain that creates the clean schema from zero.

Rules:

- start from a fresh Supabase project or a full reset branch intended for a fresh deployment
- create the clean tables directly rather than replaying legacy migrations
- add only the required triggers and RPCs for the clean product
- write RLS from first principles around the clean role model
- define clean storage buckets and policies only for retained features

Outputs:

- initial clean schema migration
- follow-up migrations only for defects found during implementation
- updated generated database types

### Phase 2 — Consolidated Edge Functions

Rebuild the backend workflow around the consolidated function set.

Implementation order:

1. `process-officer-scan`
2. `cleanup-and-recalculate`
3. notice generation functions
4. user management functions
5. dispute and public lookup functions
6. privacy, reporting, import, and maintenance jobs

Rules:

- each function owns one business workflow end to end
- eliminate wrapper or pass-through functions that only proxy internal steps
- preserve the existing external contracts only where required for cutover compatibility

### Phase 3 — Clean Frontend

Rebuild the SPA around the reduced page set.

Implementation order:

1. auth and portal routing
2. field officer scan flow
3. admin command centre
4. observations, breaches, enforcement
5. vehicles, zones, patrols
6. reports, disputes, settings

Rules:

- mobile-first officer flow
- desktop-first admin flow
- no debug tooling in production navigation
- merged pages replace duplicated variants

### Phase 4 — Data Migration

Move live data into the clean schema after the new app is working.

Migration principles:

- preserve immutable evidence and auditability
- migrate observations, notices, breaches, patrols, users, and zones first
- backfill canonical tables from authoritative sources
- explicitly map any merged legacy tables into their new destination
- archive, do not silently discard, data that has no clean-model destination

Outputs:

- repeatable migration scripts
- row-count reconciliation report
- parity report for high-risk workflows

### Phase 5 — Cutover and Deletion

Only after parity testing passes:

1. switch frontend to the clean backend
2. deploy the consolidated function set
3. validate scans, breach generation, notices, reports, and welfare alerts
4. archive legacy UI routes
5. archive or drop legacy tables and functions that are no longer referenced

Deletion rule:

- drop legacy schema objects only after a full dependency check confirms no remaining triggers, RPCs, routes, or jobs reference them

## 4. Work Breakdown

### Backend Track

- write a single baseline migration for the clean schema
- write clean RLS helpers and policies
- implement clean RPCs for compliance, patrol KPIs, dashboards, and exports
- regenerate `src/types/database.ts`

### Functions Track

- rebuild the scan pipeline as one function
- consolidate cleanup, duplicate detection, and recomputation into one scheduled function
- consolidate user and photo maintenance operations

### Frontend Track

- replace route sprawl with a small route tree
- rebuild pages around feature modules instead of one page per variation
- remove production links to diagnostics and migration tooling

### Migration Track

- write extract-transform-load scripts
- define reconciliation queries for every retained core table
- document archive strategy for removed features

## 5. Risks

- `docs/LIVE_SCHEMA.md` documents active production structures that are broader than the clean target; using it as the rebuild target would recreate the current complexity.
- Several current pages and migrations support adjacent businesses beyond freedom camping. Those should be treated as separate product tracks instead of silently carried into the clean core.
- In-place deletion in the current project would break RLS, triggers, and edge functions before replacements exist.

## 6. Recommended Next Implementation Step

Start with the backend foundation, not the UI deletion.

Immediate sequence:

1. create a new clean schema baseline under `supabase/migrations/`
2. define the final retained table list and column contracts from the clean model
3. implement the minimum RPCs and triggers needed for `observations`, `breach_alerts`, `zones`, `patrols`, and notice generation
4. then rebuild the core route tree and officer/admin portals against that schema

## 7. Explicit Non-Goal for This Step

This plan does **not** delete the current live database tables or rip out the existing UI yet.

That work should be done only as part of the phased cutover above.