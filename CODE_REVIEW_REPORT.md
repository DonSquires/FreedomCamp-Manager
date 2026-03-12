# FreedomCamp-Manager – Code Review Report

**Reviewed:** 2026-02-25  
**Reviewer:** Copilot Coding Agent  
**Branch reviewed:** `main` (grafted) + `copilot/add-schema-extraction-tooling`  
**Supabase project:** `https://xbfnlzmpumthnjmtqufp.supabase.co`

---

## 1. Repository Summary

FreedomCamp-Manager is a **multi-tenant vehicle-observation and compliance enforcement platform** built for New Zealand councils/enforcement agencies. Officers record observations of freedom-camping vehicles (photo + GPS + plate), the system evaluates zone compliance rules, raises breach alerts, generates PDF notices, and produces analytics/reports.

| Item | Detail |
|------|--------|
| **Frontend** | React 18 + TypeScript (Vite), Tailwind CSS |
| **Backend** | Supabase (PostgreSQL 15, row-level security, edge functions) |
| **Edge runtime** | Deno (Supabase Edge Functions) |
| **Mobile / Field** | OnSpace platform (external) – calls this project's edge functions |
| **AI integration** | OnSpace AI API (ALPR, ORC/plate recognition, photo analysis) |
| **ALPR** | Plate Recognizer API + OnSpace AI fallback |
| **3rd-party APIs** | NZSCV Self-Contained Vehicle Registry (via proxy), MotorWeb, OpenWeather |
| **Source files** | 251 TypeScript/TSX, 47 edge functions, 75 SQL migrations |
| **Repo size** | ~3.6 MB (no large binaries committed) |

---

## 2. Language Composition

| Language | Count |
|----------|-------|
| TypeScript / TSX (frontend pages) | ~80 pages, ~170 support files |
| Deno TypeScript (edge functions) | 47 `index.ts` files |
| SQL (migrations) | 75 `.sql` files |
| Markdown (documentation) | ~90 `.md` files (mostly AI-generated runbooks) |
| Shell | 3 scripts |
| YAML (CI) | 2 workflow files |

---

## 3. Database Schema (from migrations + type definitions)

### 3.1 Core tables

| Table | Purpose |
|-------|---------|
| `organizations` | Multi-tenant root; each council/agency is one org |
| `zones` | Geographic zones with compliance rules (geometry, max_consecutive_nights, nights_per_month, self_contained_required, allowed_days) |
| `zone_compliance_matrix` | Versioned compliance rules per zone; allows policy changes without losing history |
| `user_profiles` | Linked to `auth.users`; stores role (`officer`, `admin`, `master`), organization membership |
| `patrols` | Scheduled patrol sessions (zone + shift + officer assignment) |
| `canonical_vehicles` | Master vehicle registry – plate number is the key; stores homeless status, compliance history, photo URL, NZSCV/MotorWeb enrichment data |
| `observations` | Primary observation table (photo-first evidence record); **being migrated to `observations`** |
| `observations` | New simplified observation table (migration `20260221_rebuild_observations_clean.sql`); replaces `observations` |
| `compliance_results` | Per-observation compliance evaluation result with per-rule breakdown (JSONB) |
| `breach_alerts` | Active breach records; status: `pending → notified → resolved/escalated` |
| `enforcement_actions` | Formal enforcement actions taken against a vehicle |
| `vehicle_monthly_stays` | Aggregate monthly stay counts per plate/zone/month (materialized for compliance) |
| `drift_events` | Records when a zone's compliance rules change (triggers recalculation) |
| `audit_log` | Immutable change history |
| `incidents` | Incidents with evidence; retention policy enforced (purge after N days) |
| `investigation_jobs` | Async investigation tasks (e.g. NZSCV check, MotorWeb lookup) |
| `officer_welfare_alerts` | Real-time welfare monitoring for field officers |
| `alert_queue` | Notification queue for breach alerts / welfare events |
| `import_history` | Tracks historical data import batches |
| `photo_metadata` | Metadata for all uploaded photos (hash, dimensions, timestamps) |

### 3.2 Key enum types

| Enum | Values |
|------|--------|
| `patrol.shift` | `day`, `night`, `morning`, `afternoon` |
| `patrol.status` | `scheduled`, `in_progress`, `completed`, `cancelled` |
| `breach_alerts.breach_type` | `overstay`, `no_self_contained`, `no_wof`, `consecutive_days`, `unauthorized_zone`, `nights_exceeded` |
| `breach_alerts.status` | `pending`, `notified`, `resolved`, `escalated` |
| `user role` (text) | `officer`, `admin`, `master`, `admin_officer` |

### 3.3 Schema migration history (notable)

| Migration | Change |
|-----------|--------|
| `20250203_rebuild_vehicle_architecture` | Introduced `observations`; deprecated `vehicle_records` |
| `20250214_auto_create_compliance_results` | Trigger on `observations` → auto-creates `compliance_results` |
| `20260215_multi_organization_hierarchy` | Added multi-org support |
| `20260218_rebuild_breach_alerts_system` | Full rebuild of breach detection |
| `20260220_core_pipeline_rebuild` | 4-layer compliance pipeline; added `evaluate_compliance_v4`, cohort functions |
| `20260221_rebuild_observations_clean` | **Drops `observations` and creates new `observations` table** |
| `20260224_admin_dashboard_views` | New materialised-style views for admin dashboard |

> ⚠️ **Schema alignment gap:** Migration `20260221` drops `observations` and creates `observations`, but the majority of the frontend (`src/pages/`) and many edge functions still reference `observations`. See Section 7.

---

## 4. Edge Functions (47 total)

### 4.1 Core pipeline

| Function | Purpose |
|----------|---------|
| `vehicle-ingest` | **Main entry point** – receives observation from OnSpace/field app; writes to `observations`; SHA-256 photo hashing; idempotency key deduplication; GPS validation |
| `alpr-process` | Plate recognition pipeline (Plate Recognizer API + OnSpace AI fallback) |
| `alpr-retry` | Retry failed ALPR jobs |
| `recalculate-compliance` | Bulk compliance recalculation across zones |
| `recalculate-compliance-v2` | Strict zone-based recalculation (newer, preferred) |
| `scan-breaches` | Scans for breach conditions and raises `breach_alerts` |
| `check-almost-breaches` | Identifies vehicles approaching breach threshold |
| `cleanup-and-recalculate` | Batch cleanup + full recalculation |

### 4.2 Vehicle enrichment

| Function | Purpose |
|----------|---------|
| `enrich-from-motorweb` | Fetches vehicle details from MotorWeb (NZ vehicle registry) via XML API |
| `check-nzscv-status` | Queries NZSCV Self-Contained Vehicle Registry via `NZSCV_PROXY_URL` |
| `analyze-vehicle-photo` | Uses OnSpace AI to analyse vehicle photo and extract metadata |
| `select-best-vehicle-photo` | Uses OnSpace AI to select best profile photo |

### 4.3 Reporting / PDF generation

| Function | Purpose |
|----------|---------|
| `generate-notice-to-vacate` | Generates legal notice PDF |
| `generate-vehicle-report` | Court-ready PDF evidence report |
| `generate-dashboard-report` | Management PDF summary |
| `generate-leadership-pack` | Executive PDF with drift trends |
| `generate-incident-pdf` | Court-ready incident report |
| `observations-export` | CSV export of observations |
| `observations-list` | Paginated, searchable observations API |
| `get-compliance-statistics` | Real-time compliance stats |
| `hotspot-data` | Clustered GPS data for heat maps |
| `observations-in-bounds` | Geo-bounded observation query |

### 4.4 AI / OnSpace integration

| Function | Purpose |
|----------|---------|
| `onspace-ai-chat` | AI-powered bug analysis and code suggestions (internal dev tool) |
| `orc-ingest` | Optical character recognition ingest for document processing |
| `process-credential-document` | AI extraction of COA/Warrant details from uploaded images |
| `process-investigation-document` | Document processing for investigations |
| `get-weather` | Weather conditions via OnSpace AI (used on observation record) |

### 4.5 User / org management

| Function | Purpose |
|----------|---------|
| `create-user` | Creates Supabase auth user with org assignment |
| `update-user-password` | Admin-driven password reset |
| `monitor-officer-welfare` | Scheduled welfare check (cron-triggered) |
| `send-push-notification` | Expo push notification delivery |
| `stream-webhook` | Plate Recognizer Stream webhook endpoint |

### 4.6 Zone / data maintenance

| Function | Purpose |
|----------|---------|
| `zone-correction` | Batch processor: reassigns observations to correct zone |
| `correct-zone-assignments` | Simple zone reassignment |
| `check-zone-corrections` | Identifies GPS/zone mismatches |
| `suggest-new-zone` | Auto-suggests new zones from GPS clusters |
| `duplicate-detection` | Identifies duplicate observation records |
| `check-data-integrity` | Integrity checks across tables |
| `import-data` | Generic data import |
| `import-historical-data` | Backend-driven Excel historical import |
| `process-homeless-data` | Processes homeless exemption data |
| `update-compliance-policy` | Updates zone compliance matrix version |
| `upload-file` | File upload to storage |

### 4.7 Edge functions invoked from frontend but **not found** in `supabase/functions/`

These are called by the frontend but have no corresponding directory – they may be deployed externally, renamed, or deleted:

| Missing function | Called from |
|-----------------|-------------|
| `enrich-vehicle-worker` | Multiple pages |
| `plate-scanner-photo-first` | Field officer portal |
| `process-field-scan` | Field officer portal |
| `test-alpr-credentials` | Admin portal |

---

## 5. Database Functions (RPCs)

### 5.1 Called from frontend via `.rpc()`

| RPC | Purpose |
|----|---------|
| `calculate_vehicle_compliance` | Core compliance calculation for a vehicle |
| `check_organization_compliance` | Org-wide compliance summary |
| `evaluate_observation_requirements` | Per-observation zone requirements check |
| `get_observation_result` | Get full result for one observation (Layer 4) |
| `get_admin_dashboard_stats` | Stats for admin dashboard |
| `get_all_organizations_list` | Master list of orgs (master role only) |
| `get_live_officer_locations` | Real-time officer GPS positions |
| `get_my_scans_24h` / `get_org_scans_24h` | Scan counts for last 24h |
| `get_vehicle_stay_summary` | Monthly/consecutive stay summary |
| `get_zones_with_activity` | Zones with recent observation activity |
| `backfill_monthly_stays_from_observations` | Recalculate monthly stays from scratch |
| `create_matrix_version` | Create new compliance policy version |
| `find_all_matching_zones` | Geo lookup: find zones containing a point |
| `get_person_interaction_history` | History of person interactions |
| `get_vehicle_notes_history` | Notes history for a plate |
| `log_officer_activity` | Log activity for welfare monitoring |
| `terminate_user_session` | Force-terminate a user session |
| `get_expected_monthly_stays_count` | Expected stays for analytics |
| `get_unique_plate_count_from_observations` | Unique plate count |

### 5.2 Trigger functions (called automatically)

| Function | Trigger |
|---------|---------|
| `auto_create_compliance_result` | After INSERT on `observations` |
| `auto_evaluate_compliance_and_create_breach` | After INSERT on `observations` |
| `update_monthly_stays_on_observation` | After INSERT/UPDATE on observations |
| `upsert_canonical_vehicle` | After INSERT on observations |
| `sync_homeless_to_canonical` | After INSERT on homeless data |
| `sync_zone_to_matrix` | After INSERT/UPDATE on `zones` |
| `update_updated_at` | On all tables with `updated_at` column |
| `patrol_auto_checkin` / `patrol_auto_checkout` | Patrol status transitions |
| `purge_expired_incidents` | Cron/trigger for retention policy |

### 5.3 Cohort functions (analytics, frozen API)

| Function | Returns |
|---------|---------|
| `cohort_overstayers` | Vehicles that have exceeded monthly/consecutive limits |
| `cohort_homeless_exempt` | Vehicles exempt under FC Act homeless provision |
| `cohort_all_breaches` | All active breaches |

---

## 6. Environment Variables

### 6.1 Frontend (Vite, prefix `VITE_`)

| Variable | Required | Notes |
|----------|----------|-------|
| `VITE_SUPABASE_URL` | Yes | Hardcoded fallback in `src/lib/supabase.ts` |
| `VITE_SUPABASE_ANON_KEY` | Yes | Hardcoded fallback in `src/lib/supabase.ts` |

### 6.2 Edge functions (`Deno.env.get()`)

| Variable | Used by | Purpose |
|----------|---------|---------|
| `SUPABASE_URL` | All functions | Service client init |
| `SUPABASE_SERVICE_ROLE_KEY` | All functions | Service-role DB access |
| `SUPABASE_ANON_KEY` | Some functions | Anon-role operations |
| `ONSPACE_AI_API_KEY` | `vehicle-ingest`, `analyze-vehicle-photo`, `orc-ingest`, `get-weather`, `select-best-vehicle-photo`, `process-credential-document` | OnSpace AI API authentication |
| `ONSPACE_AI_BASE_URL` | Same as above | Defaults to `https://api.onspace.ai` |
| `ALPR_API_TOKEN` | `alpr-process`, `stream-webhook` | Plate Recognizer API key |
| `ALPR_API_URL` | `alpr-process` | Plate Recognizer endpoint |
| `NZSCV_PROXY_URL` | `check-nzscv-status` | Proxy for NZSCV registry queries |
| `NZSCV_PROXY_SECRET` | `check-nzscv-status` | Proxy authentication |
| `INFERENCE_SERVICE_URL` | `vehicle-ingest` | Future: Railway inference service URL |
| `RAILWAY_PROXY_URL` | `enrich-from-motorweb` | MotorWeb proxy on Railway |
| `DEV_CORS` | `vehicle-ingest` | Set to `true` to allow all CORS origins in dev |

### 6.3 `.env.functions.local` (supabase local dev)

Present in repo at `supabase/.env.functions.local` – should only contain dev values; confirm no production secrets are in this file before any new contributor clones the repo.

---

## 7. Findings & Issues

### 7.1 🔴 Critical: Schema mismatch – `observations` vs `observations`

Migration `20260221_rebuild_observations_clean.sql` **drops `observations`** with `CASCADE` and replaces it with a new `observations` table. However:

- **30+ frontend pages** still call `.from('observations')` (OrganizationDashboard, VehicleEvidenceReport, ComplianceHeatMap, AnalyticsHub, ObservationDetailModal, VehicleActivityReport, etc.)
- **Multiple edge functions** still reference `observations` (`recalculate-compliance`, `recalculate-compliance-v2`, `scan-breaches`, `cleanup-and-recalculate`, `alpr-process`)
- **`evaluate_compliance_v4`** (defined in `20260220_core_pipeline_rebuild`) still uses `observations%ROWTYPE`

**Impact:** If migration `20260221` is applied to production, the application will break immediately across all observation-related pages and edge functions.

**Recommendation:** Either revert migration `20260221` and do a rolling migration that keeps `observations` as a view over `observations`, or update all frontend pages and edge functions before applying this migration.

### 7.2 🔴 Critical: Missing edge functions called from frontend

Four edge functions are invoked from the frontend but have no corresponding directory in `supabase/functions/`:

- `enrich-vehicle-worker` – vehicle enrichment worker
- `plate-scanner-photo-first` – field officer plate scanner
- `process-field-scan` – field scan processing
- `test-alpr-credentials` – ALPR credential testing (admin)

Any user action that triggers these will receive a 404 from the edge runtime. These need to be either created or the frontend calls removed.

### 7.3 🟡 Warning: Hardcoded credentials in source code

`src/lib/supabase.ts` has hardcoded fallback values for `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`:

```typescript
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://xbfnlzmpumthnjmtqufp.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGci...';
```

The anon key is intentionally public (it's the public JWT, not the service role key), but having it hardcoded means any fork of the repo will hit the production Supabase instance if the `.env` is missing. The `.env` file is also committed to the repo with these values. **Recommendation:** Remove hardcoded fallbacks and add `.env` to `.gitignore`; provide a `.env.example` instead.

### 7.4 🟡 Warning: Backup/temp files committed in `src/pages/`

Five backup/partial page files are committed:

- `FlaggedVehicles_TEMP_BACKUP.tsx`
- `DriftDashboard_temp_backup.tsx`
- `UrgentFollowUps_BACKUP.tsx`
- `VehicleVerification_BACKUP.tsx`
- `EnforcementActions_PARTIAL.tsx`

These are imported nowhere and represent dead code. They should be deleted or moved to a `_archive/` directory that is git-ignored, or removed entirely.

### 7.5 🟡 Warning: `src/.github/workflows/` – misplaced files

Two TSX pages and a workflow YAML are inside `src/.github/workflows/`:

- `src/.github/workflows/FieldOfficerPortal.tsx`
- `src/.github/workflows/PlateScanner.tsx`
- `src/.github/workflows/deploy.yml`

The `.tsx` files appear to be page components accidentally placed in a workflow directory. The `deploy.yml` is a CI file in the wrong location (it should be at `.github/workflows/deploy.yml`). **Recommendation:** Move page components to `src/pages/`, move `deploy.yml` to `.github/workflows/`.

### 7.6 🟡 Warning: `USE_ONSPACE_AI` flag not configurable via env var

In `supabase/functions/vehicle-ingest/index.ts`:

```typescript
const USE_ONSPACE_AI = true; // hardcoded
```

This controls whether the edge function calls the OnSpace AI service or the Railway inference service. It should be driven by an environment variable so it can be toggled without a redeployment.

### 7.7 🟢 Note: Multi-org RLS appears well-structured

Row-level security is enabled on all major tables. Helper functions (`get_user_role`, `get_user_organization_id`, `get_user_organization_ids`) are used consistently in policies. The `master` role pattern for super-admins is consistent.

### 7.8 🟢 Note: Compliance pipeline is well-documented

The 4-layer pipeline architecture (Ingest → Enrichment → Compliance Engine → Result Delivery) documented in `20260220_core_pipeline_rebuild.sql` is clear and the cohort functions (`cohort_overstayers`, `cohort_homeless_exempt`, `cohort_all_breaches`) provide a clean frozen API for reporting.

### 7.9 🟢 Note: Evidence integrity is enforced at DB level

Migration `20260219_enforce_photo_not_null.sql` adds `NOT NULL` constraints and SHA-256 columns to `observations`, with explicit `REVOKE DELETE` to prevent deletion. This is good for Evidence Act 2006 (NZ) compliance.

---

## 8. Storage Buckets

| Bucket name | Used by |
|-------------|---------|
| `evidence` | All vehicle observation photos; accessed from `src/` and edge functions |
| `incident-evidence` | Incident report attachments |
| `compliance-documents` | COA and warrant documents |
| `evidence_bin` | Soft-deleted evidence staging |

---

## 9. Frontend Pages (selected key areas)

| Page | Key tables / RPCs used |
|------|----------------------|
| `FieldOfficerPortal.tsx` | `vehicle-ingest`, `alpr-process`, `zones`, `patrols`, `observations` |
| `ComplianceDashboard.tsx` | `canonical_vehicles`, `compliance_results`, `calculate_vehicle_compliance` RPC |
| `ObservationsPage.tsx` | `observations` / `observations`, `observations-list` edge fn |
| `BreachAlertsReport.tsx` | `breach_alerts`, `scan-breaches` edge fn |
| `AdminPortal.tsx` | `get_admin_dashboard_stats` RPC, `recalculate-compliance-v2` edge fn |
| `VehicleEnrichmentMaintenance.tsx` | `canonical_vehicles`, `enrich-from-motorweb` edge fn |
| `LiveOfficerTracking.tsx` | `get_live_officer_locations` RPC, `officer_activity_log` |
| `OrganizationManagement.tsx` | `organizations`, `user_profiles`, `create-user` edge fn |
| `ZoneManagement.tsx` | `zones`, `zone_compliance_matrix`, `create_matrix_version` RPC |

---

## 10. Next Steps

- [ ] **Resolve schema mismatch** (issue 7.1): decide whether `observations` replaces `observations` immediately or via a compatibility view; update all affected code accordingly.
- [ ] **Create missing edge functions** (issue 7.2): `enrich-vehicle-worker`, `plate-scanner-photo-first`, `process-field-scan`, `test-alpr-credentials`.
- [ ] **Remove hardcoded credentials** (issue 7.3): replace fallback values with empty strings; add `.env` to `.gitignore`; provide `.env.example`.
- [ ] **Delete backup/temp files** (issue 7.4): remove `*_BACKUP.tsx`, `*_PARTIAL.tsx` files from `src/pages/`.
- [ ] **Fix misplaced files** (issue 7.5): move `src/.github/workflows/*.tsx` to `src/pages/`; move `deploy.yml` to `.github/workflows/`.
- [ ] **Make `USE_ONSPACE_AI` env-driven** (issue 7.6): replace hardcoded flag with `Deno.env.get('USE_ONSPACE_AI') === 'true'`.
- [ ] **Run schema extraction**: once DB credentials are available, run `tools/schema-extract/run_extract.sh` and commit results to confirm live schema matches migrations.
- [ ] **Verify RLS completeness**: confirm all tables that contain PII or multi-tenant data have RLS enabled and correct policies.
