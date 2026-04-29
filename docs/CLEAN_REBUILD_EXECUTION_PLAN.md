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
3. CRM and account operations surface
4. admin command centre
5. observations, breaches, enforcement
6. vehicles, zones, patrols, and dispatch automation
7. business management crossover and client portal
8. reports, disputes, settings

Rules:

- mobile-first officer flow
- desktop-first admin flow
- CRM owns account context, with organisation -> site -> zone -> patrol/dispatch as the canonical admin hierarchy
- Business Management owns internal capability, with staff -> roster -> fleet/assets -> checks -> audit as the canonical provider-side hierarchy
- staff crossover between CRM and Business Management is mandatory for scheduling, dispatch, readiness, and audit traceability
- client portal is a first-class product surface, not a reporting afterthought
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
- make CRM the canonical account surface for contacts, rates, access, sites, zones, and patrol readiness
- make Business Management the canonical internal surface for users, workforce, fleet, assets, maintenance, and audit
- preserve geofence-aware patrol execution as a first-class workflow, not a hidden field detail
- deliver a dedicated client portal with account-scoped visibility for sites, zones, service status, and contract reports
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

## 8. Sectioned Rebuild and Crossover Plan (Web + Mobile)

This section is the operational checklist to run the rebuild from start to finish in controlled sections.

### Section A — Baseline and Freeze

Objectives:

- freeze new schema churn except break/fix
- freeze new route additions outside rebuild scope
- establish the final keep/merge/remove matrix and owners

Required artifacts:

- page matrix (`src/pages/*` and `src/rebuild/pages/*`) with destination route
- table matrix (live table -> clean table or archive)
- edge function matrix (live function -> consolidated function)

Exit criteria:

- matrix approved by product + engineering
- no new legacy-only routes added to `src/App.tsx`

### Section B — Schema and Type Crossover

Objectives:

- create clean schema baseline and migration chain
- map old columns to new contracts (`org_id` -> `organization_id`, `user_id` -> `id`, etc.)
- regenerate `src/types/database.ts` and fix compile drift

Execution:

1. apply clean migrations in staging first
2. run data backfill scripts for retained entities
3. regenerate and commit database types
4. run build and typed query smoke tests

Exit criteria:

- schema migration applies cleanly in staging
- typed client queries compile for rebuilt pages
- reconciliation SQL validates expected row counts

### Section C — Frontend Rebuild by Surface

Objectives:

- deliver clean route tree in functional blocks
- replace duplicated legacy variants with one canonical page per capability
- keep account configuration and live operations connected, so admins move from client account -> site -> zone -> patrol/dispatch without changing mental model
- keep client-facing operations and provider-side business management separate enough to stay understandable, but connected enough to share org context and auditability

Implementation order:

1. auth and portal routing
2. officer workflow (`Scan`, `LiveMap`, `Patrols`, `Observations`)
3. CRM/account workflow (`CRM`, `client accounts`, `sites`, `contacts`, `rates`, `access`)
4. business management workflow (`Business`, `staff/users`, `roster`, `fleet`, `assets`, `daily checks`, `audit`)
5. admin workflow (`Breaches`, `Enforcement`, `Vehicles`, `Zones`)
6. patrol/dispatch workflow (`Patrols`, route execution, dispatch completion/resume, geofence auto-progress)
7. client workflow (`ClientPortal`, `site visibility`, `service summaries`, `contract reports`, `dispute links`)
8. governance workflow (`Disputes`, `Reports`, `Settings`, `Profile`)

Exit criteria:

- each block passes role-based route guards and core smoke tests
- address entry can resolve coordinates and establish site-linked geofence defaults in the rebuilt admin flow
- business management can trace staff, vehicle, and asset readiness from one org-scoped surface with audit history
- patrol automation events are auditable and covered by deterministic role-based tests
- crossover flows are validated end-to-end: CRM account/site context -> staffing/dispatch execution -> client-visible service outcome
- client portal access is provably constrained to contract scope and excludes provider internal workforce/fleet internals
- removed routes are archived, not left dangling in navigation

### Section D — Vercel Web Track (Required for Cutover)

Objectives:

- ensure web rebuild is deployable and repeatable on Vercel
- enforce production headers and cache policy

Required config:

- `vercel.json` present with SPA rewrite and security headers
- GitHub Actions secrets configured: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`
- build env configured: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

Validation:

1. preview deploy on PR branch
2. production deploy on main
3. route deep-link checks (`/login`, `/platform`, `/live-map`)
4. security header checks (HSTS, CSP, X-Frame-Options)

Exit criteria:

- successful Vercel preview + production deployment
- no SPA routing 404s
- header audit passes

### Section E — Expo Mobile Track (Required for Cutover)

Objectives:

- include mobile field workflow in rebuild delivery, not as a post-cutover afterthought
- confirm mobile uses same Supabase contracts and role/RLS behavior

Required config:

- `mobile-app/app.json` has valid `extra.eas.projectId` and `updates.url`
- `mobile-app/eas.json` profiles validated (`development`, `preview`, `production`)
- environment variables set in EAS for Supabase URL/anon key

Validation:

1. `eas build --platform android --profile preview`
2. `eas build --platform ios --profile preview`
3. login, scan flow, breach alert acknowledgment, and enforcement workflow checks
4. push token registration and notification test

Exit criteria:

- successful preview builds on both platforms
- parity confirmed for core officer workflows
- no schema drift between mobile and web query paths

### Section F — Security and Compliance Gate

Objectives:

- enforce transport and application security before production cutover
- produce evidence pack suitable for council/defense procurement review

Controls checklist:

- TLS 1.2+ enforced at all public endpoints (Vercel + service hosts)
- HSTS enabled for web and service domains
- strict CORS allowlists for proxy/inference/PTT services
- JWT and service-to-service secret controls validated
- audit logging enabled for sensitive operations

Evidence pack:

- architecture diagram and data-flow map
- RLS policy inventory and test results
- incident response + rollback runbook
- vulnerability scan summary and remediation log

Exit criteria:

- security checklist signed off
- evidence pack exported for stakeholder review

### Section G — Cutover Runbook

1. deploy schema and edge functions
2. deploy Vercel web release
3. publish Expo preview/production builds as planned
4. execute smoke tests across web + mobile
5. monitor for 24 hours with rollback readiness

Cutover is complete only when all sections above pass their exit criteria.