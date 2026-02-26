# FreedomCamp Manager — Complete Build Plan

> **Purpose**: This document is the single source of truth for OnSpace AI to rebuild
> FreedomCamp Manager from scratch. It captures every architectural decision, database
> table, Edge Function, frontend page, external integration, and deployment step.
>
> **Railway services** (inference-service and proxy-server) are **already deployed and
> operational**. This rebuild focuses on the Supabase backend and the React SPA frontend
> that connect to them.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Tech Stack](#2-tech-stack)
3. [Repository Layout](#3-repository-layout)
4. [Environment Configuration](#4-environment-configuration)
5. [Database Schema](#5-database-schema)
6. [Row-Level Security & Auth Model](#6-row-level-security--auth-model)
7. [Supabase Edge Functions](#7-supabase-edge-functions)
8. [Frontend Architecture](#8-frontend-architecture)
9. [Railway Services (Already Built)](#9-railway-services-already-built)
10. [External Integrations](#10-external-integrations)
11. [Feature Flags & Phased Rollout](#11-feature-flags--phased-rollout)
12. [Build & Deployment](#12-build--deployment)
13. [Step-by-Step Rebuild Instructions](#13-step-by-step-rebuild-instructions)
14. [Learnings & Pitfalls](#14-learnings--pitfalls)

---

## 1. Executive Summary

FreedomCamp Manager is a web-based admin control centre for freedom camping
enforcement in New Zealand, operated by Iron Eagle Security / OnSpace AI. It provides:

| Capability | Description |
|---|---|
| **Live Patrol Monitoring** | Real-time GPS tracking of field officers on patrol |
| **Breach Management** | Automated detection & escalation of camping violations |
| **Zone Geofencing** | Polygon/circle-based compliance zones with per-zone rules |
| **Compliance Reporting** | Dashboards, KPIs, drift detection, leadership packs |
| **Vehicle Scanning (ALPR)** | Plate Recognizer + ORC/AI pipeline for plate recognition |
| **Officer Welfare** | Automated inactivity detection, wellness checks |
| **Multi-Organisation** | 3-tier hierarchy: owner → service_provider → client |
| **Enforcement Workflow** | Warnings → Notices to Vacate → Escalation pipeline |
| **ParkPow Integration** | Parking enforcement platform sync |
| **Incident Management** | Court-ready evidence trails with legal holds |

### User Roles

| Role | Access |
|---|---|
| `master` | Full system access, all orgs |
| `admin` | Organisation-scoped admin portal |
| `officer` | Field Officer Portal (mobile-optimised) |
| `admin_officer` | Dual-role: can switch between admin & field portals |

---

## 2. Tech Stack

| Layer | Technology | Version/Notes |
|---|---|---|
| **Frontend** | React | 18.x |
| **Language** | TypeScript | Lenient: `strict: false`, `noImplicitAny: false` |
| **Bundler** | Vite | Fast HMR, path alias `@/*` → `./src/*` |
| **Styling** | Tailwind CSS | v3, dark mode class-based, HSL CSS variables |
| **UI Library** | shadcn/ui (Radix UI) | Pre-built primitives in `src/components/ui/` |
| **State** | Zustand | Persistent stores with localStorage |
| **Server State** | TanStack Query | v5, caching & auto-refetch |
| **Forms** | react-hook-form + zod | Schema-based validation |
| **Charts** | recharts | Dashboard visualisations |
| **Routing** | react-router-dom | v6, nested routes |
| **Backend** | Supabase | PostgreSQL + Edge Functions + RLS + Storage |
| **Package Manager** | bun | `bun.lock` at root |
| **Proxy Service** | Node/Express (Railway) | NZSCV & MotorWeb API proxy |
| **AI Inference** | Node/Express + ONNX (Railway) | YOLOv8n + MobileNetV3 vehicle detection |
| **Maps** | Google Maps / Leaflet | Zone geofencing, hotspot heatmaps |
| **Notifications** | Expo Push | Mobile push notifications |
| **PWA** | Service Worker | Offline-first, install prompt |

---

## 3. Repository Layout

```
/
├── src/
│   ├── App.tsx                    # Root router with role-based guards
│   ├── main.tsx                   # Vite entry point
│   ├── pages/                     # ~104 page components
│   ├── components/
│   │   ├── ui/                    # shadcn/ui primitives (40+ components)
│   │   ├── features/              # 63 app-specific feature components
│   │   └── layout/                # JDSLogo, ResponsiveContainer
│   ├── hooks/                     # 25 custom React hooks
│   ├── stores/                    # Zustand stores
│   │   ├── authStore.ts           # Auth + session management
│   │   └── globalFiltersStore.ts  # Dashboard date/org/zone filters
│   ├── lib/                       # 19 utility modules
│   │   ├── supabase.ts            # Typed Supabase client
│   │   ├── fileUpload.ts          # Storage upload helpers
│   │   ├── geocoding.ts           # Reverse geocoding
│   │   ├── geofence.ts            # Point-in-polygon checks
│   │   ├── imageProcessing.ts     # Client-side image ops
│   │   ├── offlineStorage.ts      # IndexedDB offline queue
│   │   ├── pushNotifications.ts   # Expo push registration
│   │   └── timezone.ts            # NZ timezone helpers
│   └── types/
│       ├── database.ts            # Generated Supabase types
│       └── index.ts               # App-level type definitions
├── supabase/
│   ├── functions/                 # 45 Edge Functions (Deno/TypeScript)
│   │   └── _shared/               # CORS helpers (cors.ts, withCors.ts)
│   └── migrations/                # 70+ SQL migration files
├── proxy-server/                  # Railway: NZSCV/MotorWeb proxy
├── inference-service/             # Railway: ORC/AI vehicle inference
├── docs/                          # Architecture & feature docs
├── public/                        # Static assets
├── index.html                     # Vite HTML entry
├── tailwind.config.ts             # Tailwind theme + CSS variables
├── tsconfig.json                  # TypeScript root config
├── tsconfig.app.json              # App-specific TS config
├── tsconfig.node.json             # Node TS config (Vite)
└── bun.lock                       # Dependency lockfile
```

### Path Alias

```json
// tsconfig.json
{ "paths": { "@/*": ["./src/*"] } }
```

All imports use `@/` prefix: `import { supabase } from '@/lib/supabase'`

---

## 4. Environment Configuration

### Frontend (.env)

```env
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
```

### Supabase Edge Functions (Supabase Dashboard → Secrets)

```env
# Core
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>

# Railway Services
PROXY_SERVER_URL=https://<proxy>.up.railway.app
PROXY_SECRET=<shared-secret>
INFERENCE_SERVICE_URL=https://<inference>.up.railway.app

# External APIs
PLATERECOGNIZER_TOKEN=<plate-recognizer-api-key>
ONSPACE_AI_API_KEY=<onspace-ai-key>
OPENAI_API_KEY=<openai-key>          # Optional: plate extraction in inference
PARKPOW_API_TOKEN=<parkpow-token>     # Optional: parking enforcement

# Feature Flags
DEV_CORS=false                        # true = wildcard CORS (dev only)
```

### Proxy Server (Railway Environment)

```env
NZSCV_API_KEY=<key>
NZSCV_ID_KEY=<key>
NZSCV_BASE_URL=https://api.nzscv.org.nz
MOTORWEB_API_KEY=<key>
MOTORWEB_ID_KEY=<key>
MOTORWEB_BASE_URL=https://api.motorweb.co.nz
PROXY_SECRET=<shared-secret>          # Must match Edge Function secret
PORT=3000
NODE_ENV=production
```

### Inference Service (Railway Environment)

```env
PORT=3000
NODE_ENV=production
ALLOWED_ORIGINS=https://freedomcampmanager.onspace.build,https://fcmanager.co.nz
OPENAI_API_KEY=<key>                  # Optional: enables plate/make/model extraction
DETECTION_CONFIDENCE=0.5
YOLO_MODEL_PATH=./models/yolov8n.onnx
EMBEDDING_MODEL_PATH=./models/mobilenet_v3.onnx
```

---

## 5. Database Schema

### Core Tables

#### `organizations`
3-tier hierarchy: owner → service_provider → client.

| Column | Type | Description |
|---|---|---|
| id | uuid PK | |
| name | text | Organisation name |
| type | text | `owner`, `service_provider`, `client` |
| parent_organization_id | uuid FK | Parent in hierarchy |
| created_at | timestamptz | |

#### `user_profiles`
Officers, admins, system users. Linked to `auth.users`.

| Column | Type | Description |
|---|---|---|
| id | uuid PK (= auth.users.id) | |
| email | text | |
| full_name | text | |
| role | text | `master`, `admin`, `officer`, `admin_officer` |
| organization_id | uuid FK | Primary organisation |
| employer_organization_id | uuid FK | Employment org |
| authorized_work_locations | uuid[] | Organisations user can work in |
| is_active | boolean | |
| coa_number | text | Security license (COA) |
| coa_expiry | date | COA expiry |
| coa_document_url | text | Uploaded COA document |
| warrant_number | text | Legal warrant number |
| warrant_expiry | date | Warrant expiry |
| warrant_document_url | text | Uploaded warrant document |
| coa_required | boolean | |
| coa_verified | boolean | |
| warrant_required | boolean | |
| warrant_verified | boolean | |
| authorized_activities | text[] | AI-extracted activities |
| warrant_acts | text[] | AI-extracted acts |
| last_location | jsonb | `{lat, lng, timestamp}` |
| portal_used | text | `admin` or `field` |

#### `zones`
Geofenced compliance areas.

| Column | Type | Description |
|---|---|---|
| id | uuid PK | |
| name | text | Zone display name |
| organization_id | uuid FK | |
| geofence | jsonb | Polygon/circle coordinates |
| geofence_type | text | `polygon` or `circle` |
| geofence_radius | numeric | For circle type |
| is_day_visit_only | boolean | No overnight stays |
| max_nights_per_month | integer | Monthly limit |
| max_consecutive_nights | integer | Consecutive limit |
| requires_self_contained | boolean | Vehicle must be certified |
| permitted_hours_start | time | Allowed arrival time |
| permitted_hours_end | time | Must leave by |
| latitude | numeric | Centre point |
| longitude | numeric | Centre point |
| is_active | boolean | |
| parkpow_lot_id | text | ParkPow integration |

#### `canonical_vehicles`
Master vehicle registry — one row per plate number.

| Column | Type | Description |
|---|---|---|
| id | uuid PK | |
| plate_number | text UNIQUE | NZ plate |
| make | text | Vehicle make |
| model | text | Vehicle model |
| year | integer | |
| colour | text | |
| body_style | text | |
| is_self_contained | boolean | NZSCV certified |
| self_contained_expiry | date | Certification expiry |
| is_homeless | boolean | Known homeless occupant |
| fc_act_exempt | boolean | Freedom Camping Act exempt |
| is_exempt | boolean | ParkPow exempt |
| enforcement_count | integer | Total enforcement actions |
| last_enforcement_type | text | |
| last_enforcement_at | timestamptz | |
| profile_photo_url | text | AI-selected best photo |
| profile_photo_score | numeric | Quality score |
| profile_photo_sticky | boolean | Don't auto-update |
| notes | text | Officer notes |
| parkpow_vehicle_id | text | ParkPow integration |
| motorweb_data | jsonb | Cached MotorWeb response |
| organization_id | uuid FK | |

#### `observations`
Individual vehicle sightings — the core operational table.

| Column | Type | Description |
|---|---|---|
| id | uuid PK | |
| idempotency_key | text UNIQUE | Prevents duplicate uploads |
| plate_number | text | Observed plate |
| zone_id | uuid FK | Where observed |
| organization_id | uuid FK | |
| recorded_at | timestamptz | When observed |
| recorded_by | uuid FK | Officer who scanned |
| latitude | numeric | GPS lat |
| longitude | numeric | GPS lng |
| gps_accuracy | numeric | Accuracy in metres |
| location_confidence | text | `high`, `medium`, `low` |
| photo_url | text | Evidence photo URL |
| photo_hash | text | SHA-256 for integrity |
| photo_source | text | `camera`, `upload`, `stream` |
| exif_data | jsonb | Photo metadata |
| plate_confidence | numeric | ALPR confidence 0-1 |
| plate_source | text | `plate_recognizer`, `manual`, `stream` |
| vehicle_type | text | Detected type |
| vehicle_make | text | |
| vehicle_model | text | |
| vehicle_colour | text | |
| is_compliant | boolean | Compliance result |
| compliance_summary | jsonb | Immutable audit trail |
| weather_description | text | Conditions at time |
| evidence_state | text | `original_present`, `legacy_no_photo`, etc. |
| embedding_384 | vector(384) | MobileNetV3 fingerprint |
| parkpow_session_id | text | ParkPow session |
| parkpow_violation_id | text | ParkPow violation |

> **Note**: `vehicle_observations_v2` exists as a mirror/backup table only.
> All queries must target `observations`. Never query `vehicle_observations_v2`
> for operational data.

#### `vehicle_monthly_stays`
Calendar-month aggregation per vehicle per zone.

| Column | Type | Description |
|---|---|---|
| id | uuid PK | |
| plate_number | text | |
| zone_id | uuid FK | |
| month | date | First of month |
| nights_stayed | integer | Total nights |
| consecutive_nights | integer | Max consecutive |
| last_seen_at | timestamptz | |

#### `zone_compliance_matrix`
Versioned compliance rules per zone — enables drift detection.

| Column | Type | Description |
|---|---|---|
| id | uuid PK | |
| zone_id | uuid FK | |
| version | integer | Auto-incremented |
| max_nights_per_month | integer | |
| max_consecutive_nights | integer | |
| is_day_visit_only | boolean | |
| requires_self_contained | boolean | |
| effective_from | timestamptz | |
| effective_to | timestamptz | NULL = current |

#### `compliance_results`
Per-observation compliance evaluation.

| Column | Type | Description |
|---|---|---|
| id | uuid PK | |
| observation_id | uuid FK | |
| plate_number | text | |
| zone_id | uuid FK | |
| is_compliant | boolean | |
| violation_types | text[] | Array of breach types |
| violation_reasons | text[] | Human-readable reasons |
| requirement_details | jsonb | Per-requirement breakdown |
| matrix_version | integer | Which matrix version used |
| is_homeless_exempt | boolean | FCA exemption |
| evidence_observations | jsonb | Sequential evidence trail |
| analytics_only | boolean | Historical backfill flag |

#### `breach_alerts`
Non-compliant observations escalated for enforcement.

| Column | Type | Description |
|---|---|---|
| id | uuid PK | |
| plate_number | text | |
| zone_id | uuid FK | |
| organization_id | uuid FK | |
| breach_type | text | `overstay`, `no_self_contained`, `no_wof`, `consecutive_days`, `unauthorized_zone`, `nights_exceeded` |
| status | text | `pending`, `notified`, `resolved`, `escalated` |
| severity | text | `low`, `medium`, `high`, `critical` |
| detected_at | timestamptz | |
| resolved_at | timestamptz | |
| resolved_by | uuid FK | |
| action_taken | text | |
| notice_count | integer | Notices issued |
| last_notice_at | timestamptz | |

#### `enforcement_actions`
Officer actions on breaches.

| Column | Type | Description |
|---|---|---|
| id | uuid PK | |
| breach_alert_id | uuid FK | |
| action_type | text | `warning`, `notice_to_vacate`, `tow`, `referral` |
| performed_by | uuid FK | |
| performed_at | timestamptz | |
| notes | text | |

#### `notices_to_vacate`
Legal notices linked to zone configuration.

| Column | Type | Description |
|---|---|---|
| id | uuid PK | |
| breach_alert_id | uuid FK | |
| zone_legal_config_id | uuid FK | |
| notice_number | text | |
| issued_at | timestamptz | |
| issued_by | uuid FK | |
| vacate_by | timestamptz | |

#### `zone_legal_config`
Per-zone legal details for notice generation.

| Column | Type | Description |
|---|---|---|
| id | uuid PK | |
| zone_id | uuid FK | |
| organization_name | text | |
| land_description | text | |
| breach_details_template | text | |

#### `incidents`
ALPR-processed incidents with evidence and legal holds.

| Column | Type | Description |
|---|---|---|
| id | uuid PK | |
| title | text | |
| description | text | |
| zone_id | uuid FK | |
| organization_id | uuid FK | |
| reported_by | uuid FK | |
| status | text | |
| priority | text | |
| legal_hold | boolean | Prevents deletion |
| evidence_retention_days | integer | |
| alpr_processed | boolean | |
| alpr_results | jsonb | |

#### `patrols`
Officer patrol assignments with geofence tracking.

| Column | Type | Description |
|---|---|---|
| id | uuid PK | |
| officer_id | uuid FK | |
| zone_id | uuid FK | |
| organization_id | uuid FK | |
| status | text | `scheduled`, `in_progress`, `completed`, `cancelled` |
| started_at | timestamptz | |
| ended_at | timestamptz | |
| vehicles_checked | integer | |
| breaches_found | integer | |

#### `health_safety_reports`
Incident severity tracking for officers.

| Column | Type | Description |
|---|---|---|
| id | uuid PK | |
| reported_by | uuid FK | |
| zone_id | uuid FK | |
| organization_id | uuid FK | |
| incident_type | text | |
| severity | text | |
| description | text | |

#### Additional Tables

| Table | Purpose |
|---|---|
| `person_observations` | Links persons to vehicles/zones |
| `officer_welfare_settings` | Auto-logoff & wellness thresholds |
| `welfare_alerts` | Triggered welfare notifications |
| `alert_queue` | Priority-based notification queue |
| `drift_events` | Compliance matrix change tracking |
| `admin_recalculation_actions` | Audit trail for compliance recalcs |
| `photo_metadata` | Evidence photo metadata |
| `plate_scans` | Raw ALPR scan results |
| `plate_history` | Historical plate lookups |
| `bug_reports` | In-app issue tracking |
| `import_batches` / `import_staging` | Data import pipeline |
| `missing_photo_queue` | Photo integrity reconciliation |
| `user_deactivation_queue` | Auth.users sync queue |
| `investigation_job_types` | Configurable job categories |
| `investigation_job_templates` | Mobile completion workflows |
| `zone_suggestions` | Auto-suggested new zones |
| `user_sessions` | Session tracking with device info |
| `audit_log` | System audit trail |
| `verification_results` | NZSCV verification cache |

### Key Relationships

```
organizations (1) ──→ (N) user_profiles
organizations (1) ──→ (N) zones
organizations (1) ──→ (N) observations

zones (1) ──→ (N) observations
zones (1) ──→ (N) zone_compliance_matrix (versioned)
zones (1) ──→ (1) zone_legal_config

canonical_vehicles (1) ──→ (N) observations (via plate_number)
canonical_vehicles (1) ──→ (N) vehicle_monthly_stays

observations (1) ──→ (1) compliance_results
compliance_results ──→ (1) breach_alerts (if non-compliant)
breach_alerts (1) ──→ (N) enforcement_actions
breach_alerts (1) ──→ (N) notices_to_vacate

user_profiles (1) ──→ (N) patrols
user_profiles (1) ──→ (N) observations (recorded_by)
```

### PostgreSQL Extensions Required

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";        -- UUID generation
CREATE EXTENSION IF NOT EXISTS "postgis";           -- Geospatial queries
CREATE EXTENSION IF NOT EXISTS "vector";            -- pgvector for embeddings
CREATE EXTENSION IF NOT EXISTS "pg_cron";           -- Scheduled jobs
```

---

## 6. Row-Level Security & Auth Model

### RLS Principles

1. **All tables have RLS enabled** — no public access without policies
2. **Organisation scoping** — users only see data for their authorised organisations
3. **Helper functions** use `SECURITY DEFINER` to prevent RLS recursion:
   - `get_user_role(uid)` — returns user's role
   - `get_user_organization_id(uid)` — returns primary org
   - `get_user_organization_ids(uid)` — returns all authorised orgs (array)
4. **Exception handlers** in RLS helpers catch `invalid_text_representation` and
   `data_exception` to prevent bad data from crashing policy evaluation
5. **Master role** bypasses org filtering (sees all data)
6. **admin_officer** gets full SELECT on org data, UPDATE on records they didn't create

### Auth Pattern (Edge Functions)

```typescript
// Standard auth check in every Edge Function
const authHeader = req.headers.get("Authorization") ?? "";
if (!authHeader.startsWith("Bearer ")) {
  return new Response(JSON.stringify({ error: "Missing auth" }), {
    status: 401,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const supabaseClient = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);
```

### Session Management

- Login creates a session record in `user_sessions` with device info
- Duplicate session detection prevents concurrent logins
- `forceLogin()` terminates existing sessions before creating new one
- Session validation on app load via `checkSession()` (no network call — uses
  persisted Zustand state + Supabase auth token)

---

## 7. Supabase Edge Functions

All Edge Functions are in `supabase/functions/<name>/index.ts` (Deno TypeScript).

### Shared Helpers

| File | Purpose |
|---|---|
| `_shared/cors.ts` | Wildcard CORS headers (`Access-Control-Allow-Origin: *`) |
| `_shared/withCors.ts` | Production CORS with origin allowlist + auto OPTIONS handling |

#### CORS Pattern (every function must implement)

```typescript
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  // ... handler logic
});
```

#### Production CORS Allowed Origins

```
https://freedomcampmanager.onspace.build
https://fcmanager.co.nz
https://www.onspace.ai
http://localhost:5173 (dev)
http://localhost:3000 (dev)
preview-react-9b4t5o-*.onspace.build (preview deployments)
```

### Complete Edge Function Catalog

#### Compliance & Breach Management (8 functions)

| Function | Method | Purpose |
|---|---|---|
| `alpr-process` | POST | Plate Recognizer ALPR pipeline → creates observations + compliance eval |
| `alpr-retry` | POST | Re-run ALPR on incident evidence images (admin only) |
| `check-almost-breaches` | POST | Predict overnight breach risk for active vehicles |
| `scan-breaches` | POST | Scan all vehicles for compliance breaches → create breach alerts |
| `recalculate-compliance` | POST | Bulk compliance recalculation with drift detection |
| `recalculate-compliance-v2` | POST | Strict zone-based recalculation with matrix validation |
| `cleanup-and-recalculate` | POST | 3-phase: zone correction → dedup → compliance recalc |
| `duplicate-detection` | POST | Find & remove duplicate observations (8hr window) |

#### Vehicle & Observation Management (8 functions)

| Function | Method | Purpose |
|---|---|---|
| `vehicle-ingest` | POST | Production vehicle observation pipeline (Plate Recognizer + photo hash) |
| `orc-ingest` | POST | Unified pipeline: Plate Recognizer → Railway ORC/AI → OnSpace AI fallback |
| `plate-scanner-photo-first` | POST | Feature-flagged delegate to vehicle-ingest |
| `observations-list` | POST | Paginated, filtered observation queries |
| `observations-in-bounds` | POST | Map cluster GPS-bounded observations |
| `observations-export` | POST | CSV export with RLS enforcement |
| `analyze-vehicle-photo` | POST | AI vehicle analysis (make/model/year/colour/stickers) |
| `select-best-vehicle-photo` | POST | AI profile photo selection |

#### Data Management (6 functions)

| Function | Method | Purpose |
|---|---|---|
| `check-data-integrity` | POST | Detect duplicates, orphans, invalid plates |
| `check-zone-corrections` | POST | Validate GPS vs zone geofence |
| `correct-zone-assignments` | POST | Batch zone correction (GPS-based) |
| `zone-correction` | POST | Zone correction with "Other Location" fallback |
| `import-data` | POST | AI-powered file import (CSV/images/docs) |
| `import-historical-data` | POST | Excel import with zone fuzzy matching |

#### Reporting & PDF (6 functions)

| Function | Method | Purpose |
|---|---|---|
| `generate-incident-pdf` | POST | Court-ready incident report PDF |
| `generate-vehicle-report` | POST | Vehicle evidence report with photos |
| `generate-dashboard-report` | POST | Dashboard statistics report |
| `generate-leadership-pack` | POST | Executive summary with drift trends |
| `generate-notice-to-vacate` | POST | Legal notice generation |
| `get-compliance-statistics` | POST | Real-time compliance stats RPC |

#### Location & Integrations (7 functions)

| Function | Method | Purpose |
|---|---|---|
| `hotspot-data` | POST | GPS heatmap clustering |
| `check-nzscv-status` | POST | NZSCV self-contained check (via proxy) |
| `enrich-from-motorweb` | POST | MotorWeb vehicle enrichment (via proxy) |
| `get-weather` | POST | Weather at GPS coordinates (OnSpace AI) |
| `suggest-new-zone` | POST | Auto-zone suggestion via Nominatim |
| `parkpow-sync` | POST | ParkPow platform sync (admin) |
| `stream-webhook` | POST | Plate Recognizer Stream webhook receiver |

#### Notifications (2 functions)

| Function | Method | Purpose |
|---|---|---|
| `send-push-notification` | POST | Expo push notifications |
| `monitor-officer-welfare` | POST | Auto-logoff, wellness checks, alert escalation |

#### Admin & Users (3 functions)

| Function | Method | Purpose |
|---|---|---|
| `admin-incident-ops` | POST | Set legal hold, bulk incident updates |
| `create-user` | POST | Create auth users with profiles & roles |
| `update-compliance-policy` | POST | Bulk compliance policy updates |

#### Document Processing (3 functions)

| Function | Method | Purpose |
|---|---|---|
| `process-credential-document` | POST | AI extraction of COA/Warrant details |
| `process-homeless-data` | POST | AI parsing of homeless status data |
| `process-investigation-document` | POST | AI extraction of investigation job details |

#### Utilities (2 functions)

| Function | Method | Purpose |
|---|---|---|
| `upload-file` | POST | Centralised file upload (evidence buckets) |
| `onspace-ai-chat` | POST | AI chat for bug analysis & code suggestions |

---

## 8. Frontend Architecture

### Routing (App.tsx)

```
/login                          → Login page
/portal-selection               → Role-based portal chooser
/field-officer                  → FieldOfficerPortal (officer, admin_officer)
/admin                          → AdminPortal (admin, admin_officer, master)
/admin/compliance               → ComplianceDashboard
/admin/enforcement              → EnforcementCommandCenter
/admin/vehicles                 → VehicleManagement
/admin/vehicle/:id              → VehicleDetailPage
/admin/zones                    → ZoneManagement
/admin/users                    → UserManagement
/admin/patrols                  → LivePatrolMonitor
/admin/officers                 → LiveOfficerTracking
/admin/reports                  → ReportsHub
/admin/incidents                → IncidentReports
/admin/investigations           → InvestigationJobsPage
/admin/data                     → DataManagementHub
/admin/breach-alerts            → BreachAlerts
/admin/hotspots                 → HotspotsMap
/admin/audit-log                → AuditLog
/admin/analytics                → ComplianceAnalytics
... (104 total page components)
```

### State Management

#### `authStore.ts` (Zustand + persist)
- `user`, `session`, `isAuthenticated`, `role`
- `login(email, password)` — auth + profile fetch + session creation
- `forceLogin(email, password)` — terminates existing sessions first
- `checkSession()` — validates auth on app load
- `logout()` — session termination + auth signout

#### `globalFiltersStore.ts` (Zustand + persist)
- `dateFrom`, `dateTo`, `datePreset` — date range filtering
- `organizationId`, `organizationName` — org filter
- `zoneId`, `zoneName` — zone filter
- Quick helpers: `setToday()`, `setYesterday()`, `setPrevDay()`, `setNextDay()`

### Custom Hooks (25 hooks)

| Hook | Purpose |
|---|---|
| `useVehicles` | Vehicle CRUD + search |
| `usePatrols` | Patrol lifecycle management |
| `useBreaches` | Breach alert queries + actions |
| `useZones` | Zone CRUD + geofence management |
| `useUsers` | User management |
| `useOrganizations` | Organisation hierarchy |
| `useIncidents` | Incident CRUD |
| `useEnforcementActions` | Enforcement workflow |
| `useVehicleCompliance` | Vehicle compliance checks |
| `useVehicleAnalysis` | AI vehicle analysis |
| `useVehicleProfilePhoto` | Profile photo management |
| `usePlateScans` | ALPR scan results |
| `useFlaggedVehicles` | Watchlist vehicles |
| `useHealthSafety` | H&S report management |
| `useAuditLogs` | Audit trail queries |
| `useNotifications` | Notification management |
| `useOfficerNotifications` | Officer-specific alerts |
| `useOfficerWelfareMonitor` | Welfare monitoring |
| `usePermissions` | Role-based permissions |
| `usePersonRecords` | Person observation records |
| `useImportHistory` | Data import tracking |
| `useIncidentRealtime` | Real-time incident updates |
| `useOfflineQueue` | Offline-first queue management |
| `useGlobalLocationTracking` | GPS location tracking |
| `useDarkMode` | Theme toggle |

### Key Feature Components (63 components)

| Component | Purpose |
|---|---|
| `PlateScanner` / `ZoomScan` | Camera-based plate capture |
| `PlateCapture` | Manual plate entry |
| `ScanResultModal` | Post-scan result display |
| `VehicleCard` / `VehicleDetailsView` | Vehicle display |
| `VehicleEditDrawer` | Vehicle editing sidebar |
| `VehiclePhotoGallery` | Evidence photo gallery |
| `VehicleProfilePhoto` | AI-selected profile photo |
| `GlobalFilterRibbon` | Date/org/zone filter bar |
| `UnifiedAlertQueue` | Real-time alert feed |
| `BreachAdvisoryModal` | Breach details + actions |
| `ComplianceBlockingModal` | Login compliance gate |
| `ComplianceCredentialsUpload` | COA/Warrant upload |
| `EnforcementGuardModal` | Enforcement confirmation |
| `IncidentCreationForm` | New incident form |
| `MultiPhotoUpload` | Multi-photo evidence upload |
| `ManualEntryModal` | Manual observation entry |
| `PatrolCard` | Patrol status display |
| `StatCard` | KPI metric card |
| `OrganizationSelector` | Org hierarchy picker |
| `PermissionsEditor` | Role permission management |
| `PersonRecordsManager` | Person record CRUD |
| `OfficerWelfareWarningModal` | Welfare alert display |
| `NotificationCenter` | Notification management |
| `NetworkStatusBar` | Online/offline indicator |
| `OfflineQueueView` | Offline queue management |
| `PWAInstallPrompt` | PWA install prompt |
| `PWAUpdateNotification` | PWA update notification |
| `BugReportButton` / `BugReportModal` | In-app bug reporting |
| `DarkModeToggle` | Theme switch |
| `DrivingModeToggle` | Mobile driving mode |
| `KeepScreenAwake` | Prevent screen sleep |
| `SessionList` | Active session management |

### Utility Libraries (19 modules in src/lib/)

| Module | Purpose |
|---|---|
| `supabase.ts` | Typed Supabase client (`Pacific/Auckland` timezone header) |
| `fileUpload.ts` | Supabase Storage upload helpers |
| `geocoding.ts` | Reverse geocoding (address from GPS) |
| `geofence.ts` | Point-in-polygon checks |
| `imageProcessing.ts` | Client-side image resize/compress |
| `imageWatermarking.ts` | Evidence watermarking |
| `imageFormats.ts` | Format detection/conversion |
| `offlineStorage.ts` | IndexedDB for offline queue |
| `pushNotifications.ts` | Expo push token registration |
| `pwa.ts` | Service worker management |
| `sessionPersistence.ts` | Auth session persistence |
| `sounds.ts` | Audio feedback |
| `timezone.ts` | NZ timezone helpers |
| `csvExport.ts` | CSV generation |
| `fullExport.ts` | Full data export |
| `vehicleAnalysis.ts` | Vehicle analysis helpers |
| `biometric.ts` | Biometric auth (fingerprint/Face ID) |
| `design-system.ts` | Design system utilities |
| `theme.ts` | Theme management |

### Timezone Convention

**All datetimes use NZ timezone** (`Pacific/Auckland`). The Supabase client sets
`X-Client-Timezone: Pacific/Auckland` on every request. Server-side uses `nz_now()`
helper function.

---

## 9. Railway Services (Already Built)

> **These services are already deployed on Railway and should NOT be rebuilt.**
> The new app simply connects to them via their Railway URLs.

### 9.1 Proxy Server

**Purpose**: Static-IP reverse proxy for NZSCV and MotorWeb APIs (which require
IP whitelisting).

**URL**: Set as `PROXY_SERVER_URL` in Supabase Edge Function secrets.

**Endpoints**:

| Endpoint | Method | Purpose |
|---|---|---|
| `/health` | GET | Liveness check |
| `/api/nzscv/vehicle-info` | POST | NZSCV self-contained vehicle lookup |
| `/motorweb/currentOwnerCheck` | GET | MotorWeb owner check |
| `/api/info` | GET | Service metadata |

**Authentication**: `X-Proxy-Secret` header must match `PROXY_SECRET` env var.

**Rate Limits**: 1 request/second for both NZSCV and MotorWeb APIs.

**Stack**: Node.js 18 + Express + axios + dotenv.

### 9.2 Inference Service (ORC/AI)

**Purpose**: On-device vehicle detection and 384-dimensional feature embedding
for visual vehicle matching.

**URL**: Set as `INFERENCE_SERVICE_URL` in Supabase Edge Function secrets.

**Endpoints**:

| Endpoint | Method | Purpose |
|---|---|---|
| `/health` | GET | Liveness + model status |
| `/infer` | POST | Vehicle detection + embedding extraction |

**ML Models**:
- **YOLOv8n** (27 MB ONNX) — vehicle detection (bounding boxes)
- **MobileNetV3** (27 MB ONNX) — 384-D feature embedding

**Input**: Multipart photo or JSON `{ image_base64 }` (max 10 MB).

**Output**:
```json
{
  "embedding": [0.123, -0.456, ...],  // 384 floats
  "vehicle_detected": true,
  "detection_confidence": 0.92,
  "plate_number": "ABC123",           // Only if OPENAI_API_KEY set
  "vehicle_make": "Toyota",           // Only if OPENAI_API_KEY set
  "vehicle_model": "Hiace",
  "vehicle_colour": "White"
}
```

**Fallback**: If models not loaded → returns 503. Edge Functions fall back to
OnSpace AI for plate/vehicle extraction.

**Docker Build**: Multi-stage (Python model export → Node builder → Node production).
Models are baked into the image at build time.

**Stack**: Node.js 18 + Express + onnxruntime-node + sharp + multer.

### How Edge Functions Use Railway Services

```typescript
// In orc-ingest or vehicle-ingest Edge Functions:

// 1. Try Railway Inference Service first
const inferenceUrl = Deno.env.get("INFERENCE_SERVICE_URL");
if (inferenceUrl) {
  const response = await fetch(`${inferenceUrl}/infer`, {
    method: "POST",
    body: formData,  // multipart with photo
  });
  if (response.ok) {
    const { embedding, plate_number, vehicle_make } = await response.json();
    // Use embedding for visual matching, plate for identification
  }
}

// 2. Check NZSCV via Proxy
const proxyUrl = Deno.env.get("PROXY_SERVER_URL");
const proxySecret = Deno.env.get("PROXY_SECRET");
const nzscvResponse = await fetch(`${proxyUrl}/api/nzscv/vehicle-info`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Proxy-Secret": proxySecret,
  },
  body: JSON.stringify({ RegistrationNumber: plateNumber }),
});

// 3. Enrich from MotorWeb via Proxy
const motorwebResponse = await fetch(
  `${proxyUrl}/motorweb/currentOwnerCheck?plateOrVin=${plate}&specificReason=compliance`,
  { headers: { "X-Proxy-Secret": proxySecret } }
);
```

---

## 10. External Integrations

### 10.1 Plate Recognizer

**Purpose**: ALPR (Automatic License Plate Recognition) from photos.

**Used by**: `alpr-process`, `vehicle-ingest`, `orc-ingest`, `stream-webhook`

**API**: `POST https://api.platerecognizer.com/v1/plate-reader/`

**Auth**: `Authorization: Token <PLATERECOGNIZER_TOKEN>`

**Input**: Multipart photo upload

**Output**: Plate text, confidence score, bounding box, vehicle type

### 10.2 OnSpace AI

**Purpose**: AI-powered analysis, document processing, vehicle analysis.

**Used by**: `analyze-vehicle-photo`, `select-best-vehicle-photo`, `get-weather`,
`process-credential-document`, `process-homeless-data`,
`process-investigation-document`, `import-data`, `onspace-ai-chat`,
`orc-ingest` (fallback)

**Capabilities**: Vision analysis, document parsing, natural language chat

### 10.3 NZSCV (via Proxy)

**Purpose**: New Zealand Self-Contained Vehicle Registry — verify if a vehicle
holds a valid self-contained certification.

**Used by**: `check-nzscv-status` → calls proxy → calls NZSCV API

**Source of truth** for self-contained status (overrides AI detection).

### 10.4 MotorWeb (via Proxy)

**Purpose**: NZ vehicle registration database — make, model, year, colour,
WOF status, registration status, current owner.

**Used by**: `enrich-from-motorweb` → calls proxy → calls MotorWeb API

### 10.5 ParkPow

**Purpose**: Parking enforcement platform with watchlists, permits, sessions,
and violation management.

**Used by**: `parkpow-sync` Edge Function

**Features synced**: Zone ↔ Lot mapping, vehicle watchlists, violation records

### 10.6 Nominatim (OpenStreetMap)

**Purpose**: Reverse geocoding — GPS coordinates → street address.

**Used by**: `suggest-new-zone` for auto-zone naming

### 10.7 Expo Push Notifications

**Purpose**: Mobile push notifications for breach alerts, welfare checks,
investigation assignments.

**Used by**: `send-push-notification`

---

## 11. Feature Flags & Phased Rollout

### Phase Sequence

| Phase | Flag(s) | Purpose | Dependencies |
|---|---|---|---|
| 1 | `FEATURE_OFFICER_OUTBOX` | Offline queue + sync | None |
| 1 | `FEATURE_INGEST_V2` | Photo-first edge function pipeline | None |
| 2 | `FEATURE_PATROL_GEOFENCE` | Auto patrol start/stop via geofence | Phase 1 |
| 3 | `FEATURE_PORTAL_SWITCH` | In-session admin↔officer switching | Phase 2 |
| 4 | `FEATURE_ENFORCEMENT` | Case management + notice generation | Phase 3 |
| 5 | `FEATURE_INCIDENTS` | Incident reports with evidence | Phase 4 |
| 5 | `FEATURE_PERSON_CANONICAL` | Person tracking & records | Phase 4 |
| 6 | `FEATURE_KPI_RECOMPUTE` | Historical compliance backfill | Phase 5 |

### Gate Criteria

- **Phase 1**: Queue drains fully; p95 upload latency ≤ 5s; upload success ≥ 99%
- **Phase 2**: ≥ 95% geofence accuracy
- **Phase 3**: Mode switch preserves all state
- **Phase 4**: EXEMPT guard prevents notice issuance to exempt vehicles

### API Freeze (Post Phase 6)

After all phases complete, these 5 core RPCs are frozen (signatures cannot change):

1. `vehicle-ingest` — observation creation
2. `observations-list` — paginated queries
3. `recalculate-compliance` — compliance engine
4. `scan-breaches` — breach detection
5. `get-compliance-statistics` — dashboard stats

---

## 12. Build & Deployment

### Prerequisites

```bash
# Install bun (if not already installed)
curl -fsSL https://bun.sh/install | bash

# Install Supabase CLI
npm install -g supabase
```

### Development Setup

```bash
# 1. Clone repository
git clone <repo-url>
cd FreedomCamp-Manager

# 2. Create package.json (if missing)
cat > package.json << 'EOF'
{
  "name": "vite_react_shadcn_ts",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "eslint .",
    "preview": "vite preview"
  }
}
EOF

# 3. Install dependencies
bun install

# 4. Set up environment
cp .env.example .env
# Edit .env with your Supabase credentials

# 5. Start dev server
bun run dev
# → http://localhost:5173
```

### Build Commands

```bash
bun run build    # TypeScript check + Vite production build → dist/
bun run lint     # ESLint (flat config)
bun run preview  # Preview production build
bun run dev      # Development server with HMR
```

### Supabase Setup

```bash
# 1. Link to project
supabase link --project-ref <project-ref>

# 2. Run migrations
supabase db push

# 3. Deploy Edge Functions
supabase functions deploy

# 4. Set secrets
supabase secrets set PROXY_SERVER_URL=https://...
supabase secrets set PROXY_SECRET=...
supabase secrets set INFERENCE_SERVICE_URL=https://...
supabase secrets set PLATERECOGNIZER_TOKEN=...
supabase secrets set ONSPACE_AI_API_KEY=...
```

### Frontend Deployment

Deploy the `dist/` folder to any static host:

- **OnSpace Build**: Push to `main` → auto-deploy
- **Vercel/Netlify**: Connect GitHub repo → set `bun run build` as build command
- **Manual**: `bun run build && upload dist/`

### GitHub Actions Workflows

| Workflow | Trigger | Purpose |
|---|---|---|
| `deploy-edge-functions.yml` | Push to main | Deploy all Edge Functions |
| `run-migrations.yml` | Push to main | Run database migrations |
| `deploy-railway.yml` | Push to main | Deploy Railway services |
| `extract-schema.yml` | Manual | Extract database types |
| `parkpow-sync.yml` | Manual | Sync zones to ParkPow |

---

## 13. Step-by-Step Rebuild Instructions

### For OnSpace AI to rebuild the entire application:

#### Phase 1: Project Scaffolding

1. **Create Vite + React + TypeScript project**
   ```bash
   bun create vite freedomcamp-manager --template react-ts
   cd freedomcamp-manager
   ```

2. **Install core dependencies**
   ```bash
   bun add react-router-dom@6 @supabase/supabase-js zustand @tanstack/react-query
   bun add react-hook-form zod @hookform/resolvers
   bun add recharts date-fns lucide-react sonner
   bun add tailwindcss postcss autoprefixer
   bun add -d @types/react @types/react-dom typescript eslint
   ```

3. **Set up shadcn/ui**
   ```bash
   npx shadcn-ui@latest init
   # Choose: TypeScript, Tailwind, HSL CSS variables, @/ path alias
   ```

4. **Configure path alias** in `tsconfig.json`:
   ```json
   { "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }
   ```

5. **Set TypeScript to lenient mode** in `tsconfig.app.json`:
   ```json
   {
     "strict": false,
     "noImplicitAny": false,
     "strictNullChecks": false,
     "noUnusedLocals": false,
     "noUnusedParameters": false,
     "skipLibCheck": true
   }
   ```

#### Phase 2: Supabase Backend

1. **Create Supabase project** at https://supabase.com
2. **Enable extensions**: uuid-ossp, postgis, vector, pg_cron
3. **Run migrations** in order (70+ SQL files under `supabase/migrations/`)
   - Start with core tables: organizations, user_profiles, zones
   - Then: canonical_vehicles, observations, compliance_results
   - Then: breach_alerts, enforcement_actions, notices_to_vacate
   - Then: patrols, incidents, health_safety_reports
   - Then: supporting tables (audit_log, bug_reports, etc.)
   - Finally: RLS policies, triggers, helper functions
4. **Create RLS helper functions** (SECURITY DEFINER):
   - `get_user_role(uid)`
   - `get_user_organization_id(uid)`
   - `get_user_organization_ids(uid)`
5. **Create Edge Functions** (45 functions — see catalog in Section 7)
6. **Set up Storage buckets**:
   - `evidence` — vehicle observation photos
   - `incident-evidence` — incident report photos
   - `credentials` — COA/Warrant documents
7. **Set secrets** via Supabase Dashboard (see Section 4)

#### Phase 3: Frontend Core

1. **Create Supabase client** (`src/lib/supabase.ts`)
   - Set `X-Client-Timezone: Pacific/Auckland` global header
   - Type with generated `Database` types

2. **Create Zustand stores**:
   - `authStore.ts` — login, logout, session management, role-based access
   - `globalFiltersStore.ts` — date range, org, zone filters with persistence

3. **Create type definitions** (`src/types/index.ts`):
   - BreachType, BreachStatus, PatrolStatus, Severity enums
   - Zone, BreachAlert, Patrol, VehicleRecord, UserProfile interfaces

4. **Generate database types**: `supabase gen types typescript > src/types/database.ts`

5. **Set up routing** (`src/App.tsx`):
   - Login → Portal Selection → Admin Portal / Field Officer Portal
   - Role-based route guards
   - PWA install prompt + update notification

#### Phase 4: Frontend Pages (by priority)

**Tier 1 — Core operational pages (build first)**:
1. `Login.tsx` — auth + biometric + compliance gate
2. `FieldOfficerPortal.tsx` — mobile-first scanning interface
3. `AdminPortal.tsx` / `AdminDashboard.tsx` — admin command centre
4. `VehicleManagement.tsx` — vehicle registry CRUD
5. `ZoneManagement.tsx` — zone config + geofencing map
6. `ComplianceDashboard.tsx` — compliance monitoring
7. `BreachAlerts.tsx` — breach management

**Tier 2 — Enforcement & monitoring**:
8. `EnforcementCommandCenter.tsx` — real-time enforcement dashboard
9. `EnforcementActions.tsx` — enforcement workflow
10. `LivePatrolMonitor.tsx` — active patrol tracking
11. `LiveOfficerTracking.tsx` — officer GPS monitoring
12. `UserManagement.tsx` — user CRUD + role assignment

**Tier 3 — Reports & analytics**:
13. `ReportsHub.tsx` — report generation centre
14. `IncidentReports.tsx` — incident management
15. `ComplianceAnalytics.tsx` — deep compliance analysis
16. `HotspotsMap.tsx` — GPS heatmap visualisation
17. `AuditLog.tsx` — system audit trail

**Tier 4 — Data management & utilities**:
18. `DataManagementHub.tsx` — data tools
19. `DataCleanupUtility.tsx` — data cleanup
20. `DataIntegrityDashboard.tsx` — integrity monitoring
21. `VehicleRegistry.tsx` — vehicle search
22. `VehicleDetailPage.tsx` — single vehicle view
23. All remaining pages...

#### Phase 5: Custom Hooks

Build hooks in this order (dependencies flow downward):
1. `usePermissions` — role checks
2. `useOrganizations` — org data
3. `useZones` — zone data
4. `useVehicles` — vehicle CRUD
5. `usePatrols` — patrol management
6. `useBreaches` — breach alerts
7. `useVehicleCompliance` — compliance checks
8. `useEnforcementActions` — enforcement workflow
9. `useIncidents` — incident management
10. `usePlateScans` — ALPR results
11. Remaining hooks...

#### Phase 6: Feature Components

Build in parallel with pages:
- Scanning: `PlateScanner`, `ZoomScan`, `PlateCapture`, `ScanResultModal`
- Vehicle: `VehicleCard`, `VehicleDetailsView`, `VehicleEditDrawer`, `VehiclePhotoGallery`
- Compliance: `ComplianceBlockingModal`, `ComplianceCredentialsUpload`
- Enforcement: `EnforcementGuardModal`, `BreachAdvisoryModal`
- UI: `GlobalFilterRibbon`, `StatCard`, `UnifiedAlertQueue`, `NetworkStatusBar`
- PWA: `PWAInstallPrompt`, `PWAUpdateNotification`, `KeepScreenAwake`

#### Phase 7: Connect Railway Services

1. **Set Railway URLs** in Supabase secrets
2. **Test proxy endpoints**:
   ```bash
   curl https://<proxy>.up.railway.app/health
   curl -X POST https://<proxy>.up.railway.app/api/nzscv/vehicle-info \
     -H "X-Proxy-Secret: <secret>" \
     -H "Content-Type: application/json" \
     -d '{"RegistrationNumber": "ABC123"}'
   ```
3. **Test inference endpoints**:
   ```bash
   curl https://<inference>.up.railway.app/health
   curl -X POST https://<inference>.up.railway.app/infer \
     -F "image=@test-vehicle.jpg"
   ```
4. **Verify Edge Functions** call Railway services correctly

#### Phase 8: Integration Testing

1. **End-to-end scan flow**: Officer login → scan plate → observation created →
   compliance evaluated → breach alert (if non-compliant) → enforcement action
2. **NZSCV check**: Scan plate → check self-contained status via proxy
3. **MotorWeb enrichment**: Scan plate → enrich with make/model/year
4. **ORC/AI embedding**: Photo → inference service → 384-D embedding stored
5. **Compliance recalculation**: Trigger bulk recalc → verify matrix + results
6. **Report generation**: Generate PDF → verify content + photos
7. **Multi-org isolation**: Login as different orgs → verify RLS

---

## 14. Learnings & Pitfalls

### Critical Lessons from the Current Build

1. **Never query `vehicle_observations_v2`** — it is a mirror/backup table only.
   All operational queries must target the `observations` table.

2. **TypeScript config must stay lenient** — `strict: false`, `noImplicitAny: false`,
   `strictNullChecks: false`. Do not tighten these settings.

3. **Timezone is always NZ** — `Pacific/Auckland`. Every datetime operation must
   account for this. The Supabase client sends `X-Client-Timezone` header.

4. **RLS helper functions need exception handlers** — wrap in
   `EXCEPTION WHEN invalid_text_representation OR data_exception` to prevent
   bad data from crashing policy evaluation.

5. **Migrations must be idempotent** — use `information_schema` checks before
   `ALTER TABLE`. Check column existence and data type before modifying.

6. **CORS has two modes** — `cors.ts` (wildcard, for dev) and `withCors.ts`
   (production allowlist). All Edge Functions must handle OPTIONS preflight.

7. **Edge Function auth pattern** — always check `Authorization` header starts
   with `Bearer `. Use `SUPABASE_SERVICE_ROLE_KEY` for server-side operations.

8. **Models are baked into Docker** — inference-service exports ONNX models
   during Docker build (Python stage). No external download URLs exist.

9. **GPS accuracy matters** — the geofence system uses 15m threshold (not 5m)
   to account for GPS inaccuracy on mobile devices.

10. **Session management prevents duplicates** — login flow checks for existing
    sessions and either blocks or force-terminates them.

11. **NZSCV is source of truth** — for self-contained vehicle status, the NZSCV
    registry overrides any AI detection results.

12. **Photo evidence is mandatory** — after migration `20260219`, no observation
    can exist without a verifiable photo (enforced at database level).

13. **Compliance matrix is versioned** — every change to zone rules creates a new
    matrix version. Compliance results reference the matrix version used for
    audit trail.

14. **ParkPow sync is zone-based** — zones map to ParkPow lots. Vehicles map to
    ParkPow vehicles. Breaches map to ParkPow violations.

15. **Offline-first design** — the Field Officer Portal uses IndexedDB for offline
    queue. Scans are queued locally and synced when connectivity returns.

16. **PWA support is critical** — officers use the app in the field on mobile
    devices. Install prompt, update notification, and screen-awake are essential.

17. **No root package.json is committed** — if missing after clone, create it with
    the standard scripts (dev, build, lint, preview).

### Security Considerations

- All Edge Functions validate auth tokens before processing
- RLS policies enforce org-scoped data isolation
- Proxy server authenticates via shared secret (`X-Proxy-Secret`)
- CORS allowlist in production prevents unauthorised origins
- Photo hashing (SHA-256) ensures evidence integrity
- Legal hold flag on incidents prevents accidental deletion
- User deactivation is queued (not immediate) to prevent auth.users table issues

### Performance Notes

- Core indexes on `observations`: `recorded_at`, `org_id`, `zone_id`, `plate_number`, GPS
- `dashboard_stats_live` is a materialised view for real-time KPIs
- Compliance recalculation runs in batches to avoid timeout
- ALPR processing has 10s timeout; inference has separate 15s timeout
- Edge Functions use `SUPABASE_SERVICE_ROLE_KEY` to bypass RLS for admin operations

---

## Appendix A: Complete Page Inventory (104 pages)

### Admin Pages
- AdminPortal, AdminDashboard
- ComplianceDashboard, ComplianceAnalytics, ComplianceRecalculation
- EnforcementCommandCenter, EnforcementActions, EnforcementReview
- VehicleManagement, VehicleRegistry, VehicleDetailPage, VehicleSearch
- ZoneManagement
- UserManagement
- LivePatrolMonitor, LiveOfficerTracking
- ReportsHub, IncidentReports, ObservationsReport
- DataManagementHub, DataCleanupUtility, DataIntegrityDashboard
- BreachAlerts, BreachNotices
- HotspotsMap
- AuditLog
- InvestigationJobsPage
- NoticeToVacate
- ImportData, ImportHistoricalData
- OfficerWelfareSettings
- PersonRecords

### Field Officer Pages
- FieldOfficerPortal (multi-view: dashboard, scanning, reports, history, settings)

### Shared Pages
- Login, PortalSelection
- Settings, Profile

## Appendix B: Supabase Storage Buckets

| Bucket | Purpose | RLS |
|---|---|---|
| `evidence` | Vehicle observation photos | Scoped to officer's org |
| `incident-evidence` | Incident report photos & documents | Scoped to user UUID path |
| `credentials` | COA/Warrant documents | Scoped to user |

## Appendix C: Scheduled Jobs (pg_cron)

| Schedule | Function | Purpose |
|---|---|---|
| Daily 3am NZT | `correct-zone-assignments` | GPS zone correction |
| Periodic | `monitor-officer-welfare` | Welfare check & auto-logoff |
| Periodic | `check-almost-breaches` | Overnight breach prediction |

## Appendix D: RPC Functions

| Function | Purpose |
|---|---|
| `get_admin_dashboard_stats()` | KPI aggregations for admin dashboard |
| `get_zones_with_activity()` | Zones with recent observations |
| `match_vehicle()` | Visual vehicle matching via pgvector |
| `get_my_scans_24h()` | Officer's own scans (last 24h) |
| `check_organization_compliance()` | Org-level compliance check |
| `calculate_vehicle_compliance_v3()` | Current compliance engine |
| `evaluate_observation_requirements()` | Per-requirement compliance eval |
| `nz_now()` | Current NZ time |
