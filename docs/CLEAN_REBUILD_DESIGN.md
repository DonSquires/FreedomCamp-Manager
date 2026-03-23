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
| Dead edge functions | `recalculate-compliance`, `recalculate-compliance-v2`, `alpr-retry`, `check-railway-health` | Deployed but never called |
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

The app has one core job: **field officers scan plates → admins review breaches →
councils enforce freedom camping rules**. Everything else is supporting infrastructure.

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

5. **Schema tells a story.** A new developer should be able to read the 20 core tables
   and understand the entire system in an afternoon. Not 40+ tables with 200 migrations.

6. **Build for the sales pitch.** Every feature visible to a client demo should be
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
| `check-railway-health` | Dev/diagnostic tool — remove from production |
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
| `onspace-ai-chat` | **Phase 2** — AI admin chat assistant. Uses `OPENAI_BASE_URL` (any OpenAI-compatible provider). Keep the edge function; disable in UI until Phase 2 |
| `process-credential-document` + `process-investigation-document` | **Phase 2** — AI document processing. Keep the edge functions; wire up in v2 |

---

### 3.2 Database Tables: Keep 20, Cut 20+

#### Keep (core, actively used)

| Table | Purpose |
|---|---|
| `organizations` | Multi-tenancy anchor |
| `user_profiles` | User records with role |
| `zones` | Geofenced compliance areas |
| `zone_compliance_matrix` | Versioned compliance rules per zone |
| `zone_legal_config` | Payment, objections, and dispute portal per zone |
| `observations` | Core fact table — every plate scan |
| `breach_alerts` | Unresolved compliance breaches |
| `canonical_vehicles` | Vehicle attributes (make/model/year/colour) |
| `canonical_scv` | SCV certification per plate |
| `canonical_homeless` | Homeless status per plate |
| `infringement_notices` | Issued infringement notices |
| `notices_to_vacate` | Issued NTV documents |
| `patrols` | Patrol sessions |
| `patrol_schedule_zones` | Zones assigned to a patrol |
| `officer_shifts` | Shift start/end records |
| `audit_log` | Immutable action log |
| `dispute_intake` | Public dispute submissions |
| `person_records` | Known individuals linked to plates |
| `enforcement_cases` | Case management for repeat offenders |
| `privacy_access_log` | Privacy Act 2020 PII access log |

#### Cut or Merge

| Table | Disposition |
|---|---|
| `flagged_vehicles` | **Merge into `canonical_homeless`** — it's the same concept. Use `canonical_homeless.status = 'flagged'` |
| `homeless_records` | **Merge into `canonical_homeless`** — duplicates the concept |
| `vehicle_discrepancies` | Useful but niche — keep as opt-in phase-2 feature. Remove from initial clean build |
| `investigation_jobs` | Rarely used — phase-2 only |
| `incident_reports` (if separate) | Merge into `enforcement_cases` |
| `patrol_checkpoints` | Keep only if using lone-worker QR scan. Otherwise cut |
| `compliance_results` (if still exists) | Was replaced by columns on `observations` |
| `photo_records` (if separate) | Merge into `observations.photo_url` |
| `vehicle_monthly_stays` | **Cut** — was a pre-aggregated cache of monthly stay counts per vehicle per zone. The compliance RPC now counts directly from `observations` using a rolling window. Removing this table eliminates a maintenance burden. |
| PHASE_*.md files in src/pages | Not DB tables but dead files — delete |

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

---

## 4. Clean Schema (20 tables, not 40+)

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
        2. Send photo to Railway inference service (ALPR + vehicle attributes)
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
| `VEHICLE_ATTRS_PROVIDER=openai` path | Optional/keep | Useful when ONNX model quality is insufficient for make/model |
| `TABULAR_NLP_PROVIDER=openai/ollama` path | Optional/keep | Useful for complex historical imports with dirty data |
| Vehicle attribute extraction (make/model/year/colour via ONNX) | Keep | Supplements canonical_vehicles data |

**Environment variables it needs:**

```env
# Required
PORT=3000
INFERENCE_API_KEY=<random-secret>           # How edge functions authenticate
SUPABASE_URL=https://xxx.supabase.co        # For JWT verification (alternative auth)
ALLOWED_ORIGINS=https://xxx.supabase.co     # CORS restriction

# Optional (vehicle attribute enrichment via AI)
VEHICLE_ATTRS_PROVIDER=basic                # basic | openai | ollama
OPENAI_API_KEY=<key>                        # If using openai provider
OPENAI_MODEL=gpt-4o-mini

# Optional (tabular NLP)
TABULAR_NLP_PROVIDER=heuristic             # heuristic | openai | ollama
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
| Remove `VEHICLE_ATTRS_PROVIDER=ollama` support (keep basic + openai) | Ollama requires a local GPU server — too complex for hosted deployment |
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

The system has **three AI touch points**. All three use the same `OPENAI_BASE_URL` env var
pattern — you can point any of them at OpenAI, Azure OpenAI, a local Ollama server, or
any other OpenAI-compatible API without code changes.

```
┌─────────────────────────────────────────────────────────┐
│  AI Touch Point 1: ONNX Inference (inference-service)   │
│  Vehicle detection (YOLOv8n) + embeddings (MobileNetV3) │
│  Runs 100% locally — no external API call               │
│  Required: every officer scan that includes a photo     │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  AI Touch Point 2: OpenAI Vision (via inference-service │
│  or directly from edge functions)                       │
│                                                         │
│  a) Vehicle attribute extraction (make/model/yr/colour) │
│     VEHICLE_ATTRS_PROVIDER=openai in inference-service  │
│     Fallback when ONNX attribute quality is low         │
│                                                         │
│  b) SCV sticker detection (analyze-vehicle-photo)       │
│     GPT-4o vision — detects blue/green SCV stickers     │
│     Folded into process-officer-scan in clean rebuild   │
│                                                         │
│  c) Tabular NLP (inference-service /nlp/tabular/analyze)│
│     Detects date formats and data quality in CSV imports│
│     Used by import-data / DataImport.tsx wizard         │
│     TABULAR_NLP_PROVIDER=openai (or heuristic, default) │
│                                                         │
│  Optional: only needed if you want AI-enhanced vehicle  │
│  attribute accuracy or import date-format detection     │
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

**Environment variables for AI (all optional in Phase 1):**

```env
# Supabase Edge Function secrets
OPENAI_API_KEY=<your-key>                    # Required for Touch Points 2b, 3
OPENAI_BASE_URL=https://api.openai.com/v1    # Override for Azure / local Ollama / etc.
OPENAI_MODEL=gpt-4o                          # Model for vision analysis

# inference-service env vars (on Fly.io / Railway)
VEHICLE_ATTRS_PROVIDER=basic                 # basic | openai (Touch Point 2a)
TABULAR_NLP_PROVIDER=heuristic              # heuristic | openai (Touch Point 2c)
OPENAI_API_KEY=<your-key>                    # Same key, set as Fly.io secret
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini                     # Cheaper model for attribute extraction
```

**Phase 1 minimum (no OpenAI key needed):**
- ONNX-only inference for vehicle detection and embeddings
- Heuristic tabular NLP (no API call)
- SCV sticker detection disabled (NZSCV registry is the source of truth anyway)

**Phase 2 upgrade (requires OpenAI key):**
- GPT-4o vision for vehicle attribute accuracy
- AI-assisted tabular import for messy CSV data
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
- **Keyboard shortcuts** for power users (acknowledge alert: A, assign: S, dismiss: D)
- **No developer tools** — no cleanup utility, no recalculation triggers, no diagnostic pages

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

### Pages (18 total)

```
Public (no auth)
├── /login                 Login.tsx
├── /portal-selection      PortalSelection.tsx
└── /dispute               PublicDisputePortal.tsx

Field Officer (officer, admin_officer)
└── /field                 FieldOfficerPortal.tsx
      ├── view: scan        Full-screen camera + result
      ├── view: history     Last 24h scans
      └── view: shift       Start/end patrol, welfare check

Admin (admin, admin_officer, master)
├── /dashboard             Dashboard.tsx       ← today's KPIs
├── /live                  LiveMap.tsx         ← officer locations + zones
├── /breaches              Breaches.tsx        ← alerts tab + notices tab
├── /vehicles              Vehicles.tsx        ← search + detail
├── /observations          Observations.tsx    ← searchable history
├── /zones                 Zones.tsx           ← map + compliance rules
├── /patrols               Patrols.tsx         ← schedule + KPIs
├── /enforcement           Enforcement.tsx     ← cases + infringement notices
├── /reports               Reports.tsx         ← generate + export
├── /users                 Users.tsx
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
2. Implement `Breaches.tsx` (alert queue with inline actions)
3. Implement `LiveMap.tsx` (officer positions + zone polygons)
4. Implement `Zones.tsx` (zone CRUD + compliance rules)
5. Deploy `generate-notice-to-vacate` + `generate-infringement`
6. Implement `Enforcement.tsx` (NTV + infringement notice generation)

**Done**: An admin can manage their full daily workflow.

---

### Phase D — Reports & Analytics (1–2 days)

1. Implement `Compliance.tsx` (breakdown by zone, chart over time)
2. Implement `Reports.tsx` (date range → generate → email or download)
3. Implement `Vehicles.tsx` (search by plate, show history)
4. Implement `Patrols.tsx` (schedule + KPI dashboard)

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

### A. Database: 20 Tables + 3 Storage Buckets

| Component | V4 Status |
|---|---|
| `organizations` | ✅ Keep |
| `user_profiles` | ✅ Keep (roles: officer, admin, admin_officer, master, grand_master) |
| `zones` + `zone_compliance_matrix` + `zone_legal_config` | ✅ Keep |
| `observations` | ✅ Keep (core fact table) |
| `breach_alerts` | ✅ Keep |
| `canonical_vehicles` | ✅ Keep (attributes only — make/model/year/colour) |
| `canonical_scv` | ✅ Keep (SCV certification — authoritative source) |
| `canonical_homeless` | ✅ Keep (replaces flagged_vehicles + homeless_records) |
| `infringement_notices` | ✅ Keep |
| `notices_to_vacate` | ✅ Keep |
| `patrols` + `patrol_schedule_zones` | ✅ Keep |
| `officer_shifts` | ✅ Keep |
| `audit_log` | ✅ Keep |
| `dispute_intake` | ✅ Keep |
| `person_records` | ✅ Keep |
| `enforcement_cases` | ✅ Keep |
| `privacy_access_log` | ✅ Keep |
| `patrol_checkpoints` | ✅ Keep (optional, for lone-worker QR check-ins) |
| `vehicle_monthly_stays` | ❌ Cut — compliance RPC counts from observations directly |
| `flagged_vehicles` | ❌ Merge into `canonical_homeless` |
| `homeless_records` | ❌ Merge into `canonical_homeless` |
| `vehicle_discrepancies` | ⏳ Phase 2 |
| `investigation_jobs` | ⏳ Phase 2 |
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
| 2a | Vehicle attribute extraction (make/model/yr/colour) | OpenAI vision via inference-service (`VEHICLE_ATTRS_PROVIDER=openai`) | Phase 1 (optional) | No — basic ONNX works |
| 2b | SCV sticker detection from photos | OpenAI GPT-4o vision (folded into process-officer-scan) | Phase 1 (optional) | No — NZSCV registry is source of truth |
| 2c | Tabular NLP for historical data import | OpenAI or heuristic via inference-service (`TABULAR_NLP_PROVIDER`) | Phase 1 (optional) | No — heuristic works for most imports |
| 3 | Admin AI chat assistant | OpenAI-compatible chat via `onspace-ai-chat` edge function | **Phase 2** | No |

All AI providers use `OPENAI_BASE_URL` — you can swap in Azure OpenAI, local Ollama, or any OpenAI-compatible service without code changes.

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

**Cut (40+ pages):** TestDashboard, CleanDashboard, DataCleanupUtility, DataIntegrityDashboard, SystemDiagnostics, CleanupAndRecalculate, ComplianceRecalculation, PhotoReingest, EvidencePhotoLinker, CanonicalRecordsManager (internal tool), UniversalSearch (merge into search within pages), HotspotsMap (tab within Dashboard), SpatialComplianceAdmin (tab within Zones), AuditLog (tab within compliance/settings), PersonRecords (tab within Vehicles), plus all PHASE_*.md dev notes.

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

*End of CLEAN_REBUILD_DESIGN.md*
