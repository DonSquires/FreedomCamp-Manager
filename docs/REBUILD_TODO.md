# FreedomCamp Manager — Rebuild TODO

> Living checklist for the clean rebuild. Updated as work progresses.
> Source plan: `docs/CLEAN_REBUILD_EXECUTION_PLAN.md` + `docs/CLEAN_REBUILD_DESIGN.md`.
>
> Last updated: 2026-04-20
> Assigned agent: copilot-swe-agent

---

## Status Summary

| Phase | Description | Status |
|---|---|---|
| Phase 0 | Baseline & Inventory | ✅ Complete |
| Phase 1 | Schema alignment | 🔄 In progress |
| Phase 2 | Edge function consolidation | ⏳ Pending |
| Phase 3 | Frontend cleanup | 🔄 In progress |
| Phase 4 | Data migration scripts | ⏳ Pending |
| Phase 5 | Cutover & deletion | ⏳ Pending |

---

## Phase 0 — Baseline & Inventory ✅

> **Finding**: All 36 target schema tables already exist across the 303 migrations.
> No new schema creation is needed for the clean target. The rebuild is about simplification.

- [x] Read all plan docs (`CLEAN_REBUILD_DESIGN.md`, `CLEAN_REBUILD_EXECUTION_PLAN.md`, `BUILD_PLAN_V3.md`)
- [x] Verify all 36 target tables exist in migrations — **all present**
- [x] Confirm TypeScript build is clean — **zero errors**
- [x] Identify current state: 123 pages, 118 routes, 93 edge functions, 303 migrations
- [x] Identify target state: ~18 core pages, ~20 routes, 17 edge functions
- [x] Keep/merge/remove matrix defined in `CLEAN_REBUILD_DESIGN.md`
- [x] Deployment architecture verified: RunPod (Bob/Ollama) + VPS (PTT) + Railway (proxy only)
- [x] VRAM-aware Ollama parallelism wired into upgrade workflows (30→2 workers, 141→8 workers)

---

## Phase 1 — Schema & Types 🔄

### 1.1 LIVE_SCHEMA.md accuracy
- [ ] Update `docs/LIVE_SCHEMA.md` — currently only documents 14 of 40+ live tables
  - Many tables (canonical_scv, canonical_homeless, officer_shifts, dispute_intake, etc.) are fully implemented in migrations but absent from the doc
  - Regenerate from current migration files

### 1.2 Database types
- [ ] Regenerate `src/types/database.ts` to match actual current schema
  - Run: `npx supabase gen types typescript --local > src/types/database.ts` (needs live DB or local supabase)
  - Check for any type drift from recent migrations (canonical_scv, canonical_homeless, dispute_intake)

### 1.3 RLS / RPCs
- [x] `calculate_vehicle_compliance_v3()` RPC exists and is current
- [ ] Verify `get_hotspot_data()` RPC exists and matches frontend call
- [ ] Verify `get_compliance_statistics()` matches frontend expectations
- [ ] Audit RLS policies for new tables (canonical_scv, canonical_homeless, dispute_intake) for org isolation

---

## Phase 2 — Edge Function Consolidation ⏳

> Target: 17 functions (from 93 current). DO NOT delete production functions yet — inventory first.

### 2.1 Inventory: functions to KEEP (rebuild/consolidate into)
| Target fn | Purpose | Current fns it replaces |
|---|---|---|
| `process-officer-scan` | Core scan pipeline | `alpr-process`, `alpr-retry`, `orc-ingest`, `plate-scanner-photo-first`, `check-nzscv-status`, `analyze-vehicle-photo`, `vehicle-ingest`, `stream-webhook`, `select-best-vehicle-photo`, `link-evidence-photos` |
| `cleanup-and-recalculate` | Nightly batch | `recalculate-compliance-v3`, `scan-breaches`, `correct-zone-assignments`, `zone-correction`, `check-zone-corrections`, `duplicate-detection`, `check-almost-breaches`, `sync-scv-list`, `daily-photo-reconciler`, `enrich-from-motorweb`, `sync-spatial-layers` |
| `generate-notice-to-vacate` | PDF notice | — |
| `generate-infringement` | Infringement PDF | `render-infringement-notice` |
| `sync-scv-list` | SCV registry sync | — |
| `create-user` | User provisioning | `create_auth_and_profiles` |
| `monitor-officer-welfare` | Welfare scheduler | `send-welfare-reminders` |
| `send-report-email` | Email delivery | — |
| `export-data` | Data export | `observations-export` |
| `import-data` | Data import | `import-historical-data` |
| `submit-dispute-intake` | Public dispute | — |
| `public-case-lookup` | Public lookup | — |
| `hotspot-data` | Heatmap data | — |
| `process-homeless-data` | Homeless import | — |
| `nightly-privacy-cleanup` | Privacy cleanup | — |
| `manage-user` | User password mgmt | `set-user-password`, `update-user-password` |
| `photo-maintenance` | Photo reconcile | `photo-recovery`, `daily-photo-reconciler`, `reingest-photos` |

### 2.2 Functions to REMOVE/ARCHIVE (dead or superseded)
- [ ] `recalculate-compliance` — dead (callers use v3)
- [ ] `recalculate-compliance-v2` — dead
- [ ] `alpr-retry` — superseded by process-officer-scan error handling
- [ ] `check-almost-breaches` — consolidated into cleanup-and-recalculate
- [ ] `check-data-integrity` — developer tool, not production
- [ ] `check-railway-health` — Railway is proxy-only now; health check irrelevant
- [ ] `duplicate-detection` — consolidated into cleanup-and-recalculate
- [ ] `test-compliance-matrix` — developer tool
- [ ] `admin-incident-ops` — investigate whether still called
- [ ] `get-weather` — investigate whether still called by any page
- [ ] `grandmaster-studio` — developer tool
- [ ] `bob-code-change-task` — developer tool (CI only, not edge fn product)
- [ ] `auto-analyse-report` — investigate
- [ ] `stream-webhook` — superseded
- [ ] `orc-ingest` — superseded by process-officer-scan

### 2.3 Functions to AUDIT (keep or phase-2)
- [ ] `generate-dashboard-report` — may overlap with `generate-leadership-pack`
- [ ] `generate-leadership-pack` — investigate usage
- [ ] `observations-in-bounds` — may be needed by LiveMap, check
- [ ] `observations-list` — may be needed, check vs direct DB query
- [ ] `get-compliance-statistics` — likely needed by dashboard
- [ ] `biosecurity-assess`, `biosecurity-notice` — outside freedom-camping core (phase 2)
- [ ] `noise-audio-assess`, `generate-noise-notice` — outside core (phase 2)
- [ ] `smoke-assess`, `smoke-notice` — outside core (phase 2)
- [ ] `generate-vehicle-report`, `generate-seizure-receipt`, `generate-warning-notice` — check usage
- [ ] `onspace-ai-chat` — keep (Bob chat gateway, actively used)
- [ ] `ptt-signaling-token` — keep (PTT auth, actively used)
- [ ] `translate-message` — keep (PTT translation)
- [ ] `synthesize-speech` — investigate usage
- [ ] `transcribe-audio` — investigate usage
- [ ] `process-credential-document` — investigate
- [ ] `process-face-scan` — investigate (flag for phase 2)
- [ ] `process-investigation-document` — investigate
- [ ] `generate-tender-sections`, `process-tender-document`, `process-reference-material`, `ingest-reference-material` — KEEP (tender workflow active)
- [ ] `parkpow-sync`, `parkpow-photo-sync`, `scrape-vehicle-photos` — investigate (maybe railway-era dead)
- [ ] `suggest-new-zone` — investigate
- [ ] `update-compliance-policy` — investigate

---

## Phase 3 — Frontend Cleanup 🔄

> Target: ~18 core pages, ~20 clean routes. DO NOT delete page files — redirect routes.

### 3.1 Remove debug/developer routes from App.tsx
These routes should be removed (redirect to `/` or kept only for `grand_master`):
- [ ] `/diagnostics` → SystemDiagnostics (developer tool)
- [ ] `/test-dashboard` → TestDashboard (developer tool)
- [ ] `/compliance-recalculation` → ComplianceRecalculation (replaced by edge fn)
- [ ] `/photo-reingest` → PhotoReingest (developer tool)
- [ ] `/evidence-photo-linker` → EvidencePhotoLinker (developer tool)
- [ ] `/admin/data-cleanup` → DataCleanupUtility (developer tool)
- [ ] `/admin/data-integrity` → DataIntegrityDashboard (developer tool)
- [ ] `/clean-dashboard` → CleanDashboard (dev/testing page)
- [ ] `/grandmaster-code-studio` → GrandmasterCodingStudio (developer tool)

### 3.2 Redirect duplicate routes to canonical paths
- [ ] `/compliance-unified` → redirect to `/compliance`
- [ ] `/compliance-dashboard` → redirect to `/compliance`
- [ ] `/reports-hub` → redirect to `/reports`
- [ ] `/observation-records` → redirect to `/observations`
- [ ] `/observations-report` → redirect to `/observations`
- [ ] `/breach-notices` → redirect to `/breaches`
- [ ] `/enforcement-actions` → redirect to `/enforcement-review`
- [ ] `/enforcement-command-center` → redirect to `/enforcement-review`
- [ ] `/import-data` + `/import-historical` → redirect to `/data`

### 3.3 Core route tree (canonical paths after cleanup)
Public:
- `/login`
- `/public/dispute`

Officer flow:
- `/portal-selection`
- `/officer-home` (or `/field-officer`)
- `/field`

Admin flow:
- `/admin`
- `/vehicles` + `/vehicles/:id`
- `/zones`
- `/compliance`
- `/breaches`
- `/enforcement-review`
- `/infringements`
- `/observations`
- `/patrols`
- `/patrol-schedule`
- `/patrol-kpis`
- `/reports`
- `/disputes`
- `/hotspots`
- `/live-tracking`
- `/audit-log`
- `/privacy-curtain`
- `/officer-welfare`
- `/person-records`
- `/search`

Governance:
- `/users`
- `/organizations`
- `/organization-profile`
- `/settings`
- `/profile`
- `/data` (import/export)
- `/notifications`
- `/access-control`

Platform (grand_master only):
- `/platform`
- `/admin/canonical-records`
- `/admin/nzscv`
- `/admin/discrepancies`
- `/ai-analysis`
- `/spatial-compliance`

### 3.4 Non-freedom-camping portals (gate or phase-2 out)
These are multi-tenant/non-core portals. Gate them behind `grand_master` or a feature flag:
- `/parking` + `/parking-officer`
- `/noise-control` + `/noise-officer`
- `/biosecurity-control` + `/biosecurity-officer`
- `/smoke-control` + `/smoke-officer`
- `/ems`, `/site-guard`

### 3.5 Active feature routes (keep as-is)
- `/team-chat`, `/radio` (PTT)
- `/bob-assistant`, `/bob-intake-queue`
- `/intel-approvals`
- `/tender-workspace`, `/tender-workspace/:id`, `/tender-reference-library`
- `/crm`, `/crm/client/:orgId`, `/crm/contractor/:orgId`
- `/dispatch`, `/dispatch-monitor`, `/dispatch-wizard`, `/dispatched-jobs`, `/job-map`
- `/timesheets`, `/open-shifts`, `/roster`, `/officer-skills`, `/availability`
- `/site-risk-assessment`, `/client-sites`, `/client-master-list`
- `/invoicing`, `/pricing`

---

## Phase 4 — Data Migration ⏳

- [ ] Write ETL scripts for `flagged_vehicles` → `canonical_homeless`
- [ ] Write reconciliation queries for all 36 retained tables
- [ ] Document archive strategy for tables outside clean model scope
- [ ] Row-count parity report

---

## Phase 5 — Cutover ⏳

> Only after Phase 3 passes smoke tests.

- [ ] Switch frontend to clean route tree
- [ ] Deploy consolidated edge functions
- [ ] Validate scan, breach, notice, welfare alert, report workflows
- [ ] Archive legacy UI routes (redirect all removed paths)
- [ ] Archive legacy edge functions (move to `/supabase/functions/_archive/`)
- [ ] Drop legacy-only columns only after full dependency check

---

## Notes

- **Do not drop production tables** until parity testing confirms no live references.
- **Do not delete page files** until routes are redirected and confirmed unused.
- Specialist portals (parking, noise, biosecurity, smoke) are multi-tenant features — gate behind `grand_master` or leave until confirmed there are no active tenants.
- Bob/Ollama runs on RunPod pod; Railway is proxy-only (NZSCV/MotorWeb).
- PTT signaling runs on VPS `72.61.123.97`.
