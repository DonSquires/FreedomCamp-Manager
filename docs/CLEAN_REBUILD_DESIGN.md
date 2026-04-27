# FreedomCamp Manager — Clean Rebuild Design & Sales Strategy

> **Purpose**: A candid assessment of what to keep, cut, and redesign in a clean rebuild.
> Covers simplified architecture, role-focused UX, a practical implementation plan, and
> sales messaging for councils and security companies.
>
> **Audience**: Don Squires (product owner), future developers, prospective clients.
>
> **Last updated**: 2026-04-24

---

## Table of Contents

1. [Honest Assessment: What We've Built](#1-honest-assessment-what-weve-built)
2. [The Clean Rebuild Philosophy](#2-the-clean-rebuild-philosophy)
3. [What to Keep, Cut, and Consolidate](#3-what-to-keep-cut-and-consolidate)
4. [Clean Schema (20 tables, not 40+)](#4-clean-schema-20-tables-not-40)
5. [Clean Edge Function Set (17, not 69)](#5-clean-edge-function-set-17-not-69)
6. [Infrastructure Services: Inference Service & Proxy Server](#6-infrastructure-services-inference-service--proxy-server)
7. [Role-by-Role UX Design](#7-role-by-role-ux-design)
8. [Clean Frontend Structure](#8-clean-frontend-structure)
9. [New Role: Grand Master (Platform Owner)](#9-new-role-grand-master-platform-owner)
10. [Step-by-Step Clean Rebuild Order](#10-step-by-step-clean-rebuild-order)
11. [Sales Strategy & Client Pitch](#11-sales-strategy--client-pitch)
12. [Appendix: Build Plan V4 — Complete Overview & Gap Analysis](#appendix-build-plan-v4--complete-overview--gap-analysis)
13. [Appendix I: Full Build Sanity Check — Past, Present & V4 Coverage](#appendix-i-full-build-sanity-check--past-present--v4-coverage)

---

## 1. Honest Assessment: What We've Built

The current app works. Officers can scan plates, admins can see breaches, and compliance
is calculated. But the codebase has accumulated significant complexity over 200+
migrations and 60+ edge functions:

### What accumulated over time

| Issue | Evidence | Impact |
|---|---|---|
| 3 compliance recalculation functions | `recalculate-compliance`, `-v2`, `-v3` | Maintenance burden; callers use wrong version |
| 60+ pages | Including `TestDashboard.tsx`, `CleanDashboard.tsx`, PHASE_*.md files | Confusing navigation; dead code in production |
| 69 edge functions | Many do overlapping work (ALPR, scan pipeline fragmented across 5+ functions) | Hard to debug, hard to onboard new devs |
| 200+ migrations | Some undo others, some add columns that are immediately populated by another | Schema is hard to understand from scratch |
| 5 user roles | officer, admin, admin_officer, master, nzscv_monitor | nzscv_monitor is barely used; admin_officer overlap is confusing |
| `flagged_vehicles` "deprecated then un-deprecated" | See BUILD_PLAN_V3.md §2.9 | Callers are confused about what table to use |
| `canonical_vehicles`, `canonical_scv`, `canonical_homeless` | Three separate tables for related vehicle data | Query complexity when you just want "is this vehicle SCV?" |
| Dead edge functions | `recalculate-compliance`, `recalculate-compliance-v2`, `alpr-retry` | Deployed but never called |
| Developer-facing pages in production | `TestDashboard.tsx`, `CleanDashboard.tsx`, `DataCleanupUtility.tsx`, `SystemDiagnostics.tsx` | Clients see internal tooling |

### What works well and must be preserved

| Feature | Why it's good |
|---|---|
| Single scan flow | Officer taps scan → plate identified → compliance verdict in ~5 seconds |
| Offline queue | IndexedDB + `useOfflineQueue` is solid; field officers depend on this |
| Zone geofencing | GPS auto-detection with child zone priority is well-designed |
| Notice generation | PDF/HTML notice workflow is complete and legally sound |
| `calculate_vehicle_compliance_v3()` RPC | The compliance engine is accurate and versioned |
| `canonical_scv` table | Clean lookup; right design. Just needs to be the only source |
| RLS model | Org-scoped data isolation works correctly |
| Email templates | Branded and professional |

---

## 2. The Clean Rebuild Philosophy

> **One job, done perfectly. Nothing else.**

The app has one core job: **run site and zone based field operations cleanly**.
For freedom camping that means officers scan plates and admins enforce rules, but the
same operating model also covers patrols, alarm responses, welfare, parking, smoke,
noise, and other contract work. CRM, sites, zones, dispatch, and patrol execution are
therefore core product surfaces, not side modules.

### Guiding principles

1. **Every page serves a user, not a developer.** Remove debug pages, test dashboards,
   cleanup utilities. These belong in a separate internal admin tool or the Supabase
   Dashboard, not the production app.

2. **One function per job.** Three compliance recalculation functions means three places
   to update when the rules change. One function, versioned by the DB RPC.

3. **Mobile-first for officers, desktop-first for admins.** Currently both portals share
   the same component patterns. Officers need large tap targets, minimal reading, instant
   feedback. Admins need data density, filters, exports.

4. **Roles match real people.** Five roles is two too many. Real deployments have:
   officers who scan, admins who review, managers (master) who run the contract, and
   platform owners (grand master) who sell and support new clients.

5. **Sites and zones are the operational anchor.** Organisations are the account and
billing container, but work is configured and executed at the site/zone level. The
rebuild must treat CRM account -> site -> zone -> patrol/dispatch as the primary
workflow hierarchy.

6. **Schema tells a story.** A new developer should be able to read the 20 core tables
   and understand the entire system in an afternoon. Not 40+ tables with 200 migrations.

7. **Build for the sales pitch.** Every feature visible to a client demo should be
   polished. Internal tooling should be hidden or removed from the UI entirely.

---

## 3. What to Keep, Cut, and Consolidate

### 3.1 Edge Functions: Keep 17, Cut 52

| Keep | Purpose |
|---|---|
| `process-officer-scan` | Core scan pipeline (plate → compliance → breach) |
| `cleanup-and-recalculate` | Nightly batch correction + recompute |
| `generate-notice-to-vacate` | PDF notice generation |
| `generate-infringement` | Infringement notice PDF |
| `sync-scv-list` | SCV registry sync from NZSCV |
| `create-user` | User provisioning |
| `monitor-officer-welfare` | Welfare check-in scheduler |
| `send-report-email` | Email delivery for reports |
| `export-data` | Observations / reports export (consolidate `observations-export`) |
| `import-data` | Historical data import (consolidate `import-data` + `import-historical-data`) |
| `submit-dispute-intake` | Public dispute submission |
| `public-case-lookup` | Public notice lookup |
| `hotspot-data` | Hotspot heatmap data for admin |
| `process-homeless-data` | Homeless data import |
| `nightly-privacy-cleanup` | Privacy compliance cleanup |
| `manage-user` | Consolidated user password management (`set-user-password` + `update-user-password`) |
| `photo-maintenance` | Consolidated nightly photo job (`photo-recovery` + `daily-photo-reconciler` + `reingest-photos`) |

| Cut / Consolidate | Why |
|---|---|
| `recalculate-compliance` | Dead — superseded by `-v3` |
| `recalculate-compliance-v2` | Dead — superseded by `-v3` |
| `recalculate-compliance-v3` | **Fold into `cleanup-and-recalculate`** (already called there) |
| `alpr-process` + `alpr-retry` + `orc-ingest` + `plate-scanner-photo-first` | **Consolidate into `process-officer-scan`** — these are all steps in the same scan pipeline |
| `scan-breaches` | **Fold into `cleanup-and-recalculate`** — breach detection runs as part of nightly cleanup |
| `check-nzscv-status` | **Fold into `process-officer-scan`** — SCV check is a step in the scan |
| `analyze-vehicle-photo` | **Fold into `process-officer-scan`** step 3 |
| `vehicle-ingest` | **Fold into `process-officer-scan`** — vehicle record creation is a scan step |
| `duplicate-detection` | **Fold into `cleanup-and-recalculate`** Phase 2 |
| `correct-zone-assignments` | **Fold into `cleanup-and-recalculate`** Phase 1 |
| `zone-correction` | **Fold into `cleanup-and-recalculate`** Phase 1 |
| `check-zone-corrections` | Dev/diagnostic tool — move to internal admin |
| `check-data-integrity` | Dev/diagnostic tool — move to internal admin |
| `check-railway-health` | Dev/diagnostic tool — keep internal only; now called by Railway diagnostics |
| `check-almost-breaches` | **Fold into `cleanup-and-recalculate`** as overnight prediction phase |
| `get-compliance-statistics` | Frontend can query the DB directly via RPC |
| `observations-list` | Frontend queries Supabase directly |
| `observations-in-bounds` | Frontend queries Supabase directly with PostGIS |
| `generate-dashboard-report` | Consolidate into `send-report-email` |
| `generate-leadership-pack` | Consolidate into `send-report-email` |
| `generate-vehicle-report` | Consolidate into `send-report-email` |
| `generate-incident-pdf` | Consolidate into `generate-notice-to-vacate` |
| `admin-incident-ops` | Frontend can do this directly |
| `enrich-from-motorweb` | Fold into `cleanup-and-recalculate` vehicle enrichment step |
| `select-best-vehicle-photo` | Fold into `process-officer-scan` |
| `link-evidence-photos` | Fold into `process-officer-scan` |
| `photo-recovery` + `daily-photo-reconciler` + `reingest-photos` + `scrape-vehicle-photos` + `parkpow-photo-sync` + `parkpow-sync` | **Consolidate into `photo-maintenance`** scheduled job (see keep list) |
| `sync-spatial-layers` | Fold into `cleanup-and-recalculate` |
| `suggest-new-zone` | Remove — AI suggestion is not used |
| `test-compliance-matrix` | Dev tool — remove from production |
| `stream-webhook` | Fold into `process-officer-scan` (this is called by the stream) |
| `update-compliance-policy` | Frontend does this directly |
| `send-invite-email` | Use Supabase built-in invite |
| `send-push-notification` | Simplify to be part of `monitor-officer-welfare` |
| `set-user-password` + `update-user-password` | **Consolidate into `manage-user`** (see keep list) |
| `create_auth_and_profiles` | Merge into `create-user` |
| `upload-file` | Remove — frontend can upload direct to Supabase Storage |
| `get-weather` | Remove — weather data is not core to compliance enforcement |
| `onspace-ai-chat` | **Phase 2** — AI admin chat assistant via inference-service `/chat` only. Keep the edge function; disable in UI until Phase 2 |
| `process-credential-document` + `process-investigation-document` | **Phase 2** — AI document processing. Keep the edge functions; wire up in v2 |

---

### 3.2 Database Tables: Keep 36, Cut 20+

#### Keep (core, actively used)

| Table | Purpose |
|---|---|
| `organizations` | Multi-tenancy anchor |
| `user_profiles` | User records with role |
| `zones` | Geofenced compliance areas |
| `zone_compliance_matrix` | Versioned compliance rules per zone |
| `zone_legal_config` | Payment, objections, and dispute portal per zone |
| `zone_signage_evidence` | Photo evidence of posted signage (legal defensibility) |
| `observations` | Core fact table — every plate scan |
| `breach_alerts` | Unresolved compliance breaches |
| `canonical_vehicles` | Vehicle attributes (make/model/year/colour) |
| `canonical_scv` | SCV certification per plate |
| `canonical_homeless` | Homeless status per plate |
| `infringement_notices` | Issued infringement notices |
| `infringement_notice_counters` | Atomic sequential number generation per org |
| `notices_to_vacate` | Issued NTV documents |
| `enforcement_cases` | Case management for repeat offenders |
| `enforcement_case_events` | Timeline events for each case |
| `patrols` | Patrol sessions |
| `patrol_schedule_zones` | Zones assigned to a patrol |
| `patrol_checkpoints` | QR lone-worker safety checkpoints |
| `checkpoint_visits` | Officer QR scan events at checkpoints |
| `officer_shifts` | Shift start/end records |
| `officer_welfare_settings` | Per-org welfare check intervals |
| `officer_welfare_alerts` | Triggered lone-worker welfare alerts |
| `officer_activity_log` | Heartbeat / GPS location log for welfare |
| `incidents` | Field incident and maintenance reports |
| `incident_attachments` | Photo/document evidence for incidents |
| `health_safety_reports` | Formal H&S incident reports |
| `person_records` | Known individuals linked to plates |
| `person_observations` | Person–observation links |
| `person_vehicle_links` | Person–plate associations |
| `person_interactions` | Officer interaction history per person |
| `audit_log` | Immutable action log |
| `dispute_intake` | Public dispute submissions |
| `privacy_access_log` | Privacy Act 2020 PII access log |
| `privacy_curtain_settings` | Per-org privacy redaction rules |
| `retention_policies` | Data retention schedules per org |

#### Cut or Merge

| Table | Disposition |
|---|---|
| `flagged_vehicles` | **Merge into `canonical_homeless`** — it's the same concept. Use `canonical_homeless.status = 'flagged'` |
| `homeless_records` | **Merge into `canonical_homeless`** — duplicates the concept |
| `vehicle_discrepancies` | Useful but niche — keep as opt-in phase-2 feature. Remove from initial clean build |
| `investigation_jobs` + `investigation_job_templates` | Rarely used — phase-2 only |
| `incident_reports` (if separate) | Already merged into `incidents` + `enforcement_cases` |
| `compliance_results` (if still exists) | Was replaced by columns on `observations` |
| `photo_records` (if separate) | Merged into `observations.photo_url` |
| `vehicle_monthly_stays` | **Cut** — was a pre-aggregated cache of monthly stay counts per vehicle per zone. The compliance RPC now counts directly from `observations` using a rolling window. Removing this table eliminates a maintenance burden. |
| `privacy_impact_assessments` | Niche compliance feature — Phase 2 only |
| `canonical_persons` | Cross-org person matching — Phase 2 only |

---

### 3.3 Frontend Pages: Keep 18, Cut/Merge 40+

#### What to cut immediately

| Page | Reason |
|---|---|
| `TestDashboard.tsx` | Developer tool |
| `CleanDashboard.tsx` | Prototype replaced by `AdminPortal` |
| `DataCleanupUtility.tsx` | Internal admin tool, not for clients |
| `DataIntegrityDashboard.tsx` | Internal admin tool |
| `SystemDiagnostics.tsx` | Internal admin tool |
| `CleanupAndRecalculate.tsx` | Exposes internal DB operations to admins |
| `ComplianceRecalculation.tsx` | Developer/debug page |
| `PhotoReingest.tsx` | Internal tool |
| `EvidencePhotoLinker.tsx` | Internal tool |
| `PHASE_3_COMPLETE.md` etc. | Development notes, not pages |

#### What to merge

| Pages | Merge into |
|---|---|
| `ComplianceDashboard` + `ComplianceAnalytics` + `CompliancePage` | One `Compliance.tsx` page with tabs |
| `VehicleManagement` + `VehicleRegistry` + `VehicleDetailPage` | `Vehicles.tsx` with drill-down |
| `ObservationRecords` + `ObservationsReport` + `ObservationsView` | `Observations.tsx` with filters |
| `LivePatrolMonitor` + `LiveOfficerTracking` | `LiveMap.tsx` |
| `BreachAlerts` + `BreachNotices` | `Breaches.tsx` with alert/notice tabs |
| `EnforcementCommandCenter` + `EnforcementActions` + `EnforcementReview` | `Enforcement.tsx` with workflow tabs |
| `ReportsHub` + `Reports` + `IncidentReports` | `Reports.tsx` |
| `DataManagement` + `DataManagementHub` + `ImportData` + `ImportHistoricalData` | `DataImport.tsx` |
| `PatrolScheduleManagement` + `PatrolKPIDashboard` | `Patrols.tsx` with schedule/KPI tabs |
| `PrivacyCurtain` | Merge as a tab within `Settings.tsx` |
| `SpatialComplianceAdmin` | Merge as a tab within `Zones.tsx` |

---

## 4. Clean Schema (36 tables, not 40+)

### Entity-Relationship Summary

```
organizations
  └── user_profiles (role: officer | admin | master | grand_master)
  └── zones
        └── zone_compliance_matrix
        └── zone_legal_config
        └── patrols
              └── patrol_schedule_zones
  └── observations (plate_number, zone_id, officer_id, photo_url, is_compliant)
        └── breach_alerts
        └── infringement_notices
        └── notices_to_vacate
  └── enforcement_cases
        └── dispute_intake

canonical_vehicles  (plate-level, cross-org, make/model/year/colour)
canonical_scv       (plate-level, SCV certification)
canonical_homeless  (plate-level, homeless/flagged status — replaces flagged_vehicles + homeless_records)

officer_shifts      (shift start/end, GPS)
patrol_checkpoints  (QR lone-worker check-ins) [optional]
person_records      (individuals linked to plates)
audit_log           (immutable)
privacy_access_log  (PII access)
```

### Storage Buckets (3)

| Bucket | Contents | Access |
|---|---|---|
| `scans` | Vehicle scan photos uploaded by officers | Authenticated (org-scoped read/write) |
| `notice-artifacts` | Generated PDFs: Notice to Vacate, Infringement Notice | Authenticated (read); admin write |
| `incident-evidence` | Photos attached to enforcement cases | Authenticated (org-scoped) |

All three buckets have RLS policies. The `scans` bucket is the primary one — every
`process-officer-scan` call uploads the photo here before returning a result.

### One Migration File

A clean rebuild starts from a **single** `001_initial_schema.sql` file that creates all
20 tables with correct indexes, RLS policies, triggers, and RPCs. No migration archaeology.

The starting migration file should be ~800 lines of clean SQL, not 200+ individual files
that need to be applied in sequence. The existing codebase provides the exact final shape.

---

## 5. Clean Edge Function Set (17, not 69)

### Consolidated scan pipeline

```
Officer taps "Scan" on phone
  │
  └── process-officer-scan (single function, ~600 lines)
        1. Receive photo + GPS + officer context
        2. Send photo to Bob inference service on RunPod (ALPR + vehicle attributes)
        3. Look up plate in canonical_vehicles (make/model/year/colour)
        4. Look up plate in canonical_scv (SCV status)
        5. Look up plate in canonical_homeless
        6. Determine zone from GPS
        7. Run calculate_vehicle_compliance_v3() RPC
        8. Create observation record
        9. Create breach_alert if non-compliant
        10. Return verdict to officer
```

This replaces: `process-officer-scan` + `alpr-process` + `alpr-retry` + `orc-ingest` +
`plate-scanner-photo-first` + `check-nzscv-status` + `analyze-vehicle-photo` +
`vehicle-ingest` + `stream-webhook` + `select-best-vehicle-photo` + `link-evidence-photos`.

### Consolidated nightly cleanup

```
pg_cron → cleanup-and-recalculate (runs 3am NZT)
  Phase 1: Zone GPS correction (reassign observations to correct zone)
  Phase 2: Duplicate detection + breach dedup
  Phase 3: Vehicle attribute refresh from canonical sources
  Phase 4: Overnight breach detection (check-almost-breaches logic)
  Phase 5: Compliance recalculation for corrected observations
  Phase 6: Photo maintenance (reconcile, reingest missing photos)
  Phase 7: SCV list sync from NZSCV registry
```

This replaces: `cleanup-and-recalculate` + `recalculate-compliance-v3` + `scan-breaches` +
`correct-zone-assignments` + `zone-correction` + `check-zone-corrections` +
`duplicate-detection` + `check-almost-breaches` + `sync-scv-list` (scheduled) +
`daily-photo-reconciler` + `enrich-from-motorweb` + `sync-spatial-layers`.

---

## 6. Infrastructure Services: Inference Service & Proxy Server

**Short answer: Yes — both services are essential and stay in the clean rebuild.**

These two Node/Express microservices live outside Supabase because they do things
Supabase edge functions fundamentally cannot do:

| Service | What Supabase can't do | Solution |
|---|---|---|
| `inference-service/` | Load ONNX models (YOLOv8n, MobileNetV3) — native binaries, 30 MB of model files | Node.js microservice on Fly.io/Railway/Render |
| `proxy-server/` | Use a static IP address — edge functions use dynamic IPs and NZSCV requires IP whitelist | Node.js proxy on DigitalOcean/Railway with static IP |

---

### 6.1 Inference Service (`inference-service/`)

**What it does** (two endpoints, both essential):

```
POST /infer
  ├── Receive: officer phone photo (multipart/form-data)
  ├── Step 1: YOLOv8n detects vehicle bounding box
  ├── Step 2: Crop vehicle from full image
  ├── Step 3: MobileNetV3 generates 384-dimensional embedding
  └── Return: { embedding, embedding_quality, detection.confidence }

POST /nlp/tabular/analyze
  ├── Receive: sample rows from CSV/XLSX import
  └── Return: date format detection, data quality issues, field mapping hints
              (used by the historical data import wizard)

GET /health
  └── Returns model load status + uptime (used by cleanup-and-recalculate health check)
```

**What it does NOT need to do in the clean rebuild** (can be removed):

| Feature | Status | Reason |
|---|---|---|
| Cloud AI provider paths | Remove | Production policy requires self-contained inference-service only |
| Vehicle attribute extraction (make/model/year/colour via ONNX) | Keep | Supplements canonical_vehicles data |

**Environment variables it needs:**

```env
# Required
PORT=3000
INFERENCE_API_KEY=<random-secret>           # How edge functions authenticate
SUPABASE_URL=https://xxx.supabase.co        # For JWT verification (alternative auth)
ALLOWED_ORIGINS=https://xxx.supabase.co     # CORS restriction

# Self-contained enforcement (required in production)
SELF_CONTAINED_MODE=true
REQUIRE_SELF_CONTAINED_MODE=true
SELF_CONTAINED_STRICT_EGRESS=true
VEHICLE_ATTRS_PROVIDER=basic                # basic only in strict mode
CHAT_PROVIDER=heuristic

# Optional (tabular NLP)
TABULAR_NLP_PROVIDER=heuristic             # heuristic only in strict mode
```

**How process-officer-scan calls it:**

```
process-officer-scan edge function
  │
  └── INFERENCE_SERVICE_URL env var (set in Supabase secrets)
      ├── POST ${INFERENCE_SERVICE_URL}/infer  (with officer photo)
      └── Returns embedding + quality score
```

**Deployment recommendation for clean rebuild:**

> Deploy to **Fly.io** on a `shared-cpu-1x 512MB` instance.
> Cost: ~$5–10/month. Auto-sleeps between scans.
> Models are baked into the Docker image — no cold-start model download.

```bash
# inference-service/Dockerfile already exists — just deploy:
fly launch --name fcm-inference
fly secrets set INFERENCE_API_KEY=<secret> SUPABASE_URL=<url>
fly deploy
```

**What to clean up in the inference service:**

| Change | Why |
|---|---|
| Keep default providers at local-only settings (`basic` + `heuristic`) | Enforces no-cloud-AI policy and minimizes data egress risk |
| Add request timeout (10s hard limit) to `/infer` | Prevents hung requests from blocking the scan pipeline |
| Add `/health` response to include `INFERENCE_API_KEY` configured flag | Helps with deployment debugging |
| Remove model download step from README (bake models into Docker image) | Simpler deployment — no manual `npm run download-models` step |

---

### 6.2 Proxy Server (`proxy-server/`)

**What it does** (three endpoints):

```
POST /api/nzscv/vehicle-info
  ├── Proxies NZSCV Self-Contained Vehicle Registry API
  ├── Adds PGDB-Identifier + PGDB-Authorization headers
  └── Needed because NZSCV requires IP whitelist, Supabase has dynamic IPs

GET /motorweb/currentOwnerCheck
  ├── Proxies MotorWeb vehicle ownership lookup (XML response)
  └── Needed for same IP whitelist reason

POST /api/email/send-invite    ← REDUNDANT — remove in clean rebuild
  └── This duplicates what create-user edge function already does
      via Supabase's built-in inviteUserByEmail(). Remove this endpoint.

GET /health                    ← Keep
GET /api/info                  ← Keep (diagnostic)
```

**The proxy server's ONLY irreplaceable job is the static IP.**

Both NZSCV and MotorWeb require you to register a static IP address before they will
accept API calls. Supabase edge functions run on Cloudflare Workers and use thousands
of different IPs — impossible to whitelist. The proxy server solves this.

**What to clean up in the proxy server:**

| Change | Why |
|---|---|
| **Remove `/api/email/send-invite`** | Duplicates `create-user` edge function. Having two email code paths creates bugs (out-of-sync templates, different error handling). |
| Remove `nodemailer` dependency | No longer needed once email endpoint removed |
| Add rate limiting (1 req/sec) to NZSCV endpoint | NZSCV enforces 1 req/sec — the proxy should enforce this too |
| Move `PROXY_SECRET` validation into middleware | Remove copy-pasted auth check from each endpoint |

**Cleaned proxy server structure:**

```javascript
// proxy-server/server.js (clean version)

const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

// Shared auth middleware
function requireProxySecret(req, res, next) { ... }

// NZSCV registry lookup (static IP required)
app.post('/api/nzscv/vehicle-info', requireProxySecret, nzscvHandler);

// MotorWeb vehicle enrichment (static IP required)
app.get('/motorweb/currentOwnerCheck', requireProxySecret, motorwebHandler);

// Health
app.get('/health', (req, res) => res.json({ status: 'ok' }));
```

**Environment variables it needs:**

```env
# Required
NZSCV_API_KEY=<from NZSCV application>
NZSCV_ID_KEY=<from NZSCV application>
NZSCV_ENDPOINT_URL=https://www.nzscv.co.nz/api/rest/scv/v1/vehicleregistrationinfo
PROXY_SECRET=<random secret shared with Supabase edge functions>

# MotorWeb (optional — only if using vehicle enrichment)
MOTORWEB_API_KEY=<from MotorWeb>
MOTORWEB_ID_KEY=<from MotorWeb>
```

**How edge functions call the proxy:**

```
sync-scv-list edge function + cleanup-and-recalculate
  │
  └── NZSCV_PROXY_URL env var (set in Supabase secrets)
      └── POST ${NZSCV_PROXY_URL}/api/nzscv/vehicle-info
          Header: x-proxy-secret: <PROXY_SECRET>
```

**Deployment recommendation for clean rebuild:**

> Deploy to **DigitalOcean Droplet** ($6/month, Sydney region, guaranteed static IP).
> Static IP is included — no extra cost unlike Railway ($5 extra/month for static IP).
> Use PM2 for process management.

The DigitalOcean static IP is the address you register with NZSCV. Keep it forever.
Changing this IP means re-applying to NZSCV — avoid if possible.

---

### 6.3 Architecture Diagram (Clean Rebuild)

```
┌──────────────────────────────────────────────────────────┐
│                   Officer's Phone                        │
│         FreedomCamp Manager PWA (React/Vite)             │
└────────────────────────┬─────────────────────────────────┘
                         │ HTTPS
                         ▼
┌──────────────────────────────────────────────────────────┐
│                  Supabase                                │
│  ┌──────────────────────────────────────────────────┐   │
│  │          process-officer-scan (Deno)             │   │
│  │  1. Receives photo + GPS                         │   │
│  │  2. ──► inference-service /infer ──────────────────── ► Fly.io
│  │  3. Looks up canonical_scv, canonical_vehicles   │   │   (ONNX inference)
│  │  4. Calls calculate_vehicle_compliance_v3() RPC  │   │
│  │  5. Writes observation + breach_alert            │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │    cleanup-and-recalculate (pg_cron, 3am NZT)    │   │
│  │  Phase 7: ──► proxy-server /api/nzscv ─────────────── ► DigitalOcean
│  └──────────────────────────────────────────────────┘   │   (NZSCV + MotorWeb)
│                                                          │
│  PostgreSQL (20 tables)  ·  Storage (photos)  ·  Auth   │
└──────────────────────────────────────────────────────────┘
```

**Monthly infrastructure cost for one client:**

| Service | Provider | Cost |
|---|---|---|
| Supabase | Supabase Pro | $25/month |
| Inference service | Fly.io (shared-cpu-1x) | $5–10/month |
| NZSCV/MotorWeb proxy | DigitalOcean Droplet | $6/month |
| **Total platform cost** | | **~$40/month** |

At $400–600/month per client, this is a ~10x margin on infrastructure.

---

### 6.4 AI Services

The system has **three AI touch points** and must run in **self-contained inference mode**.
Do not configure direct external cloud AI providers for production enforcement workflows.

```
┌─────────────────────────────────────────────────────────┐
│  AI Touch Point 1: ONNX Inference (inference-service)   │
│  Vehicle detection (YOLOv8n) + embeddings (MobileNetV3) │
│  Runs 100% locally — no external API call               │
│  Required: every officer scan that includes a photo     │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  AI Touch Point 2: Inference attribute + tabular NLP    │
│  (via inference-service only)                           │
│                                                         │
│  a) Vehicle attribute extraction (make/model/yr/colour) │
│     VEHICLE_ATTRS_PROVIDER=basic in inference-service   │
│     Uses local model + deterministic heuristics         │
│                                                         │
│  b) SCV sticker detection (analyze-vehicle-photo)       │
│     Uses local inference pipeline only                   │
│     Folded into process-officer-scan in clean rebuild   │
│                                                         │
│  c) Tabular NLP (inference-service /nlp/tabular/analyze)│
│     Detects date formats and data quality in CSV imports│
│     Used by import-data / DataImport.tsx wizard         │
│     TABULAR_NLP_PROVIDER=heuristic                      │
│                                                         │
│  Optional local upgrade: Ollama (local network only)    │
│  if approved; cloud providers are blocked in strict mode│
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  AI Touch Point 3: onspace-ai-chat (PHASE 2)            │
│  Admin conversational assistant                         │
│  "Which zones had the most breaches this week?"         │
│  "Summarise this officer's patrol performance"          │
│  Edge function: onspace-ai-chat (already exists)        │
│  Frontend hook: edgeFunctions.aiChat() (already wired)  │
│  Status: Edge function kept, UI disabled until Phase 2  │
└─────────────────────────────────────────────────────────┘
```

**Environment variables for AI (production baseline):**

```env
# Supabase Edge Function secrets
INFERENCE_SERVICE_URL=https://api.runpod.ai/v2/<RUNPOD_ENDPOINT_ID>/runsync
INFERENCE_API_KEY=<inference-shared-secret>

# inference-service env vars (on Fly.io / Railway)
SELF_CONTAINED_MODE=true
REQUIRE_SELF_CONTAINED_MODE=true
SELF_CONTAINED_STRICT_EGRESS=true
CHAT_PROVIDER=heuristic
VEHICLE_ATTRS_PROVIDER=basic
TABULAR_NLP_PROVIDER=heuristic
SELF_HEALING_ENABLED=true
```

**Phase 1 minimum:**
- ONNX-only inference for vehicle detection and embeddings
- Heuristic tabular NLP (no API call)
- Self-contained chat and self-healing endpoints enabled

**Phase 2 upgrade (still inference-service only):**
- Optional local Ollama-backed chat (local/private network only)
- Expanded self-healing knowledge packs and patch-task automation
- `onspace-ai-chat` enabled in admin UI — compliance trend analysis, officer summaries

---



### Role 1: Field Officer (`officer`)

**Who they are**: Security patrol officer on foot or in a vehicle. Using a phone, often
in the dark, rain, or wind. Gloves on. Phone brightness at max.

**What they need — their entire day in the app**:

```
START SHIFT
  └── Tap "Start Patrol" on their zone → GPS confirms they're in the right area

SCAN A VEHICLE
  └── Large "SCAN" button — opens camera immediately
  └── Point camera at plate → result in 3–5 seconds
  └── COMPLIANT:  Green screen. Vehicle history shown. Tap to dismiss.
  └── BREACH:     Red screen. Night count shown. Tap to issue Notice to Vacate.
  └── INCONCLUSIVE: Yellow screen. Manual plate entry offered.

ISSUE NOTICE TO VACATE
  └── Officer confirms details (pre-filled from scan)
  └── One tap → PDF generated and stored
  └── Optional: hand officer's phone to occupant to see QR code for dispute portal

WELFARE CHECK-IN
  └── Periodic notification: "Confirm you're OK?"
  └── Two-tap response: OK / Needs Help

END SHIFT
  └── Tap "End Patrol"
  └── Summary: plates scanned, breaches found, notices issued
```

**UX principles for officer portal**:
- **No navigation menu** — one view at a time, full-screen
- **Three main states**: Scanning, Result, History
- **Large text, high contrast** — readable at arm's length in daylight
- **Night patrol mode** — dim red/dark mode to preserve night vision
- **Offline indicator** always visible if not connected
- **Zero configuration** — officer selects their zone once at shift start. Nothing else.

**Remove from officer view**:
- Settings pages (admin configures these)
- Reports (admin reviews these)
- Zone management (admin manages these)
- Compliance analytics (admin reads these)
- Any mention of "canonical", "compliance matrix", "migration", "recalculate"

---

### Role 2: Admin (`admin`)

**Who they are**: A manager at Iron Eagle Security or a council compliance team member.
Desk job. Desktop browser. Checks the system daily, sometimes responds to alerts in the
field via phone.

**What they need — their entire day in the app**:

```
MORNING REVIEW (5 minutes)
  └── Dashboard: yesterday's scan count, breach rate, new alerts, open notices
  └── Breach Alerts: filter "New Today" → action each one (assign/acknowledge/dismiss)

MANAGING AN ACTIVE BREACH
  └── Click a breach alert → see full observation history for that plate
  └── Issue infringement notice → enter amount, due date → generate PDF
  └── Log contact attempt → notes field

ACCOUNT AND SITE OPERATIONS
  └── Open client account → see contacts, rates, access, sites, zones, patrol setup
  └── Add a site address → auto-resolve coordinates → link or create geofence zone
  └── Review which sites have rates configured and which zones are active

DISPATCH AND PATROL CONTROL
  └── Create or replan a patrol/dispatch job from the operational account context
  └── See whether route stops were manually progressed or auto-progressed by geofence
  └── Complete dispatch and resume route execution without losing audit trail

PATROL OVERVIEW
  └── Live Map: where are officers right now?
  └── Did they complete their scheduled zones?
  └── Any welfare check failures?

ZONE MANAGEMENT (occasional)
  └── Draw a new zone on the map → set nightly limit → save
  └── Edit legal config for infringement notices (payment URL, objections email)

REPORTS (weekly/monthly)
  └── Select date range + org → generate compliance report → email to council
  └── Export observations CSV for council records

USER MANAGEMENT
  └── Add/remove officers → send invite email → set role
```

**UX principles for admin portal**:
- **Sidebar navigation** with clear section labels
- **Dashboard is the home page** — always shows today's summary first
- **Inline actions** — admin should action a breach without leaving the breach list
- **CRM is the operational control surface** — account detail should expose sites,
  zones, contacts, rates, access, and patrol readiness in one place
- **Business management is a separate control surface** — workforce, fleet, assets,
  maintenance checks, and staff audit should not be scattered across unrelated pages
- **Keyboard shortcuts** for power users (acknowledge alert: A, assign: S, dismiss: D)
- **No developer tools** — no cleanup utility, no recalculation triggers, no diagnostic pages

### Admin information architecture: two-part model

The rebuilt admin side should be treated as two connected but distinct surfaces.

**Part 1 — CRM / Client Operations**
- Account records for service providers and clients
- Contacts, commercial settings, rates, and access
- Sites and zones as the operational hierarchy
- Patrol and dispatch readiness from the account context
- Client-facing configuration and contract visibility

**Part 2 — Business Management**
- Staff and user lifecycle: onboarding, roles, credentials, skills, availability
- Workforce operations: roster, open shifts, timesheets, approvals
- Fleet and asset management: vehicles, equipment, inspections, servicing, maintenance state
- Daily operational checks: vehicle checklists, asset readiness, defect logging
- Internal governance: audit log, staff activity, compliance evidence, internal safety controls

This split matters because CRM answers **who we serve and where work happens**, while
Business Management answers **who will do the work, with what equipment, and with what
internal controls**.

### Required crossover between CRM and Business Management

The two surfaces must be linked by design, not by ad-hoc navigation.

- CRM account and site setup must expose staffing readiness (assigned staff count, skills coverage, roster status)
- Business Management staffing and roster flows must be context-aware of client account, site, and zone
- Dispatch and patrol scheduling must be able to start from CRM account/site context and continue in Business Management workflows
- Daily checks for staff, vehicles, and assets must roll up to account-level service health visible in CRM
- Audit history must preserve both account context and staff/equipment context for every operational transition

### Client-side portal surface

The rebuild must include a dedicated client-side portal for organisations that consume services.

Client-side portal outcomes:

- View contracted sites and linked zones
- View patrol and dispatch completion summaries for their sites
- View incidents, compliance outcomes, and service-level reports for their contract scope
- View named contacts, support pathways, and dispute/objection links relevant to their account
- No access to provider internal controls such as staff records, internal audit trails, or fleet maintenance internals

---

### Role 3: Master (`master`)

**Who they are**: Senior manager or account manager who runs multiple contracts (multiple
organizations). May be the same person as admin for smaller deployments.

**Additional access beyond admin**:

```
MULTI-ORG VIEW
  └── Dashboard shows all orgs they manage, with KPIs per org
  └── Can switch between orgs without logging out
  └── Can see cross-org vehicle histories (helpful for habitual violators who move between areas)

CONTRACT REPORTING
  └── Monthly council report with compliance rate, breach count, NTV count
  └── Officer performance KPIs (scans per shift, breach conversion rate)
  └── Zone health report (which zones have the most activity)

USER MANAGEMENT
  └── Can create admin users (not just officers)
  └── Can deactivate officers or admins

AUDIT ACCESS
  └── Full audit log access for their orgs
  └── Privacy access log review (Privacy Act 2020 compliance)
```

---

### Role 4: Grand Master (`grand_master`)

**NEW ROLE** — Platform owner / sales. This is Don (or a future senior account manager
at Iron Eagle) who manages the entire platform across all clients.

**What they need — a new role in the system**:

```
PLATFORM OVERVIEW
  └── All organizations on the platform
  └── Total scans, breaches, notices across the entire platform (anonymised for sales)
  └── Platform health: which orgs are active, which are stale, which need attention

CLIENT ONBOARDING
  └── Create a new organization
  └── Set up first admin user → send invite
  └── Configure branding (org name, logo for notices)
  └── Set up zones (draw boundaries)
  └── Activate/deactivate organization (billing control)

BILLING & SUBSCRIPTION
  └── Per-org: active officer count, scans this month, notices issued
  └── Export billing data for invoicing
  └── Suspend or reactivate an org

PLATFORM SETTINGS
  └── Global SCV list management (sync-scv-list)
  └── Feature flags per org (enable/disable dispute portal, infringement notices, etc.)
  └── SMTP and notification settings

SALES DEMO MODE
  └── One-click load of demo data for a prospective client presentation
  └── Demo org with realistic NZ freedom camping data
  └── Clean teardown after demo
```

**Why grand_master ≠ master**:
- `master` manages multiple contracts but is still an operational role
- `grand_master` manages the platform itself — they see across all orgs but their job
  is sales, onboarding, and billing, not enforcement operations

---

### Role 5: Admin Officer (`admin_officer`)

**Who they are**: A team member who is both a field officer AND an admin — common in
small deployments where the shift supervisor also handles desk duties.

**How it works**: `admin_officer` is a dual role that grants access to both portals.
At login, PortalSelection.tsx asks which mode they want today: Field or Admin.

**What they can do**:
- Everything a field officer can do (scan, patrol, welfare)
- Everything an admin can do (breach management, reports, zone management)

**Why keep this role in the clean rebuild**:
This role is actively used in current deployments. Removing it would require small
security companies to create two separate accounts for the same person.

**Route guard**: `['officer', 'admin_officer']` for field routes;
`['admin', 'admin_officer', 'master']` for admin routes.

---

## 8. Clean Frontend Structure

### Pages (21 total)

```
Public (no auth)
├── /login                 Login.tsx
├── /portal-selection      PortalSelection.tsx
└── /dispute               PublicDisputePortal.tsx

Client (client-scoped authenticated users)
└── /client-portal         ClientPortal.tsx    ← sites, zones, service status, reports, disputes

Field Officer (officer, admin_officer)
└── /field                 FieldOfficerPortal.tsx
      ├── view: scan        Full-screen camera + result
      ├── view: history     Last 24h scans
      └── view: shift       Start/end patrol, welfare check

Admin (admin, admin_officer, master)
├── /dashboard             Dashboard.tsx       ← today's KPIs
├── /crm                   CRM.tsx             ← accounts, sites, contacts, rates, access
├── /business              Business.tsx        ← staff, roster, fleet, assets, checks, audit
├── /live                  LiveMap.tsx         ← officer locations + zones
├── /breaches              Breaches.tsx        ← alerts tab + notices tab
├── /vehicles              Vehicles.tsx        ← search + detail
├── /observations          Observations.tsx    ← searchable history
├── /zones                 Zones.tsx           ← map + compliance rules + site-linked geofences
├── /patrols               Patrols.tsx         ← schedule + KPIs + dispatch/route execution
├── /enforcement           Enforcement.tsx     ← cases + infringement notices
├── /reports               Reports.tsx         ← generate + export
└── /compliance            Compliance.tsx      ← analytics + breakdown

Master (master + above)
└── /organizations         Organizations.tsx   ← multi-org switcher + KPIs

Grand Master (grand_master only)
└── /platform              Platform.tsx        ← all orgs, billing, onboarding

Shared (all authenticated)
├── /profile               Profile.tsx
└── /settings              Settings.tsx
```

### What disappears from the UI

- `TestDashboard`, `CleanDashboard`, `DataCleanupUtility`, `DataIntegrityDashboard`,
  `SystemDiagnostics`, `CleanupAndRecalculate`, `ComplianceRecalculation`,
  `PhotoReingest`, `EvidencePhotoLinker` — all deleted
- `PHASE_*.md` files in `src/pages/` — deleted (they're markdown notes, not pages)
- Duplicate compliance pages (`CompliancePage`, `ComplianceAnalytics`,
  `ComplianceDashboard`) → merged into one `Compliance.tsx`
- `CRMModule`, `ClientAccountPage`, `ClientSites`, and client account fragments
  → merged into one `CRM.tsx` surface with account overview and embedded site operations
- `UserManagement`, `OfficerAvailability`, `OfficerSkills`, `OpenShifts`,
  `TimesheetReview`, `AssetManagement`, and internal audit/fleet fragments
  → merged into one `Business.tsx` surface with tabs for people, roster, fleet,
  assets, daily checks, and audit
- legacy client-facing fragments and one-off account report pages
  → merged into `ClientPortal.tsx` with strict contract-scope visibility

---

## 9. New Role: Grand Master (Platform Owner)

### DB change required

```sql
ALTER TABLE public.user_profiles
  DROP CONSTRAINT user_profiles_role_check,
  ADD CONSTRAINT user_profiles_role_check
    CHECK (role IN ('officer', 'admin', 'admin_officer', 'master', 'grand_master'));
```

Note: `nzscv_monitor` is removed (this read-only function can be covered by giving a
`master` scoped access, or by building a simple external monitoring dashboard).

### Frontend route guard

```tsx
// Grand master only sees /platform
<Route path="/platform" element={
  <ProtectedRoute>
    <RoleRoute allowedRoles={['grand_master']}>
      <Platform />
    </RoleRoute>
  </ProtectedRoute>
} />
```

### `Platform.tsx` page — key views

**Overview tab**
- Total organisations: active / trial / suspended
- Platform-wide stats: scans this month, breaches, notices (across all orgs)
- Map of all active zones in NZ (sales demo visual)

**Organisations tab**
- List with: org name, region, officer count, scans this month, contract status
- Actions: Edit, Suspend, Activate, View as Admin
- Create New Organisation button → wizard (name → admin user → zones → activate)

**Billing tab**
- Per-org: monthly scan count, officer seats, notice count
- Export CSV for invoicing
- Billing period selector

**Platform Settings tab**
- SCV list: last sync date, trigger manual sync
- Feature flags per org (JSON config)
- SMTP settings test
- Demo mode: load/clear demo data

---

## 10. Step-by-Step Clean Rebuild Order

This is a practical sequence that produces a working app at each step.

### Phase A — Foundation (1–2 days)

1. Create new Supabase project (or run against existing with migration reset)
2. Apply single `001_initial_schema.sql` (20 tables, indexes, RLS, triggers, RPCs)
3. Configure auth (email templates, SMTP secrets)
4. Deploy `create-user` edge function
5. Create first `grand_master` user
6. Verify login works

**Done**: You can log in and create orgs/users.

---

### Phase A.5 — Deploy Infrastructure Services (1 day)

These must be deployed before the scan pipeline because `process-officer-scan` calls both.

**Inference service (Fly.io):**
1. `cd inference-service && fly launch --name fcm-inference`
2. `fly secrets set INFERENCE_API_KEY=<secret> SUPABASE_URL=<url> ALLOWED_ORIGINS=<supabase-url>`
3. `fly deploy`
4. Test: `curl https://fcm-inference.fly.dev/health`
5. Copy URL → set `INFERENCE_SERVICE_URL` Supabase secret

**Proxy server (DigitalOcean, $6/month):**
1. Create Ubuntu 22.04 Droplet in Sydney region
2. SSH in → install Node 18, PM2, upload `proxy-server/` folder
3. Set `.env` with `NZSCV_API_KEY`, `NZSCV_ID_KEY`, `NZSCV_ENDPOINT_URL`, `PROXY_SECRET`
4. `pm2 start server.js --name fcm-proxy && pm2 save`
5. Note the static Droplet IP → register with NZSCV (see proxy-server/README.md)
6. Copy proxy URL → set `NZSCV_PROXY_URL` + `PROXY_SECRET` Supabase secrets

**Done**: Inference and NZSCV lookup are operational. Scan pipeline can call both.

---

### Phase B — Scan Pipeline (2–3 days)

1. Set Supabase secrets: `INFERENCE_SERVICE_URL`, `NZSCV_PROXY_URL`, `PROXY_SECRET`
2. Deploy `process-officer-scan` (consolidated, ~600 lines)
3. Implement `FieldOfficerPortal.tsx` (scan + result + history views only)
4. Verify: officer scans a plate → gets compliance result (including ONNX embedding + SCV check)
5. Verify: offline queue works (scan without signal → syncs on reconnect)
6. Implement welfare check-in notifications

**Done**: A field officer can do their full job.

---

### Phase C — Admin Operations (2–3 days)

1. Implement `Dashboard.tsx` (today's KPIs from `get_admin_dashboard_stats()` RPC)
2. Implement `CRM.tsx` (account overview, contacts, rates, access, sites, zones)
3. Implement `Business.tsx` (staff, roster, fleet, assets, maintenance, audit)
4. Implement `Breaches.tsx` (alert queue with inline actions)
5. Implement `LiveMap.tsx` (officer positions + zone polygons)
6. Implement `Zones.tsx` (zone CRUD + compliance rules + address-driven geofence defaults)
5. Deploy `generate-notice-to-vacate` + `generate-infringement`
6. Implement `Enforcement.tsx` (NTV + infringement notice generation)

**Done**: An admin can manage their full daily workflow.

### Phase C.5 — Client Portal (1 day)

1. Implement `ClientPortal.tsx` (site and zone service visibility, summaries, reports, dispute links)
2. Enforce client-scope route guards and account-level visibility boundaries
3. Add CRM -> ClientPortal handoff from account view for role-appropriate users

**Done**: Client organisations can self-serve service visibility without accessing provider internals.

---

### Phase D — Reports & Analytics (1–2 days)

1. Implement `Compliance.tsx` (breakdown by zone, chart over time)
2. Implement `Reports.tsx` (date range → generate → email or download)
3. Implement `Vehicles.tsx` (search by plate, show history)
4. Implement `Patrols.tsx` (schedule + KPI dashboard + dispatch completion + route execution)

**Done**: Admin can produce council reports.

---

### Phase E — Multi-org & Grand Master (1–2 days)

1. Implement `Organizations.tsx` (master multi-org switcher)
2. Implement `Platform.tsx` (grand master overview + billing)
3. Deploy `process-homeless-data`, `sync-scv-list`
4. Implement `Users.tsx` (full user management)

**Done**: Grand master can onboard new clients and manage the platform.

---

### Phase F — Dispute & Public Portal (1 day)

1. Deploy `submit-dispute-intake`, `public-case-lookup`
2. Implement `PublicDisputePortal.tsx` (public form)
3. Add dispute queue to `Enforcement.tsx`

**Done**: Full end-to-end enforcement workflow including disputes.

---

### Phase G — Cleanup & Polish (1 day)

1. Delete all dead pages (`TestDashboard`, etc.)
2. Delete all dead edge functions (`recalculate-compliance`, `-v2`, etc.)
3. Run `bun run build` — zero TypeScript errors
4. Run `bun run lint` — zero lint errors
5. Run full manual test against staging

**Done**: Production-ready clean build.

---

## 11. Sales Strategy & Client Pitch

### 10.1 Target Clients

| Client Type | Who to speak to | Pain point |
|---|---|---|
| **District/City Councils** | Compliance Manager, Parks Manager | Manual paper-based enforcement, no audit trail, no court-ready records |
| **Regional Councils** | Reserves Officer, Bylaws Officer | Same as above + cross-district data sharing |
| **Security Companies** (like Iron Eagle) | Operations Manager, Contract Manager | Reporting to councils is manual, time-consuming, inconsistent |
| **DoC (Department of Conservation)** | Field Operations | Remote sites, no connectivity, need offline capability |

---

### 10.2 The Two-Sentence Pitch

> *"FreedomCamp Manager is a digital enforcement platform that lets patrol officers scan
> a vehicle's number plate with their phone and know within 5 seconds whether they're
> legally camping. Every scan is GPS-stamped, photo-evidenced, and court-ready — and
> your council gets a monthly compliance report without any manual data entry."*

---

### 10.3 Demo Flow (15-minute sales demo)

**Setup before the demo**: Load demo org "Demo Council - Nelson" with 3 zones, 5 officers,
and 2 weeks of realistic scan history including breaches and notices.

**Step 1 — Show the problem (2 min)**
> "This is what it looked like before: [show a photo of a notebook with handwritten plate
> numbers]. No GPS. No photo. No timestamp. Impossible to prove in court."

**Step 2 — Officer view (5 min)**
> "This is what your officer sees on their phone." Open `FieldOfficerPortal` on a phone.
> - Tap Start Patrol
> - Scan a demo plate (or type it manually)
> - Show the BREACH result — red screen, shows 4 nights this week (limit: 2)
> - Tap "Issue Notice to Vacate" — show the auto-filled form
> - Tap Generate — show the PDF with the council logo, legal text, QR code for disputes

**Step 3 — Admin view (5 min)**
> "This is what your compliance manager sees on their desk." Open `Dashboard.tsx`.
> - Show today's scan count, breach rate, open alerts
> - Click a breach alert → show vehicle history, all sites visited this month
> - Click Generate Monthly Report → show the PDF report format

**Step 4 — Proof it works offline (2 min)**
> Turn on airplane mode. Scan a plate. Show the "Queued" indicator.
> Turn airplane mode off. Show the scan sync.
> "Your officers work in areas with no signal. The system works anyway."

**Step 5 — Close (1 min)**
> "Pricing is per organisation, based on officer count and zone count. We handle hosting,
> updates, and the SCV registry integration. You own your data and can export it anytime."

---

### 10.4 Pricing Model (suggested)

| Tier | Who | Included | Suggested price |
|---|---|---|---|
| **Starter** | Small council or security co, 1–5 officers, up to 10 zones | All features, email support | $400–600/month |
| **Standard** | Mid-size council, 5–15 officers, unlimited zones | All features + priority support + monthly report template | $800–1,200/month |
| **Enterprise** | Regional council or multi-district, 15+ officers, multi-org | All features + custom branding + SLA + onsite training | from $2,000/month |

**One-off setup fee**: $500–1,500 depending on complexity (zone mapping, historical data
import, officer training).

**Why this pricing works**:
- Replaces a part-time admin role ($30k+ p.a.) that was previously doing manual reporting
- Council compliance managers can justify it as operational savings, not a new cost
- Compare to ParkPow or other ALPR SaaS at $500+/month per camera — this covers an
  entire patrol team

---

### 10.5 Objections & Responses

| Objection | Response |
|---|---|
| "We already have a spreadsheet system" | "Great — we can import that history. And when the council asks for GPS coordinates and a photo for every observation in a Freedom Camping Act enforcement action, your spreadsheet won't have that." |
| "What about privacy?" | "All data is stored in New Zealand on Supabase (AWS ap-southeast-2 / Sydney). We're Privacy Act 2020 compliant — there's a built-in access log for every time a person record is viewed." |
| "What if your company closes down?" | "You can export all your data as CSV or JSON at any time. The platform is built on standard open tools (PostgreSQL, React). We can hand you the source code if required." |
| "Our officers aren't tech-savvy" | "The officer app is designed for people who've never used software before. It's one button: Scan. If the plate is in breach, the screen goes red. That's it." |
| "We don't have internet in remote areas" | "The app works offline. Scans queue on the phone and sync when connectivity returns. Officers in Fiordland and Coromandel use it today." |
| "We'd need council IT approval" | "There's nothing to install on council IT infrastructure. It's a web app and a phone app. The only IT involvement is setting up email addresses for admin users." |

---

### 10.6 Differentiators vs Competitors

| Feature | FreedomCamp Manager | Generic ALPR / ParkPow | Paper/Spreadsheet |
|---|---|---|---|
| Freedom Camping Act compliance engine | ✓ (built-in) | ✗ | ✗ |
| Offline-first mobile scanning | ✓ | ✓ (some) | N/A |
| SCV registry integration (NZSCV) | ✓ (live) | ✗ | ✗ |
| Notice to Vacate PDF generation | ✓ (1 tap) | ✗ | Manual |
| Court-ready evidence (GPS + photo + timestamp) | ✓ | Partial | ✗ |
| Homeless / welfare support workflow | ✓ | ✗ | ✗ |
| Dispute portal for recipients | ✓ | ✗ | N/A |
| Multi-council / multi-org | ✓ | Varies | N/A |
| NZ-hosted, NZ-focused | ✓ | Varies | N/A |
| No per-scan fee | ✓ (flat rate) | Often per-scan | N/A |

---

### 10.7 Council Reporting Example

Include in sales collateral: a one-page sample of the monthly council report output.

The report includes:
- Period: March 2026
- Total vehicles scanned: 847
- Compliance rate: 91.2%
- Breach alerts: 74
- Notices to Vacate issued: 31
- Infringement notices issued: 8
- Most active site: Wakatu Carpark (281 scans)
- Repeat offenders: 12 vehicles with 3+ nights this month
- Officer hours: 142 hours across 6 officers

> *"This report is automatically generated — no manual data entry required."*

---

## Appendix: Build Plan V4 — Complete Overview & Gap Analysis

This appendix answers: **"What does the clean rebuild plan actually cover?"**
It shows every area of the current build, whether V4 covers it, and what changed.

---

### A. Database: 36 Tables + 3 Storage Buckets

| Component | V4 Status |
|---|---|
| `organizations` | ✅ Keep |
| `user_profiles` | ✅ Keep (roles: officer, admin, admin_officer, master, grand_master) |
| `zones` + `zone_compliance_matrix` + `zone_legal_config` | ✅ Keep |
| `zone_signage_evidence` | ✅ Keep (legal defensibility — photo of posted signage) |
| `observations` | ✅ Keep (core fact table) |
| `breach_alerts` | ✅ Keep |
| `canonical_vehicles` | ✅ Keep (attributes only — make/model/year/colour) |
| `canonical_scv` | ✅ Keep (SCV certification — authoritative source) |
| `canonical_homeless` | ✅ Keep (replaces flagged_vehicles + homeless_records) |
| `infringement_notices` | ✅ Keep |
| `infringement_notice_counters` | ✅ Keep (atomic sequential number generation) |
| `notices_to_vacate` | ✅ Keep |
| `enforcement_cases` | ✅ Keep |
| `enforcement_case_events` | ✅ Keep (case timeline events) |
| `patrols` + `patrol_schedule_zones` | ✅ Keep |
| `patrol_checkpoints` + `checkpoint_visits` | ✅ Keep (lone-worker QR check-ins) |
| `officer_shifts` | ✅ Keep |
| `officer_welfare_settings` | ✅ Keep (per-org welfare check intervals) |
| `officer_welfare_alerts` | ✅ Keep (missed check-in alerts) |
| `officer_activity_log` | ✅ Keep (GPS heartbeat for welfare) |
| `incidents` + `incident_attachments` | ✅ Keep (incident + maintenance reports) |
| `health_safety_reports` | ✅ Keep (formal H&S reporting) |
| `audit_log` | ✅ Keep |
| `dispute_intake` | ✅ Keep |
| `person_records` | ✅ Keep |
| `person_observations` + `person_vehicle_links` + `person_interactions` | ✅ Keep (person–plate linkage) |
| `privacy_access_log` | ✅ Keep |
| `privacy_curtain_settings` | ✅ Keep (per-org privacy redaction rules) |
| `retention_policies` | ✅ Keep (data retention schedules) |
| `vehicle_monthly_stays` | ❌ Cut — compliance RPC counts from observations directly |
| `flagged_vehicles` | ❌ Merge into `canonical_homeless` |
| `homeless_records` | ❌ Merge into `canonical_homeless` |
| `vehicle_discrepancies` | ⏳ Phase 2 |
| `investigation_jobs` + `investigation_job_templates` | ⏳ Phase 2 |
| `privacy_impact_assessments` | ⏳ Phase 2 |
| `canonical_persons` | ⏳ Phase 2 |
| **Storage: `scans` bucket** | ✅ Keep (officer scan photos) |
| **Storage: `notice-artifacts` bucket** | ✅ Keep (generated PDFs) |
| **Storage: `incident-evidence` bucket** | ✅ Keep (enforcement case photos) |

---

### B. Edge Functions: 17 Keep + 52 Cut/Fold

**Keep (17):**

| # | Function | What it does |
|---|---|---|
| 1 | `process-officer-scan` | Full scan pipeline: photo → ONNX → plate → SCV → zone → compliance → breach |
| 2 | `cleanup-and-recalculate` | Nightly: zone correction, dedup, vehicle refresh, compliance recalc, SCV sync |
| 3 | `generate-notice-to-vacate` | NTV PDF generation |
| 4 | `generate-infringement` | Infringement notice PDF |
| 5 | `sync-scv-list` | Syncs NZSCV SCV registry → canonical_scv |
| 6 | `create-user` | User provisioning + invite email |
| 7 | `monitor-officer-welfare` | Welfare check-in scheduler + missed check-in alerts |
| 8 | `send-report-email` | Email delivery (consolidates generate-dashboard/leadership/vehicle reports) |
| 9 | `export-data` | CSV/JSON export of observations + reports |
| 10 | `import-data` | Historical data import (uses inference service tabular NLP) |
| 11 | `submit-dispute-intake` | Public dispute portal submission |
| 12 | `public-case-lookup` | Public notice lookup by QR code / reference |
| 13 | `hotspot-data` | Heatmap data for admin dashboard hotspots view |
| 14 | `process-homeless-data` | Homeless data import |
| 15 | `nightly-privacy-cleanup` | Privacy Act 2020 data retention cleanup |
| 16 | `manage-user` | Consolidated: set/update user passwords |
| 17 | `photo-maintenance` | Consolidated nightly: photo reconciliation, recovery, reingest |

**Phase 2 (keep code, disable UI):**
- `onspace-ai-chat` — AI admin assistant (GPT-4o chat interface)
- `process-credential-document` — AI credential document processing
- `process-investigation-document` — AI investigation document processing

**Cut (52):** All remaining functions are folded into the 17 above, are dead code, or are developer tools not needed in production. See §3.1 for full disposition.

---

### C. Infrastructure Services: 3 Services

| Service | Provider | Purpose | Phase |
|---|---|---|---|
| **Supabase** | Supabase Pro ($25/mo) | Database, Edge Functions, Auth, Storage | Phase A |
| **Inference Service** (`inference-service/`) | Fly.io ($5–10/mo) | ONNX vehicle detection + embeddings; tabular NLP for imports | Phase A.5 |
| **Proxy Server** (`proxy-server/`) | DigitalOcean ($6/mo) | Static IP for NZSCV + MotorWeb API (IP whitelist requirement) | Phase A.5 |

---

### D. AI Services: 3 Touch Points

| # | Touch Point | Tech | Phase | Required? |
|---|---|---|---|---|
| 1 | ONNX vehicle detection + embeddings | YOLOv8n + MobileNetV3 (local, no API) | Phase 1 | Yes — every photo scan |
| 2a | Vehicle attribute extraction (make/model/yr/colour) | Local inference-service attribute pipeline (`VEHICLE_ATTRS_PROVIDER=basic`) | Phase 1 (optional) | No — basic ONNX works |
| 2b | SCV sticker detection from photos | Local inference-service image pipeline | Phase 1 (optional) | No — NZSCV registry is source of truth |
| 2c | Tabular NLP for historical data import | Heuristic inference-service parser (`TABULAR_NLP_PROVIDER=heuristic`) | Phase 1 (optional) | No — heuristic works for most imports |
| 3 | Admin AI chat assistant | Inference-service `/chat` via `onspace-ai-chat` edge function | **Phase 2** | No |

All AI traffic routes through inference-service and must run in self-contained mode for production.

---

### E. User Roles: 5

| Role | Access | Who |
|---|---|---|
| `officer` | Field portal only | Patrol officers |
| `admin_officer` | Field + Admin portals (dual role) | Small-team shift supervisors |
| `admin` | Admin portal | Compliance managers |
| `master` | Admin + multi-org + Organizations page | Contract/account managers |
| `grand_master` | Platform page (all orgs + billing + onboarding) | Platform owner (Don / Iron Eagle) |

`nzscv_monitor` role (added migration 20260419000001) → **removed in clean rebuild** — replaced by `master`-level scoped access.

---

### F. Frontend Pages: 18

| Path | Page | Role |
|---|---|---|
| `/login` | Login.tsx | Public |
| `/portal-selection` | PortalSelection.tsx | Public |
| `/dispute` | PublicDisputePortal.tsx | Public |
| `/field` | FieldOfficerPortal.tsx | officer, admin_officer |
| `/dashboard` | Dashboard.tsx | admin+ |
| `/live` | LiveMap.tsx | admin+ |
| `/breaches` | Breaches.tsx | admin+ |
| `/vehicles` | Vehicles.tsx | admin+ |
| `/observations` | Observations.tsx | admin+ |
| `/zones` | Zones.tsx | admin+ |
| `/patrols` | Patrols.tsx | admin+ |
| `/enforcement` | Enforcement.tsx | admin+ |
| `/reports` | Reports.tsx | admin+ |
| `/users` | Users.tsx | admin+ |
| `/compliance` | Compliance.tsx | admin+ |
| `/organizations` | Organizations.tsx | master, grand_master |
| `/platform` | Platform.tsx | grand_master only |
| `/profile` + `/settings` | Profile.tsx, Settings.tsx | All authenticated |

**Cut (40+ pages):** TestDashboard, CleanDashboard, DataCleanupUtility, DataIntegrityDashboard, SystemDiagnostics, CleanupAndRecalculate, ComplianceRecalculation, PhotoReingest, EvidencePhotoLinker, CanonicalRecordsManager (internal tool), UniversalSearch (merge into search within pages), HotspotsMap (tab within Dashboard), SpatialComplianceAdmin (tab within Zones), PrivacyCurtain (tab within Settings), AuditLog (tab within compliance/settings), PersonRecords (tab within Vehicles), plus all legacy PHASE_*.md dev notes (already deleted from src/pages).

---

### G. Rebuild Phases

| Phase | Work | Time |
|---|---|---|
| **A** | Supabase project, single migration SQL, auth, create-user, first grand_master login | 1–2 days |
| **A.5** | Deploy inference service (Fly.io) + proxy server (DigitalOcean) | 1 day |
| **B** | process-officer-scan + FieldOfficerPortal (scan → result → history) + offline queue | 2–3 days |
| **C** | Dashboard, LiveMap, Breaches, Zones, Users, generate-notice-to-vacate, Enforcement | 2–3 days |
| **D** | Compliance, Observations, Vehicles, Patrols, Reports, export-data | 1–2 days |
| **E** | Organizations, Platform, grand_master features, create-user invite flow | 1–2 days |
| **F** | PublicDisputePortal, submit-dispute-intake, public-case-lookup | 1 day |
| **G** | nightly-privacy-cleanup, photo-maintenance, polish, demo data | 1 day |
| **Total** | Working production app | **~10–14 days** |

---

### H. What the Current Build Has That V4 Deliberately Excludes

| Feature | Current build | V4 decision |
|---|---|---|
| 9 scan pipeline edge functions | alpr-process, alpr-retry, orc-ingest, stream-webhook, plate-scanner-photo-first, select-best-vehicle-photo, link-evidence-photos, analyze-vehicle-photo, vehicle-ingest | All folded into `process-officer-scan` |
| 3 compliance recalculation functions | recalculate-compliance, -v2, -v3 | All folded into `cleanup-and-recalculate` |
| 12 nightly/batch functions | scan-breaches, duplicate-detection, zone-correction, correct-zone-assignments, check-zone-corrections, check-almost-breaches, sync-spatial-layers, enrich-from-motorweb, daily-photo-reconciler, reingest-photos, photo-recovery, scrape-vehicle-photos | All folded into `cleanup-and-recalculate` + `photo-maintenance` |
| 3 report generation functions | generate-dashboard-report, generate-leadership-pack, generate-vehicle-report | Folded into `send-report-email` |
| Developer/debug pages | TestDashboard, CleanDashboard, DataCleanupUtility, DataIntegrityDashboard, SystemDiagnostics, ComplianceRecalculation, CleanupAndRecalculate, PhotoReingest, EvidencePhotoLinker | All deleted |
| `vehicle_monthly_stays` table | Pre-aggregated stay counts cache | Deleted — RPC counts from observations |
| `flagged_vehicles` + `homeless_records` | Duplicate concepts | Merged into `canonical_homeless` |
| `nzscv_monitor` role | Read-only NZSCV monitoring role | Removed — master covers this |
| `get-weather` function | Weather data lookup | Removed — not core to enforcement |
| ParkPow integration | parkpow-sync, parkpow-photo-sync | Removed from v1 (no active deployment) |

---

## Appendix I: Full Build Sanity Check — Past, Present & V4 Coverage

This appendix is the authoritative deep-dive across every feature, function, table,
3rd-party service, and area of law that has ever existed in this codebase — matched
against what V4 covers and what it defers.

---

### I.1 Third-Party Services & External Integrations

| Service | What it does | How it connects | V4 status |
|---|---|---|---|
| **NZSCV** (nzscv.co.nz) | Self-Contained Vehicle certification registry. Confirms whether a plate holds a current SCV certificate. Rate-limited to 1 req/sec | Via `proxy-server` → `/api/nzscv/vehicle-info`. Requires static IP (DigitalOcean droplet) for whitelist. Env: `NZSCV_BASE_URL`, `NZSCV_ENDPOINT_URL` | ✅ Keep — proxied through `proxy-server`; lookup via `sync-scv-list` cron, canonical_scv is authoritative |
| **MotorWeb** (motorweb.co.nz) | NZ vehicle ownership lookup. Returns current registered owner name/address for enforcement notices. Privacy-restricted: requires `specificReason` in request | Via `proxy-server` → `/motorweb/currentOwnerCheck`. Env: `MOTORWEB_BASE_URL`, `MOTORWEB_API_KEY`, `MOTORWEB_ID_KEY` | ✅ Keep — folded into `cleanup-and-recalculate` vehicle enrichment step |
| **Bob / RunPod — Inference Service** | ONNX neural net inference: plate reading (YOLOv8n ALPR) + vehicle attribute extraction (MobileNetV3). Also: tabular NLP for CSV import date detection. Accepts photo as multipart form | `POST /infer` (photo → plate + make/model/year/colour), `POST /nlp/tabular/analyze` (CSV preview → date format). Env: `INFERENCE_SERVICE_URL`, `INFERENCE_SERVICE_AUTH_TOKEN` | ✅ Keep — core to every officer scan |
| **ParkPow** (parkpow.com) | ALPR SaaS. Was used as a secondary plate reader via `parkpow-sync` + `parkpow-photo-sync`. Detected plates in car park photos | Outbound API to ParkPow API. Env: `PARKPOW_API_KEY`, `PARKPOW_CAMERA_ID` | ❌ Removed from V4 — no active ParkPow camera deployment. Can be re-added as phase-2 optional integration |
| **Expo Push Notifications** | Push notifications to mobile devices via Expo's hosted notification infrastructure. Sends welfare alerts and breach notifications | `send-push-notification` edge fn → `https://exp.host/--/api/v2/push/send`. User's `expo_push_token` stored in `user_profiles` | ✅ Keep — folded into `monitor-officer-welfare`; simplified to alert notifications only |
| **SMTP (denomailer)** | Outbound transactional email — compliance reports, infringement notices, NTV delivery, invite emails | `denomailer@1.0.0` SMTPClient in edge functions. Env: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` (+ optional `SMTP_TOTAL_TIMEOUT_MS`) | ✅ Keep — `send-report-email`, `generate-infringement`, `generate-notice-to-vacate` all use this |
| **Supabase Auth email (inviteUserByEmail)** | Sends branded invite email when a new user is created | `create-user` calls `supabaseAdmin.auth.admin.inviteUserByEmail()`. Uses Supabase Dashboard SMTP config + `supabase/templates/invite.html` | ✅ Keep — unchanged |
| **data.govt.nz + DOC ArcGIS + LINZ** | National freedom camping zone datasets. Used to auto-import zone polygons from authoritative NZ government sources | `sync-spatial-layers` calls DOC ArcGIS FeatureServers, LINZ Crown Property API, CKAN at catalogue.data.govt.nz. Falls back to static GeoJSON mirror | ✅ Keep — folded into `cleanup-and-recalculate` spatial sync step |
| **Inference-service local AI pipeline** | (a) Vehicle attribute extraction from local models/heuristics. (b) SCV sticker detection. (c) Tabular CSV NLP heuristics. (d) Admin AI chat assistant (Phase 2) | Via `INFERENCE_SERVICE_URL` + `INFERENCE_API_KEY` and strict self-contained env flags in `inference-service/server.js` | ✅ Phase 1 optional; Phase 2 AI chat |

**Summary**: 8 external services currently integrated. V4 keeps all of them except
ParkPow (no live deployment). All connection details are in proxy-server env vars,
Supabase secrets, and Fly.io/Railway environment.

---

### I.2 Officer Welfare & H&S

**Current build — what exists:**

```
officer_welfare_settings table (per officer per org):
  - auto_logoff_enabled, auto_logoff_time (20 min inactivity)
  - welfare_check_enabled, gps_inactivity_threshold (10 min no GPS)
  - admin_escalation_time, critical_escalation_time
  - investigation_exception_enabled (pause checks during investigations)

officer_activity_log table:
  - Tracks: vehicle_scan, gps_update, investigation_start/end, login, logout

officer_welfare_alerts table:
  - alert_type: 'missed_checkin', 'welfare_check', 'sos', 'inactivity'
  - severity levels: low, medium, high, critical
  - Escalation chain: 10min → admin alert → 15min → critical + push notification

monitor-officer-welfare edge function:
  - Step 1: Check for missed scheduled check-ins
  - Step 2: Trigger check-in reminders
  - Step 3: GPS inactivity → welfare alert
  - Step 4: Escalate open alerts
  - Sends Expo push notifications for critical welfare alerts

OfficerWelfareSettings.tsx (admin config page):
  - Configure per-officer thresholds
  - View current welfare status for all officers
  - See alert history

LiveOfficerTracking.tsx / LivePatrolMonitor.tsx:
  - Live GPS map of all officers
  - Welfare status indicator on each officer pin
  - Alert banner when welfare check missed
```

**V4 disposition:**
- ✅ `officer_welfare_settings` → Keep table
- ✅ `officer_welfare_alerts` → Keep table
- ✅ `officer_activity_log` → Keep table
- ✅ `monitor-officer-welfare` edge fn → Keep (simplified: `send-push-notification` folded in)
- ✅ Welfare config UI → Keep in `Settings.tsx` admin section
- ✅ Live welfare status → Keep in `LiveMap.tsx`
- ✅ **Resolved**: `officer_welfare_settings`, `officer_welfare_alerts`, and `officer_activity_log` added to §3.2 keep list.

**Health & Safety reports** (`health_safety_reports` table):
- Exists since initial schema (2025-01-01)
- Linked to observations via `health_safety_report_id`
- Incident types: Breach of Rules, Threatening Behaviour, Property Damage, Noise Complaint, Vehicle Accident, Medical Emergency, Other
- Linked to enforcement_cases (hs_report_id FK)
- Has severity field (low, medium, high, critical)
- Currently accessible via `IncidentManagement.tsx` and `IncidentReports.tsx`
- ✅ **Resolved**: `health_safety_reports` added to §3.2 keep list.

---

### I.3 Live Monitoring

**Current build:**

```
Live GPS officer tracking:
  - officer_activity_log stores GPS coordinates per scan/activity
  - LiveOfficerTracking.tsx: real-time map, officer pins, welfare indicators
  - LivePatrolMonitor.tsx: patrol progress, zone coverage, alerts panel

hotspot-data edge function:
  - Returns observation density by zone for heatmap rendering
  - Aggregates: total_scans, breach_count, recent_activity_timestamp per zone

HotspotsMap.tsx + HeatmapVisualizer.tsx component:
  - Renders Leaflet map with colour-coded heatmap overlay
  - Zone-level density view, clickable zones → drill into observations
  - Time filter: today, week, month

observations-in-bounds edge function:
  - Returns GPS-bounded observations for map viewport queries
  - Frontend queries with bounding box
```

**V4 disposition:**
- ✅ Live map → `LiveMap.tsx` (merges `LiveOfficerTracking` + `LivePatrolMonitor`)
- ✅ `hotspot-data` edge function → Keep (§3.1 keep list ✅)
- ✅ Heatmap → Tab within `/dashboard` or `/live` page
- ✅ `observations-in-bounds` → Frontend queries Supabase directly with PostGIS (no edge fn needed)
- ✅ **Resolved**: `HeatmapVisualizer` is the map component used within `LiveMap.tsx` (noted in §I.3).

---

### I.4 Patrol Management

**Current build:**

```
patrols table:
  - status: active, completed, paused
  - zone_id, officer_id, start_time, end_time, GPS track

patrol_schedule_zones table:
  - Pre-configured zones for a patrol (which zones to cover in which order)
  - night_limit, compliance rules per zone schedule

officer_shifts table:
  - Shift start/end, GPS coords at start, assigned zones
  - Links to patrols

patrol_checkpoints table (lone-worker QR check-ins):
  - QR code per checkpoint location
  - checkpoint_visits table: officer scans QR → creates visit record
  - Used for lone-worker safety (lone officers must scan checkpoints periodically)

PatrolScheduleManagement.tsx:
  - Create/edit patrol schedules
  - Assign zones + time windows
  - Set expected zone completion order

PatrolKPIDashboard.tsx:
  - get_patrol_kpis() RPC → scans per shift, breach conversion, zone coverage %
  - Officer performance charts
  - Period filters: daily, weekly, monthly
```

**V4 disposition:**
- ✅ `patrols`, `patrol_schedule_zones`, `officer_shifts` → Keep
- ✅ `patrol_checkpoints` → Keep (lone-worker QR — marked optional)
- ✅ `checkpoint_visits` → Keep with `patrol_checkpoints`
- ✅ `get_patrol_kpis()` RPC → Keep
- ✅ `PatrolScheduleManagement` + `PatrolKPIDashboard` → Merged into `Patrols.tsx` (§8 ✅)
- ✅ **Resolved**: `checkpoint_visits` added to §3.2 keep list alongside `patrol_checkpoints`.

---

### I.5 Enforcement Escalation Ladder

The system has a **complete 6-step enforcement ladder** from first contact to prosecution.
All steps are implemented; V4 must preserve the full chain.

```
Step 1: SCAN → Observation recorded (observations table)
          ↓ (if breach detected)
Step 2: BREACH ALERT created (breach_alerts table)
          ↓ (admin reviews, selects action)
Step 3a: VERBAL WARNING → logged as enforcement_case event (action_type = 'verbal_warning')
Step 3b: WRITTEN WARNING → WarningNoticeGenerator.tsx → PDF stored in notice-artifacts
Step 3c: NOTICE TO VACATE → generate-notice-to-vacate → notices_to_vacate table + PDF
          ↓ (repeat offender / non-compliance)
Step 4: INFRINGEMENT NOTICE → generate-infringement → infringement_notices table + PDF
          - Issued under Freedom Camping Act 2011 s.20
          - All legal rights (ss.22–28 FCA 2011) included in PDF
          - Amount, due date, payment URL, objections email
          ↓ (non-payment / escalation)
Step 5: TOW REQUEST → logged as enforcement_case event (action_type = 'tow_request')
          - Shown in EnforcementTimeline.tsx
          ↓ (court action / legal)
Step 6: ENFORCEMENT CASE (enforcement_cases + enforcement_case_events tables)
          - Full audit trail of all actions
          - Links to all observations, notices, infringements
          - Assignable to admin; status: open, active, resolved, court
```

**V4 disposition:**
- ✅ `observations`, `breach_alerts`, `notices_to_vacate`, `infringement_notices`, `enforcement_cases` → All in keep list
- ✅ `generate-notice-to-vacate`, `generate-infringement` → Keep list
- ✅ Warning notices → Frontend-only (`WarningNoticeGenerator` component, no DB table needed)
- ✅ Tow requests → Logged as enforcement_case event
- ✅ `render-infringement-notice` edge fn → Fold into `generate-infringement` in clean rebuild
- ✅ **Resolved**: `enforcement_case_events` added to §3.2 keep list.
- ✅ **Resolved**: `infringement_notice_counters` added to §3.2 keep list.

---

### I.6 Incident Management

**Current build:**

```
incidents table (initial schema):
  - incident_type TEXT (free text — see types below)
  - description, severity, status
  - linked to organization + zone + reported_by

incident_attachments table:
  - Evidence photos attached to an incident

health_safety_reports table (see §I.2):
  - Separate from incidents — used for formal H&S reporting

IncidentManagement.tsx page:
  - Create new incidents (admin + officer) via IncidentCreationForm dialog
  - Type filter: Incidents / Maintenance / Noise / H&S
  - Incident types: Breach of Rules, Threatening Behaviour, Property Damage,
    Noise Complaint, Vehicle Accident, Medical Emergency, Maintenance Report, Other
  - Status tracking: open → investigating → resolved
  - Status update actions wired up (Investigate / Mark Resolved buttons)

IncidentReports.tsx page:
  - View all incidents with filter by type/severity/date
  - Link incidents to enforcement cases
  - Export to PDF

investigation_jobs table + investigation_job_templates:
  - Templated investigation tasks assigned to officers
  - Templates include: noise_complaint, health_safety, vehicle_check, patrol
  - Assignable, prioritized, with instructions and briefing notes
  - InvestigationJobsPage.tsx
```

**V4 disposition:**
- ✅ `incidents` → Keep (V4 §3.2 keep list mentions "Merge incident_reports into enforcement_cases" — clarify: standalone `incidents` for field logs, `enforcement_cases` for formal case management. Keep both)
- ✅ `incident_attachments` → Keep alongside `incidents`
- ✅ `health_safety_reports` → Keep (see §I.2)
- ⏳ `investigation_jobs` → Phase 2 (V4 §3.2 ✅)
- ✅ **Resolved**: `incidents` + `incident_attachments` added to §3.2 keep list.

---

### I.7 People Recording & Person Records

**Current build:**

```
person_records table (initial schema):
  - id, organization_id, first_name, last_name, date_of_birth
  - is_of_interest (flag for persons of concern)
  - notes

person_observations table (links person to observation):
  - person_id → person_records.id
  - observation_id → observations.id

person_vehicle_links table:
  - Links known persons to plate numbers
  - Used for repeat offender tracking (person + plate history)

person_interactions table:
  - Formal interaction records (welfare referral, warning given, etc.)

canonical_persons table:
  - Cross-org canonical person record (similar to canonical_vehicles)
  - Plate → person link at platform level

PersonRecords.tsx page:
  - Create/search/view persons of interest
  - Link to plates, view observation history
  - Add notes, set is_of_interest flag

usePersonRecords.ts hook:
  - Data management for person records
```

**V4 disposition:**
- ✅ `person_records` → Keep (§3.2 ✅)
- ✅ `PersonRecords.tsx` → Tab within `Vehicles.tsx` or standalone (§8 V4 mentions "PersonRecords as tab within Vehicles")
- ✅ **Resolved**: `person_observations`, `person_vehicle_links`, `person_interactions` added to §3.2 keep list.
- ✅ **Resolved**: `canonical_persons` → Phase 2 (added to §3.2 cut list).

---

### I.8 Noise Control Management

**Current status in codebase:**

The system has **partial noise control support** — it recognises noise as an incident
type and an authorized officer activity, but does not have dedicated noise enforcement
workflow tools.

**What exists today:**
- `Noise Complaint` as an incident type in `IncidentCreationForm.tsx` and `ScanDetailPanel.tsx`
- `noise_control` as an `authorized_activities` value in `user_profiles` (from `process-credential-document`)
- `noise_control` as a `job_type` in `investigation_job_templates` (migration 20250212000002)
- `Noise Control Officer` as a recognised NZ warrant type in `process-credential-document`
- Officers can have `noise_control` in their `warrant_acts` (Resource Management Act 1991 s.38)

**Relevant NZ law references in codebase:**
- Freedom Camping Act 2011 (FCA) — primary act for most enforcement
- Local Government Act 2002 (bylaw authority)
- Summary Proceedings Act 1957 (court proceedings)
- Resource Management Act 1991 s.38 — Noise Control Officers
- Privacy Act 2020 — data handling (explicitly coded: privacy_access_log, privacy_curtain_settings)
- Freedom Camping (Penalties for Infringement Offences) Regulations 2023

**What's missing for full noise control support:**

| Gap | Description | V4 recommendation |
|---|---|---|
| No noise control notice PDF | There is no `generate-noise-notice` function — officers can only log a noise complaint as an incident, not issue a formal noise abatement direction | **Phase 2**: Add `generate-noise-notice` edge fn under RMA s.38 |
| No noise log workflow | No dedicated noise complaint workflow (arrive → measure → warn → abate). Officers use the generic incident form | **Phase 2**: Add `noise_complaints` table or extend `incidents` with `noise_level_db`, `time_of_night`, `abatement_direction_issued` |
| Noise officer credential flow exists | `process-credential-document` correctly identifies Noise Control Officer warrants and sets `authorized_activities = ['noise_control', 'resource_management']` | ✅ Exists — works already for credentialing |
| No noise zone overlay | Zones have bylaw authority but no specific noise boundary config | **Phase 2**: Add `noise_zones` geometry overlay (separate from freedom camping zones) |

**V4 disposition:**
- ✅ Noise complaint as incident type → Keep (no code change needed)
- ✅ Noise Control Officer credential processing → Keep (process-credential-document, Phase 2)
- ⏳ Formal noise enforcement notices + noise complaint workflow → Phase 2

---

### I.9 Credential & Warrant Management

**Current build:**

```
user_profiles table additions (migration 20260215000003):
  - authorized_activities JSONB (e.g. ['freedom_camping', 'noise_control', 'trespass'])
  - warrant_acts TEXT[] (e.g. ['Freedom Camping Act 2011', 'Resource Management Act 1991 s.38'])
  - credentials_verified BOOLEAN
  - credentials_verified_at, credentials_verified_by

organizations table addition:
  - requires_warrant_for_enforcement BOOLEAN (default true)

process-credential-document edge function:
  - AI-powered OCR and analysis of COA cards (Certificate of Authorisation)
    and Warrant of Authority documents
  - Supports: Nelson City Council, Generic NZ Council formats
  - Extracts: name, org, expiry, authorized_activities, warrant_type
  - Sets user_profiles.credentials_verified on success

ComplianceCredentialsUpload.tsx component:
  - Upload/drag-drop COA card or warrant document
  - Calls process-credential-document → fills in authorized activities
  - Used in user management / profile setup
```

**V4 disposition:**
- ✅ Credential columns on `user_profiles` → Keep
- ✅ `ComplianceCredentialsUpload.tsx` → Visible in `Users.tsx` admin section
- ⏳ `process-credential-document` → Phase 2 edge fn (AI document processing)
- 🟡 **Note for V4**: This feature has no DB table of its own — credentials are stored as columns on `user_profiles`. That is correct; no new table needed.

---

### I.10 Privacy, Audit & Legal Compliance

**Current build — Privacy Act 2020 compliance:**

```
privacy_curtain_settings table:
  - Per-org: data_retention_days, photo_retention_days
  - auto_blur_photos BOOLEAN, redact_personal_info BOOLEAN

privacy_access_log table:
  - Records every time a user views a person record or sensitive observation
  - Who, when, what they viewed, justification required

privacy_impact_assessments table:
  - Formal Privacy Impact Assessments for new data collections
  - Signoff workflow

retention_policies table:
  - Per-org: observation_retention, photo_retention, audit_log_retention
  - Used by nightly-privacy-cleanup edge function

nightly-privacy-cleanup edge function:
  - Applies retention policies: deletes aged observations/photos/audit entries
  - Anonymises data past retention window

PrivacyCurtain.tsx page:
  - Admin UI for configuring privacy settings
  - View privacy access log
  - Review/sign PIAs

audit_log table:
  - Immutable log of all admin actions
  - AuditLog.tsx / AuditLogViewer.tsx component
```

**V4 disposition:**
- ✅ `audit_log`, `privacy_access_log`, `privacy_curtain_settings` → Keep
- ✅ `retention_policies` → Keep (drives `nightly-privacy-cleanup`)
- ✅ `nightly-privacy-cleanup` → Keep (§5 keep list ✅)
- ✅ **Resolved**: `privacy_impact_assessments` → Phase 2 (added to §3.2 cut list).
- ✅ **Resolved**: `PrivacyCurtain.tsx` → merge as tab in `Settings.tsx` (added to §3.1 merge list).

---

### I.11 Dispute & Public Portal

**Current build:**

```
dispute_intake table:
  - Plate, reference number, full name, contact email, reason, evidence URL
  - status: pending, under_review, resolved, rejected
  - homeless_status field (for homelessness-related disputes)
  - Links to infringement_notices and notices_to_vacate

submit-dispute-intake edge function:
  - Public-facing: no auth required
  - Validates input, creates dispute_intake row
  - Sends confirmation email to submitter

public-case-lookup edge function:
  - Looks up a notice/infringement by reference number
  - Returns status + council contact details (no PII)

PublicDisputePortal.tsx:
  - Accessible at /dispute without login
  - Enter reference number → see case details → submit dispute
  - QR code on Notice to Vacate links here

zone_legal_config table:
  - payment_url, objections_email, payment_deadline_days per zone
  - bylaw_clause, bylaw_source_url per zone
```

**V4 disposition:**
- ✅ All dispute tables + functions → V4 §8 keep list ✅
- ✅ `zone_legal_config` → Keep ✅
- ✅ `PublicDisputePortal.tsx` → `/dispute` route ✅

---

### I.12 Reporting & Analytics

**Current build report types:**

| Report | Edge function | Output |
|---|---|---|
| Compliance report | `send-report-email` (report_type='compliance') | HTML email + inline data |
| Enforcement report | `send-report-email` (report_type='enforcement') | HTML email |
| Vehicle activity report | `generate-vehicle-report` | HTML email / PDF |
| Zone statistics report | `send-report-email` (report_type='zone-stats') | HTML email |
| Leadership pack (council) | `generate-leadership-pack` | Multi-page HTML pack |
| Dashboard snapshot | `generate-dashboard-report` | HTML email |
| Observations CSV export | `observations-export` | CSV download |
| Infringement notice PDF | `generate-infringement` | PDF stored in notice-artifacts bucket |
| Notice to Vacate PDF | `generate-notice-to-vacate` | PDF stored in notice-artifacts bucket |
| Incident report PDF | `generate-incident-pdf` | PDF (folded into notices in V4) |

**V4 disposition:**
- ✅ All report generation consolidated into `send-report-email` + `generate-notice-to-vacate` + `generate-infringement`
- ✅ `export-data` → replaces `observations-export`
- ✅ `Reports.tsx` → single page for all report generation and download

---

### I.13 Zone Geofencing & Signage

**Current build:**

```
zones table with geometry (PostGIS):
  - Polygon, MultiPolygon, or Point+radius_meters
  - zone_type: freedom_camping | general | other
  - bylaw_clause, bylaw_source_url (added migration 20260422)
  - parent_zone_id (child zone hierarchy)
  - nightly_limit, stays_per_month, max_consecutive_nights

zone_signage_evidence table:
  - Photos of physical signage at zone boundaries
  - Required for court-ready evidence package
  - Captured by officers in the field

ZoneGeofenceEditor.tsx:
  - Draw/edit zone polygons on a Leaflet map
  - Set compliance rules, nightly limits
  - Configure legal config (payment URLs, objections)

SpatialComplianceAdmin.tsx:
  - Admin view of all zones with compliance status
  - Spatial query tools for zone assignment correction
```

**V4 disposition:**
- ✅ `zones`, `zone_compliance_matrix`, `zone_legal_config` → Keep ✅
- ✅ `ZoneGeofenceEditor` → Part of `Zones.tsx`
- ✅ **Resolved**: `zone_signage_evidence` added to §3.2 keep list.
- ✅ **Resolved**: `SpatialComplianceAdmin.tsx` → merge as tab in `Zones.tsx` (added to §3.1 merge list).

---

### I.14 Comprehensive Table Status Audit

All tables that have ever been created, with V4 disposition:

| Table | First created | V4 keep list | Disposition |
|---|---|---|---|
| `organizations` | 2025-01-01 | ✅ §3.2 | Keep |
| `user_profiles` | 2025-01-01 | ✅ §3.2 | Keep |
| `zones` | 2025-01-01 | ✅ §3.2 | Keep |
| `zone_compliance_matrix` | 2025-01-01 | ✅ §3.2 | Keep |
| `zone_legal_config` | 2026-02-18 | ✅ §3.2 | Keep |
| `observations` | 2026-02-21 (rebuilt) | ✅ §3.2 | Keep |
| `breach_alerts` | 2026-02-18 (rebuilt) | ✅ §3.2 | Keep |
| `canonical_vehicles` | 2025-02-03 (rebuilt) | ✅ §3.2 | Keep |
| `canonical_scv` | 2026-04-21 | ✅ §3.2 | Keep |
| `canonical_homeless` | 2026-04-21 | ✅ §3.2 | Keep |
| `infringement_notices` | 2026-02-19 | ✅ §3.2 | Keep |
| `infringement_notice_counters` | 2026-03-17 | ❌ Missing | **Add to keep list** |
| `notices_to_vacate` | 2026-02-02 | ✅ §3.2 | Keep |
| `patrols` | 2025-01-01 | ✅ §3.2 | Keep |
| `patrol_schedule_zones` | 2026-04-09 | ✅ §3.2 | Keep |
| `officer_shifts` | 2026-04-09 | ✅ §3.2 | Keep |
| `patrol_checkpoints` | 2026-03-02 | ✅ §3.2 optional | Keep |
| `checkpoint_visits` | 2026-03-02 | ❌ Missing | **Add with patrol_checkpoints** |
| `officer_welfare_settings` | 2025-02-01 | ❌ Missing | **Add to keep list** |
| `officer_welfare_alerts` | 2025-02-01 | ❌ Missing | **Add to keep list** |
| `officer_activity_log` | 2025-02-01 | ❌ Missing | **Add to keep list** |
| `audit_log` | 2025-01-01 | ✅ §3.2 | Keep |
| `dispute_intake` | 2026-04-18 | ✅ §3.2 | Keep |
| `person_records` | 2025-01-01 | ✅ §3.2 | Keep |
| `person_observations` | 2025-01-01 | ❌ Missing | **Add to keep list** |
| `person_vehicle_links` | 2025-01-01 | ❌ Missing | **Add to keep list** |
| `person_interactions` | 2026-03-02 | ❌ Missing | **Add to keep list** |
| `enforcement_cases` | 2026-02-20 | ✅ §3.2 | Keep |
| `enforcement_case_events` | 2026-02-20 | ❌ Missing | **Add alongside enforcement_cases** |
| `enforcement_actions` | 2025-01-01 | ❌ Duplicate of enforcement_case_events | Cut — superseded |
| `privacy_access_log` | 2026-03-02 | ✅ §3.2 | Keep |
| `privacy_curtain_settings` | 2026-03-02 | ❌ Missing | **Add to keep list** |
| `retention_policies` | 2026-03-02 | ❌ Missing | **Add to keep list** |
| `incidents` | 2025-01-01 | ❌ Missing | **Add to keep list** |
| `incident_attachments` | 2026-02-24 | ❌ Missing | **Add with incidents** |
| `health_safety_reports` | 2025-01-01 | ❌ Missing | **Add to keep list** |
| `zone_signage_evidence` | 2026-02-25 | ❌ Missing | **Add to keep list** |
| `flagged_vehicles` | 2025-01-01 | ✅ §3.2 | Merge into canonical_homeless |
| `homeless_records` | 2025-01-01 | ✅ §3.2 | Merge into canonical_homeless |
| `vehicle_monthly_stays` | 2025-02-03 | ✅ §3.2 appendix | Cut |
| `compliance_results` | 2025-01-01 | ✅ §3.2 | Cut (replaced by columns on observations) |
| `vehicle_discrepancies` | 2026-04-06 | ✅ §3.2 | Phase 2 |
| `investigation_jobs` | 2025-01-01 | ✅ §3.2 | Phase 2 |
| `vehicle_records` | 2025-01-01 | ❌ | Cut — replaced by canonical_vehicles |
| `vehicle_observations` | 2025-01-01 | ❌ | Cut — replaced by observations |
| `plate_scans` | 2025-01-01 | ❌ | Cut — replaced by observations |
| `photo_metadata` | 2025-01-01 | ❌ | Cut — merged into observations.photo_url |
| `drift_events` | 2025-01-01 | ❌ | Cut — not used in current pipeline |
| `nzscv_cache` | 2026-03-15 | ❌ | Cut — canonical_scv is the cache |
| `scan_idempotency_keys` | 2026-03-15 | ❌ | Cut — idempotency handled in observations.idempotency_key |
| `canonical_persons` | 2026-02-25 | ❌ | Phase 2 |
| `privacy_impact_assessments` | 2026-03-02 | ❌ | Phase 2 |
| `session_mode_switch_log` | 2026-03-15 | ❌ | Phase 2 |
| `boundary_review_queue` | 2026-02-25 | ❌ | Cut — admin internal tool |
| `notice_templates` | 2026-02-25 | ❌ | Phase 2 — template customisation |
| `legacy_evidence_reviews` | 2026-01-27 | ❌ | Cut — legacy migration artifact |
| `alert_acknowledgements` | 2026-02-15 | ❌ | Cut — merged into breach_alerts.status |
| `alert_queue` | 2026-02-15 | ❌ | Cut — replaced by breach_alerts |
| `access_requests` | 2026-02-15 | ❌ | Cut — not used |
| `missing_photo_queue` | 2026-03-23 | ❌ | Cut — internal recovery tool |
| `photo_recovery_audit_log` | 2026-03-23 | ❌ | Cut — internal recovery tool |
| `observation_deletions` | 2026-02-18 | ❌ | Cut — soft-delete tracking (use audit_log) |

---

### I.15 Updated V4 Table Count

With all gaps filled, the clean rebuild schema is:

**Core tables: 32** (not 20 — the original count was conservative)

| # | Table | Category |
|---|---|---|
| 1 | organizations | Foundation |
| 2 | user_profiles | Foundation |
| 3 | zones | Zones |
| 4 | zone_compliance_matrix | Zones |
| 5 | zone_legal_config | Zones |
| 6 | zone_signage_evidence | Zones |
| 7 | observations | Scan pipeline |
| 8 | breach_alerts | Enforcement |
| 9 | canonical_vehicles | Vehicles |
| 10 | canonical_scv | Vehicles |
| 11 | canonical_homeless | Vehicles |
| 12 | infringement_notices | Enforcement |
| 13 | infringement_notice_counters | Enforcement |
| 14 | notices_to_vacate | Enforcement |
| 15 | enforcement_cases | Enforcement |
| 16 | enforcement_case_events | Enforcement |
| 17 | patrols | Patrol |
| 18 | patrol_schedule_zones | Patrol |
| 19 | officer_shifts | Patrol |
| 20 | patrol_checkpoints | Patrol (optional) |
| 21 | checkpoint_visits | Patrol (optional) |
| 22 | officer_welfare_settings | Welfare |
| 23 | officer_welfare_alerts | Welfare |
| 24 | officer_activity_log | Welfare |
| 25 | incidents | Incidents |
| 26 | incident_attachments | Incidents |
| 27 | health_safety_reports | H&S |
| 28 | person_records | People |
| 29 | person_observations | People |
| 30 | person_vehicle_links | People |
| 31 | person_interactions | People |
| 32 | dispute_intake | Disputes |
| 33 | privacy_access_log | Privacy |
| 34 | privacy_curtain_settings | Privacy |
| 35 | retention_policies | Privacy |
| 36 | audit_log | Audit |

**Phase 2 tables:** canonical_persons, vehicle_discrepancies, investigation_jobs, privacy_impact_assessments, session_mode_switch_log, notice_templates

The original "20 table" target was aspirational and excluded operational tables
(welfare, incidents, H&S, people, enforcement events). The real clean-rebuild core
is ~36 tables. This is still a dramatic reduction from the current ~60+ tables.

---

### I.16 Feature Coverage Summary

| Feature area | In current build | V4 Phase 1 | V4 Phase 2 |
|---|---|---|---|
| Officer scanning (ALPR) | ✅ full | ✅ | — |
| SCV registry lookup (NZSCV) | ✅ full | ✅ | — |
| MotorWeb vehicle enrichment | ✅ full | ✅ | — |
| Geofencing (GPS zone detection) | ✅ full | ✅ | — |
| Offline queue (IndexedDB) | ✅ full | ✅ | — |
| Breach detection + alerts | ✅ full | ✅ | — |
| Notice to Vacate PDF | ✅ full | ✅ | — |
| Infringement notice PDF | ✅ full | ✅ | — |
| Warning notices (written/verbal) | ✅ full | ✅ | — |
| Tow request logging | ✅ partial | ✅ | — |
| Enforcement case management | ✅ full | ✅ | — |
| Compliance escalation ladder | ✅ full | ✅ | — |
| Officer welfare + lone worker QR | ✅ full | ✅ | — |
| Live GPS officer map | ✅ full | ✅ | — |
| Heatmap / hotspot analysis | ✅ full | ✅ | — |
| Patrol schedule + KPIs | ✅ full | ✅ | — |
| Incident management (H&S, noise, etc.) | ✅ full | ✅ | — |
| **Maintenance reports** | ✅ full (incidents table, type filter, admin creation) | ✅ | — |
| Health & Safety reports | ✅ full | ✅ | — |
| People recording (person of interest) | ✅ full | ✅ | — |
| Person-vehicle linking | ✅ full | ✅ | — |
| Dispute portal (public) | ✅ full | ✅ | — |
| Homeless register + welfare referral | ✅ full | ✅ | — |
| Privacy Act 2020 compliance tools | ✅ full | ✅ | — |
| Credential / warrant management | ✅ full | ✅ (UI) | ✅ (AI doc processing) |
| Multi-org + grand master | ✅ full | ✅ | — |
| Council compliance reporting | ✅ full | ✅ | — |
| Leadership pack / monthly report | ✅ full | ✅ | — |
| Spatial layer import (DOC/LINZ/data.govt.nz) | ✅ full | ✅ | — |
| Zone signage evidence capture | ✅ partial | ✅ | — |
| **Noise control enforcement workflow** | ⚠️ partial (incident only) | ❌ | ✅ Phase 2 |
| **Noise abatement direction PDF** | ❌ not built | ❌ | ✅ Phase 2 |
| **Noise zone overlay** | ❌ not built | ❌ | ✅ Phase 2 |
| Push notifications (Expo) | ✅ full | ✅ | — |
| Email notifications | ✅ full | ✅ | — |
| AI vehicle photo analysis | ✅ full | ✅ optional | — |
| AI admin chat assistant | ⚠️ edge fn exists, no UI | ❌ | ✅ Phase 2 |
| Investigation jobs | ✅ partial | ❌ | ✅ Phase 2 |
| ParkPow ALPR integration | ⚠️ code exists, not deployed | ❌ | ✅ Phase 2 optional |

---

*End of CLEAN_REBUILD_DESIGN.md*
