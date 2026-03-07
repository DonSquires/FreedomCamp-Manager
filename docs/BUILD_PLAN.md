# FreedomCamp Manager — Complete Build Plan (v2)

> **Purpose**: This is the single source of truth for rebuilding FreedomCamp Manager from
> scratch. It reflects the **current, live schema** (as of 2026-03-10) including every
> architectural decision, database table, Edge Function, frontend page, external
> integration, and deployment step.
>
> **Why a fresh rebuild resolves bugs**: The original project accumulated 105+ migrations
> applied incrementally, leaving legacy columns, orphaned tables, redundant triggers, and
> conflicting schema references in production. A clean project starting from this plan
> avoids all of that technical debt.
>
> **Railway services** (inference-service and proxy-server) are **already deployed and
> operational**. This rebuild focuses on the Supabase backend and the React SPA frontend
> that connect to them.
>
> **Last updated**: 2026-03-10 — schema is accurate through migration
> `20260310_fix_ensure_other_location_zone.sql`.

---

## Table of Contents

1. [Build Purpose, Users & Outputs](#1-build-purpose-users--outputs)
2. [Executive Summary](#2-executive-summary)
3. [Tech Stack](#3-tech-stack)
4. [Repository Layout](#4-repository-layout)
5. [Environment Configuration](#5-environment-configuration)
6. [Database Schema](#6-database-schema)
7. [Row-Level Security & Auth Model](#7-row-level-security--auth-model)
8. [Supabase Edge Functions](#8-supabase-edge-functions)
9. [Frontend Architecture](#9-frontend-architecture)
10. [Railway Services (Already Built)](#10-railway-services-already-built)
11. [External Integrations](#11-external-integrations)
12. [Feature Flags & Phased Rollout](#12-feature-flags--phased-rollout)
13. [Build & Deployment](#13-build--deployment)
14. [Step-by-Step Rebuild Instructions](#14-step-by-step-rebuild-instructions)
15. [Learnings & Pitfalls](#15-learnings--pitfalls)
16. [V1 Inference Contract](#16-v1-inference-contract)

---

## 1. Build Purpose, Users & Outputs

### 1.1 What This System Is For

FreedomCamp Manager is a **digital enforcement platform** built for New Zealand councils
and contracted security companies (such as Iron Eagle Security) to manage and enforce
freedom camping rules under the **Freedom Camping Act 2011** and local bylaws.

**The problem it solves**: Before this system, officers patrolled camping sites on foot or
by vehicle, manually writing down licence plates in notebooks, checking paper registers,
and issuing handwritten notices. There was no central record of who had camped where, for
how long, or whether the same vehicle had exceeded the legal stay limits. Councils had no
way to prove compliance history in court, no way to share data between patrol teams, and
no way to detect repeat offenders automatically.

FreedomCamp Manager replaces that manual process end-to-end:

- A field officer **photographs a vehicle's number plate** on their phone.
- The system **automatically identifies the plate**, checks the vehicle's stay history,
  and tells the officer in seconds whether the vehicle is **compliant or in breach**.
- If in breach, the officer can issue a formal **Notice to Vacate** directly from the app,
  generating a dated, signed, court-ready PDF.
- All data is stored centrally, shared across the patrol team in real time, and auditable
  by administrators and council managers.

---

### 1.2 Who Uses This System

#### Field Officers (`officer` role)
Security officers patrolling freedom camping zones. They use the system exclusively
through the **mobile-optimised Field Officer Portal**, primarily on smartphones or tablets
while on foot or in a vehicle.

**What they need the app to do:**
- Start and end a patrol shift with a single tap.
- Scan a vehicle's licence plate by taking a photo (or entering it manually if the camera
  fails) and get an instant compliance verdict.
- See a vehicle's history — how many nights it has stayed at this zone and others.
- Record a formal observation with GPS coordinates, photo evidence, and weather conditions.
- Issue a verbal warning or generate a Notice to Vacate without leaving the app.
- Scan QR or NFC checkpoints to prove they visited each required location on their route
  (Lone Worker Protocol / Health & Safety).
- Continue working if phone signal drops — scans queue offline and sync automatically
  when connectivity returns.
- Receive welfare check-ins and respond to confirm they are safe.

#### Administrators (`admin` role)
Managers at Iron Eagle Security or the contracting council. They use the
**Admin Portal** on a desktop or laptop browser.

**What they need the app to do:**
- View a live map showing all active officers, their locations, and patrol status.
- See a compliance dashboard with key metrics: total scans today, breach rate, most
  problematic vehicles, highest-activity zones.
- Review and action breach alerts — acknowledge, assign to an officer, or dismiss.
- Manage the zone map — draw geofenced compliance areas, set nightly limits, require
  self-contained certification, restrict certain days or hours.
- Manage officers — create accounts, assign credentials, activate/deactivate.
- Generate and download PDF reports: incident reports, leadership packs, compliance
  statistics.
- Review all evidence photos and observation records.
- Trigger a bulk compliance recalculation if zone rules change.
- Manage multi-organisation access (if operating across multiple councils).

#### Master Users (`master` role)
OnSpace AI system operators. They have full access to all organisations and all data.
They use this role for support, auditing, data migration, and cross-org reporting.

#### Dual-Role Officers (`admin_officer` role)
Officers who also perform administrative duties (e.g. team leaders). They can
switch between the Field Officer Portal and the Admin Portal within a single session
without logging out.

---

### 1.3 How It Works — End-to-End User Journey

#### Journey A: Officer Scans a Vehicle (core workflow)

```
1. Officer opens the app on their phone and logs in.
   → Login page verifies credentials.
   → If COA or Warrant has expired, a compliance gate blocks access until resolved.

2. Officer selects their zone and starts a patrol.
   → A patrol record is created in the database with start time and GPS location.
   → The live officer tracking map in the admin portal shows them as active.

3. Officer sees a vehicle camped in the zone. They tap "Scan".
   → The camera opens in a guided viewfinder optimised for number plates.
   → Officer photographs the plate (or zooms in using "Zoom Scan" mode).

4. The photo is sent to the ALPR pipeline (alpr-process Edge Function):
   a. Plate Recognizer API extracts the plate number and confidence score.
   b. Railway ORC/AI Inference Service detects vehicle make/model/colour and generates
      a 384-dimensional visual fingerprint (embedding) for the vehicle.
   c. ORC also checks for a blue/green self-contained certification sticker.
   d. The system calls NZSCV to verify if the vehicle holds a valid self-contained cert.
   e. An observation record is created in the database with all evidence.

5. The compliance engine runs automatically:
   → It looks up how many nights this plate has been seen at this zone this month.
   → It checks the zone's rules (max nights, consecutive limit, self-contained required).
   → It checks if the vehicle qualifies for a Freedom Camping Act exemption (homeless).
   → It produces a compliance result: COMPLIANT or IN BREACH.

6. The result is displayed to the officer instantly:
   ✅ COMPLIANT  — green screen, vehicle details shown, officer continues patrol.
   ❌ IN BREACH  — red screen with breach type (e.g. "5 consecutive nights — limit is 3"),
                  officer is prompted to take action.

7. If the officer selects "Issue Warning":
   → A breach alert is created with status = 'pending'.
   → Officer adds notes, the alert is saved to the database.

8. If the officer selects "Issue Notice to Vacate":
   → The app generates a PDF notice using the zone's legal configuration.
   → The notice is date/time stamped, references the zone bylaw, lists the violation.
   → Officer can print via AirPrint or email directly from the app.
   → The notice is stored as evidence against the breach alert.

9. Officer continues patrol, scanning vehicles.
   → Each scan and observation is recorded in real time.
   → At the end of patrol, officer taps "End Patrol".
   → Patrol record is closed with end time and statistics (vehicles checked, breaches found).
```

#### Journey B: Officer Scans a QR Checkpoint (Lone Worker Protocol)

```
1. Officer arrives at a physical checkpoint location (sign, gate, etc. with a QR code).
2. Officer taps "Scan Checkpoint" in the app.
3. Camera opens — officer scans the QR code.
4. App records: checkpoint ID, GPS location, timestamp, scan method, distance from checkpoint.
5. The admin portal shows the checkpoint as visited on the patrol route map.
6. If the officer fails to visit a required checkpoint within the expected window,
   an alert is raised for the patrol manager.
```

#### Journey C: Admin Reviews Breaches (admin workflow)

```
1. Admin logs in and sees the Breach Alerts dashboard.
2. Alerts are listed with: plate number, zone, breach type, severity, time detected.
3. Admin clicks an alert to open the Breach Advisory modal:
   → Full vehicle history shown (timeline of all observations).
   → Evidence photos from the observation.
   → Previous enforcement actions for this vehicle.
4. Admin can:
   → Acknowledge the alert (moves to 'acknowledged').
   → Assign it to an officer for follow-up.
   → Mark enforcement started (moves to 'enforcement_started').
   → Resolve or dismiss the alert with notes.
5. If enforcement was taken, admin can record the action type:
   warning, notice_to_vacate, tow request, or referral to council.
```

#### Journey D: Admin Generates a Leadership Pack (reporting workflow)

```
1. Admin opens Reports Hub → Generate Leadership Pack.
2. Selects date range, organisation, and zones.
3. The generate-leadership-pack Edge Function queries the database and produces:
   → Total observations in period.
   → Breach rate by zone (% of vehicles that were non-compliant).
   → Top 10 repeat offenders (vehicles seen most often).
   → Compliance trend chart (daily breach count over the period).
   → Drift events (any zone rules changed during the period and their impact).
4. A PDF is generated server-side and downloaded automatically.
5. Admin emails this to the council contract manager as part of monthly reporting.
```

---

### 1.4 What This System Produces

Every interaction with the system creates a permanent, auditable record. Below is the
complete catalogue of outputs.

#### Operational Records (real-time, stored in database)

| Output | Description | Where Stored |
|---|---|---|
| **Observation record** | Vehicle seen at location: plate, GPS, photo, time, compliance result | `observations` table |
| **Compliance state** | Compliance status and breach reason written directly on each observation | `observations` table (`is_compliant`, `breach_type`, `breach_reason`) |
| **Breach alert** | Auto-created when a vehicle is non-compliant; tracks workflow | `breach_alerts` table |
| **Enforcement action** | What the officer did about a breach (warning, notice, etc.) | `enforcement_actions` table |
| **Patrol record** | Start/end time, vehicles checked, GPS track | `patrols` table |
| **Checkpoint visit** | Proof of officer presence at QR/NFC point | `checkpoint_visits` table |
| **Incident report** | Multi-photo evidence package with legal hold | `incidents` table |
| **Welfare alert** | Automated officer safety notifications | `officer_welfare_alerts` table |
| **Privacy access log** | Who viewed what PII field and why | `privacy_access_log` table |

#### Evidence Files (stored in Supabase Storage)

| File Type | Description | Storage Bucket |
|---|---|---|
| **Vehicle scan photo** | Photo taken at time of observation, SHA-256 hashed | `scans` |
| **Incident evidence photo** | Additional photos uploaded to an incident | `incident-evidence` |
| **COA document** | Officer's Certificate of Approval PDF | `credentials` |
| **Warrant document** | Officer's legal warrant PDF | `credentials` |

#### Generated Documents (PDF, on demand)

| Document | Triggered By | Contents |
|---|---|---|
| **Notice to Vacate** | Officer during scan or admin from portal | Zone details, vehicle plate, violation type, legal reference, officer name, date/time, signature block |
| **Incident Report** | Admin from Incident Management | Timeline of events, evidence photos, officer notes, GPS map, legal hold status |
| **Vehicle Report** | Admin from Vehicle Management | Full observation history, photo gallery, enforcement history, NZSCV/MotorWeb data |
| **Dashboard Report** | Admin from Reports Hub | KPIs, breach counts, zone activity, date-range summary |
| **Leadership Pack** | Admin from Reports Hub | Executive summary, breach trends, top offenders, compliance rate by zone, drift events, charts |
| **Compliance Export** | Admin from Data Management | CSV of all observations and compliance results for the selected period |

#### Analytics & Dashboards (live, in-browser)

| Dashboard | What It Shows |
|---|---|
| **Admin Portal** | Today's stats: scans, breaches, active officers, open alerts |
| **Compliance Dashboard** | Compliance rate by zone and period, drift detection, matrix version history |
| **Enforcement Command Centre** | Open breach alerts, enforcement actions in progress, escalation pipeline |
| **Hotspots Map** | GPS heatmap of where observations are densest — identifies most problematic zones |
| **Compliance Analytics** | Deep dive: breach type breakdown, monthly trends, repeat offender analysis |
| **Live Patrol Monitor** | Real-time map of all active officers with GPS positions |
| **Live Officer Tracking** | Per-officer activity: last seen, last scan, welfare status |
| **Data Integrity Dashboard** | Photo integrity, duplicate detection, orphaned records |

#### Automated Outputs (background jobs)

| Output | Trigger | Description |
|---|---|---|
| **Breach detection sweep** | Scheduled / on-demand | Scans all recent observations for violations, creates breach alerts |
| **Zone correction sweep** | Daily 3am NZT | GPS-corrects observations assigned to wrong zone |
| **Compliance recalculation** | On demand (admin) | Rebuilds all compliance results from scratch using current zone rules |
| **Welfare check** | Periodic | Sends automated check-in to officers; raises alert if no response |
| **Man-Down alert** | Automatic | Triggers if GPS is stationary for 15+ minutes with no acknowledgement |
| **ParkPow sync** | On demand | Syncs zones, vehicles, and violations to ParkPow platform |
| **Push notification** | On breach/alert | Sends Expo push to officer's device for assignments and alerts |

---

## 2. Executive Summary

FreedomCamp Manager is a web-based admin control centre for freedom camping
enforcement in New Zealand, operated by Iron Eagle Security / OnSpace AI. It provides:

| Capability | Description |
|---|---|
| **Live Patrol Monitoring** | Real-time GPS tracking of field officers on patrol |
| **Breach Management** | Automated detection & escalation of camping violations |
| **Zone Geofencing** | Polygon/circle-based compliance zones with per-zone rules |
| **Compliance Reporting** | Dashboards, KPIs, drift detection, leadership packs |
| **Vehicle Scanning (ALPR)** | Plate Recognizer + ORC/AI pipeline for plate recognition |
| **Officer Welfare** | Automated inactivity detection, Man-Down alerts, wellness checks |
| **Multi-Organisation** | 3-tier hierarchy: owner → service_provider → client |
| **Enforcement Workflow** | Warnings → Notices to Vacate → Escalation pipeline |
| **ParkPow Integration** | Parking enforcement platform sync |
| **Incident Management** | Court-ready evidence trails with legal holds |
| **Patrol Checkpoints** | QR/NFC checkpoint scanning for Lone Worker Protocol |
| **Privacy Curtain** | Auto-redaction & PII access logging (Privacy Act 2020) |
| **V1 AI Inference** | Vehicle embeddings, sticker detection, movement comparison |

### Clean Architecture Principles (v2)

The v2 rebuild applies strict separation of concerns to eliminate the root causes
of accumulated bugs:

1. **One pipeline, one table** — `alpr-process` is the single ALPR entrypoint.
   `observations` is the only operational table. `vehicle_observations_v2` is a
   legacy mirror — never write to or read from it for operational data.
2. **No observation queue** — `observation_jobs` has been permanently removed.
   The ALPR pipeline uses `observations.processing_status` directly.
3. **SECURITY DEFINER RPCs for privilege escalation** — `ensure_other_location_zone()`
   and `check_location_in_org()` exist precisely so officers can perform zone
   lookups without RLS escalation.
4. **Resilient triggers** — `sync_zone_to_matrix` wraps its matrix INSERT in an
   exception block so zone creation never fails due to matrix errors.
5. **Storage grants are additive** — always `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA
   storage` plus `ALTER DEFAULT PRIVILEGES` to cover future Supabase-added functions.
6. **Single compliance engine** — `calculate_vehicle_compliance_v3()` is the only
   compliance function. Never add a v4, v5, etc. — extend the existing function.

### User Roles

| Role | Access |
|---|---|
| `master` | Full system access, all orgs |
| `admin` | Organisation-scoped admin portal |
| `officer` | Field Officer Portal (mobile-optimised) |
| `admin_officer` | Dual-role: can switch between admin & field portals |

---

## 3. Tech Stack

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

## 4. Repository Layout

```
/
├── src/
│   ├── App.tsx                    # Root router with role-based guards
│   ├── main.tsx                   # Vite entry point
│   ├── pages/                     # 37+ page components
│   ├── components/
│   │   ├── ui/                    # shadcn/ui primitives (40+ components)
│   │   ├── features/              # 70+ app-specific feature components
│   │   └── layout/                # JDSLogo, ResponsiveContainer
│   ├── hooks/                     # 30+ custom React hooks
│   ├── stores/                    # Zustand stores
│   │   ├── authStore.ts           # Auth + session management
│   │   └── globalFiltersStore.ts  # Dashboard date/org/zone filters
│   ├── lib/                       # 22 utility modules
│   │   ├── supabase.ts            # Typed Supabase client
│   │   ├── fileUpload.ts          # Storage upload helpers
│   │   ├── geocoding.ts           # Reverse geocoding
│   │   ├── geofence.ts            # Point-in-polygon checks
│   │   ├── imageProcessing.ts     # Client-side image ops
│   │   ├── offlineStorage.ts      # IndexedDB offline queue
│   │   ├── privacyCurtain.ts      # Privacy Act 2020 redaction helpers
│   │   ├── pushNotifications.ts   # Expo push registration
│   │   ├── railway.ts             # Railway service health + helpers
│   │   └── timezone.ts            # NZ timezone helpers
│   └── types/
│       ├── database.ts            # Generated Supabase types
│       └── index.ts               # App-level type definitions
├── supabase/
│   ├── functions/                 # 47 Edge Functions (Deno/TypeScript)
│   │   └── _shared/               # CORS helpers (cors.ts, withCors.ts)
│   └── migrations/                # 105+ SQL migration files (YYYYMMDD_ prefix)
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

## 5. Environment Configuration

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

## 6. Database Schema

> **⚠️ IMPORTANT — COLUMN NAMES**: Many column names in the live database differ from
> early documentation. Always use the names shown here, not names from older docs.

### PostgreSQL Extensions Required

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";        -- UUID generation
CREATE EXTENSION IF NOT EXISTS "postgis";           -- Geospatial queries
CREATE EXTENSION IF NOT EXISTS "vector";            -- pgvector for embeddings
CREATE EXTENSION IF NOT EXISTS "pg_cron";           -- Scheduled jobs
```

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

> **⚠️ Column names** — use `self_contained_required`, `nights_per_month`,
> `max_consecutive_nights`, `day_visit_only`, `allowed_days`. The old names
> (`requires_self_contained`, `max_nights_per_month`, `is_day_visit_only`) no
> longer match the live schema.

| Column | Type | Description |
|---|---|---|
| id | uuid PK | |
| name | text | Zone display name |
| description | text | Optional description |
| zone_type | text | `general`, `enforcement`, `restricted`, etc. |
| parent_zone_id | uuid FK | Parent zone (zone hierarchy) |
| organization_id | uuid FK | |
| geometry | jsonb | GeoJSON geometry (Polygon or Point) |
| geofence_type | text | `polygon` or `circle` |
| geofence_radius | numeric | Radius in metres (circle type) |
| latitude | numeric | Centre point |
| longitude | numeric | Centre point |
| day_visit_only | boolean | No overnight stays |
| nights_per_month | integer | Monthly night limit |
| max_consecutive_nights | integer | Max consecutive nights |
| self_contained_required | boolean | Vehicle must be NZSCV certified |
| allowed_days | jsonb | `["monday","tuesday",...]` — null = all days |
| permitted_hours_start | time | Allowed arrival time |
| permitted_hours_end | time | Must leave by |
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
Individual vehicle sightings — **the only operational table** for ALPR data.

> **⚠️ NEVER use `vehicle_observations_v2` for operational queries.** That table
> is a legacy mirror only. All writes and reads go through `observations`.
>
> **⚠️ `observation_jobs` has been permanently removed.** Use
> `observations.processing_status` to track ALPR pipeline state.

| Column | Type | Description |
|---|---|---|
| id | uuid PK | |
| idempotency_key | text UNIQUE | Prevents duplicate uploads |
| plate_number | text | Observed plate |
| zone_id | uuid FK | Where observed |
| organization_id | uuid FK | |
| recorded_at | timestamptz | When observed (NZ timezone) |
| recorded_by | uuid FK | Officer who scanned |
| latitude | numeric | GPS lat |
| longitude | numeric | GPS lng |
| gps_accuracy | numeric | Accuracy in metres |
| location_confidence | text | `high`, `medium`, `low` |
| photo_url | text | Evidence photo URL |
| photo_hash | text | SHA-256 for integrity |
| photo_source | text | `camera`, `upload`, `stream` |
| exif_data | jsonb | Photo metadata |
| plate_source | text | `plate_recognizer`, `manual`, `stream` |
| vehicle_type | text | Detected vehicle type |
| vehicle_make | text | |
| vehicle_model | text | |
| vehicle_colour | text | |
| vehicle_year | integer | Approximate year (from OpenAI Vision) |
| is_compliant | boolean | Compliance result |
| compliance_summary | jsonb | Immutable audit trail |
| processing_status | text | `pending`, `processing`, `complete`, `failed` |
| weather_description | text | Conditions at time of scan |
| evidence_state | text | `original_present`, `legacy_no_photo`, etc. |
| parkpow_session_id | text | ParkPow session |
| parkpow_violation_id | text | ParkPow violation |
| incident_id | uuid FK → incidents | Optional parent incident/case |
| **ALPR Confidence** | | |
| plate_confidence | real | Confidence (0–1) for recognised plate |
| vehicle_make_confidence | real | Confidence (0–1) for make inference |
| vehicle_model_confidence | real | Confidence (0–1) for model inference |
| vehicle_color_confidence | real | Confidence (0–1) for colour inference |
| **V1 Inference — Sticker Detection** | | |
| sticker_presence | boolean (nullable) | `true`=present, `false`=absent, `null`=inconclusive |
| sticker_color | text | `blue`, `green`, or `unknown` (CHECK constrained) |
| sticker_bbox | jsonb | `{x, y, width, height}` pixel bounding box |
| sticker_detection_confidence | real | Confidence for sticker presence |
| sticker_color_confidence | real | Confidence for sticker colour |
| **V1 Inference — Movement Comparison** | | |
| previous_observation_id | uuid FK → observations | Reference frame for movement |
| movement_moved | boolean (nullable) | `true`=moved, `false`=stationary, `null`=not run |
| movement_background_similarity | real | Background SSIM score (0–1) |
| movement_vehicle_bbox_iou | real | Vehicle bbox overlap (0–1) |
| movement_decision | text | `moved`, `stationary`, or `inconclusive` |
| **V1 Inference — Embeddings** | | |
| vehicle_embedding | vector(384) | MobileNetV3 384-D feature fingerprint |
| embedding_quality | real | L2-norm-derived quality score (0–1) |
| embedding_model_version | text | e.g. `yolov8n_mobilenetv3_v1.0` |
| embedding_created_at | timestamptz | When embedding was generated |

> **Sticker constraint**: `sticker_color` is constrained to `('blue', 'green', 'unknown')`.
> When `sticker_presence IS NULL`, `sticker_color` **must** be `'unknown'`.

#### `vehicle_monthly_stays`
Calendar-month aggregation per vehicle per zone.

| Column | Type | Description |
|---|---|---|
| id | uuid PK | |
| plate_number | text | |
| zone_id | uuid FK | |
| month | date | First of month |
| nights_stayed | integer | Total nights |
| consecutive_nights | integer | Max consecutive nights |
| last_seen_at | timestamptz | |

#### `zone_compliance_matrix`
Versioned compliance rules per zone — enables drift detection.
Kept in sync with the `zones` table via the `sync_zone_to_matrix` trigger (resilient
— trigger errors are warnings, never abort the zone INSERT).

| Column | Type | Description |
|---|---|---|
| id | uuid PK | |
| zone_id | uuid FK | |
| organization_id | uuid FK | |
| version | integer | Auto-incremented |
| self_contained_required | boolean | |
| requires_csc | boolean | Mirror of self_contained_required |
| nights_per_month | integer | |
| max_consecutive_nights | integer | |
| day_visit_only | boolean | |
| allowed_days | jsonb | |
| effective_from | timestamptz | |
| effective_to | timestamptz | NULL = current |
| created_by | uuid FK | |
| change_reason | text | e.g. `auto_created_with_zone` |
| change_notes | text | |

#### Compliance fields on `observations`
Per-observation compliance is stored directly on the `observations` row.

| Column | Type | Description |
|---|---|---|
| is_compliant | boolean | Final compliance verdict |
| breach_type | text | Primary breach category |
| breach_reason | text | Human-readable explanation |
| nights_stayed_this_month | integer | Monthly nights counter used by rules |
| consecutive_nights | integer | Consecutive nights counter used by rules |

#### `breach_alerts`
Non-compliant observations escalated for enforcement.

> **⚠️ Correct status values**: `pending` → `acknowledged` → `enforcement_started`
> → `resolved` or `dismissed` (NOT `notified` or `escalated`).
>
> **⚠️ Correct breach types**: `consecutive_nights`, `monthly_limit`,
> `self_contained`, `after_hours`, `day_visit_violation`, `allowed_days_violation`
> (NOT `overstay`, `no_self_contained`, etc.).

| Column | Type | Description |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid FK | |
| zone_id | uuid FK | |
| plate_number | text FK | |
| observation_id | uuid FK | |
| patrol_id | uuid FK | |
| breach_type | text CHECK | `consecutive_nights`, `monthly_limit`, `self_contained`, `after_hours`, `day_visit_violation`, `allowed_days_violation` |
| breach_details | jsonb | `{message, severity, consecutiveNights, ...}` |
| due_date | date | |
| notification_sent | boolean | |
| notification_method | text | |
| notified_at | timestamptz | |
| notified_by | uuid FK | |
| status | text CHECK | `pending`, `acknowledged`, `enforcement_started`, `resolved`, `dismissed` |
| resolution_notes | text | |
| resolved_at | timestamptz | |
| assigned_to | uuid FK | |
| assigned_at | timestamptz | |
| assigned_by | uuid FK | |
| admin_reviewed_by | uuid FK | |
| admin_reviewed_at | timestamptz | |
| admin_review_notes | text | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

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
ALPR-processed incidents with evidence and legal holds. Observations can be linked
to an incident via `observations.incident_id`.

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

#### `patrol_checkpoints`
QR/NFC checkpoint definitions for Lone Worker Protocol
(Health & Safety at Work Act 2015).

| Column | Type | Description |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid FK | |
| zone_id | uuid FK (nullable) | |
| name | text | |
| description | text | |
| location_lat | double precision | |
| location_lng | double precision | |
| qr_code | text UNIQUE | Encoded QR payload / URL |
| nfc_tag_id | text | NFC tag UID (optional) |
| is_active | boolean | |
| required_on_patrol | boolean | |
| check_in_radius_metres | integer | Default 50m |
| created_by | uuid FK | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

#### `checkpoint_visits`
Immutable append-only check-in records (chain-of-custody evidence).

| Column | Type | Description |
|---|---|---|
| id | uuid PK | |
| checkpoint_id | uuid FK | |
| officer_id | uuid FK | |
| patrol_id | uuid FK (nullable) | |
| organization_id | uuid FK | |
| scan_method | text CHECK | `qr_camera`, `nfc`, `manual_code`, `url_deep_link` |
| gps_latitude | double precision | |
| gps_longitude | double precision | |
| gps_accuracy | double precision | |
| gps_distance_from_checkpoint | double precision | |
| within_radius | boolean | Set by app layer on insert |
| visited_at | timestamptz | |
| notes | text | |
| created_at | timestamptz | |

#### `officer_welfare_settings`
Auto-logoff & wellness thresholds. Includes Man-Down detection.

| Column | Type | Description |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid FK | |
| inactivity_threshold_minutes | integer | |
| wellness_check_interval_minutes | integer | |
| man_down_enabled | boolean | Default `true` |
| man_down_stationary_minutes | integer | Default 15 — GPS stationary threshold |
| man_down_escalation_minutes | integer | Default 5 — Time before critical escalation |
| created_at | timestamptz | |
| updated_at | timestamptz | |

#### `officer_welfare_alerts`
Triggered welfare notifications. Alert types include Man-Down.

| Column | Type | Description |
|---|---|---|
| id | uuid PK | |
| officer_id | uuid FK | |
| organization_id | uuid FK | |
| alert_type | text CHECK | `inactivity`, `gps_lost`, `manual`, `investigation_overdue`, `man_down` |
| triggered_at | timestamptz | |
| acknowledged_at | timestamptz | |
| acknowledged_by | uuid FK | |
| resolved_at | timestamptz | |
| notes | text | |

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

#### `privacy_curtain_settings`
Per-org Privacy Act 2020 auto-redaction configuration.

| Column | Type | Description |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid UNIQUE FK | |
| auto_redact_enabled | boolean | |
| redact_owner_name | boolean | |
| redact_owner_address | boolean | |
| redact_phone_number | boolean | |
| redact_plate_in_exports | boolean | |
| require_reason_for_unredact | boolean | |
| unredact_roles | text[] | Default `['admin', 'master']` |
| created_at | timestamptz | |
| updated_at | timestamptz | |

#### `privacy_access_log`
Immutable PII field access audit log (Privacy Act 2020 s22–s27).

| Column | Type | Description |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid FK | |
| actor | uuid FK → user_profiles | |
| target_table | text | e.g. `observation`, `incident` |
| target_record_id | text | |
| field_accessed | text | Name of the PII field accessed |
| access_reason | text | Required when `require_reason_for_unredact` is true |
| ip_address | inet | |
| user_agent | text | |
| accessed_at | timestamptz | |

#### `record_access_log`
Privacy Act 2020 – who viewed each record and when.

| Column | Type | Description |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → auth.users | |
| organization_id | uuid FK | |
| record_type | text | `observation`, `incident`, `vehicle`, `breach_alert` |
| record_id | uuid | |
| accessed_at | timestamptz | |
| ip_address | text | |
| user_agent | text | |

#### Additional Tables

| Table | Purpose |
|---|---|
| `person_observations` | Links persons to vehicles/zones |
| `welfare_alerts` | Triggered welfare notifications (legacy — prefer `officer_welfare_alerts`) |
| `alert_queue` | Priority-based notification queue |
| `drift_events` | Compliance matrix change tracking |
| `admin_recalculation_actions` | Audit trail for compliance recalcs |
| `photo_metadata` | Evidence photo metadata |
| `plate_scans` | Raw ALPR scan results |
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

### Deprecated Tables (do NOT recreate)

| Table | Reason |
|---|---|
| `vehicle_observations_v2` | Legacy mirror — `observations` is the source of truth |
| `vehicle_records` | Merged into `canonical_vehicles` |
| `flagged_vehicles` | Merged into `canonical_vehicles.is_flagged` |
| `observation_jobs` | Removed — use `observations.processing_status` |
| `canonical_vehicles_backup_20250203` | Old backup only |

### Key Relationships

```
organizations (1) ──→ (N) user_profiles
organizations (1) ──→ (N) zones
organizations (1) ──→ (N) observations

zones (1) ──→ (N) observations
zones (1) ──→ (N) zone_compliance_matrix (versioned, auto-synced via trigger)
zones (1) ──→ (1) zone_legal_config
zones (1) ──→ (N) patrol_checkpoints

canonical_vehicles (1) ──→ (N) observations (via plate_number)
canonical_vehicles (1) ──→ (N) vehicle_monthly_stays

observations (1) ──→ (0..1) breach_alerts (if non-compliant)
observations (N) ──→ (1) incidents (via incident_id)
observations (1) ──→ (1) previous_observation (via previous_observation_id)
breach_alerts (1) ──→ (N) enforcement_actions
breach_alerts (1) ──→ (N) notices_to_vacate

user_profiles (1) ──→ (N) patrols
user_profiles (1) ──→ (N) observations (recorded_by)
user_profiles (1) ──→ (N) checkpoint_visits

patrols (1) ──→ (N) checkpoint_visits
patrol_checkpoints (1) ──→ (N) checkpoint_visits
```

---

## 7. Row-Level Security & Auth Model

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

## 8. Supabase Edge Functions

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

## 9. Frontend Architecture

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

## 10. Railway Services (Already Built)

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

## 11. External Integrations

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

## 12. Feature Flags & Phased Rollout

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

## 13. Build & Deployment

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

## 14. Step-by-Step Rebuild Instructions

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
3. **Run migrations in chronological order by date prefix** (`YYYYMMDD_*` naming,
   70+ SQL files under `supabase/migrations/`). Use `supabase db push` to apply
   all migrations in order, or run them manually sorted by filename.
   - Start with core tables: organizations, user_profiles, zones
   - Then: canonical_vehicles, observations, zone_compliance_matrix
   - Then: breach_alerts, enforcement_actions, notices_to_vacate
   - Then: patrols, incidents, health_safety_reports
   - Then: supporting tables (audit_log, bug_reports, etc.)
   - Finally: RLS policies, triggers, helper functions

   > **⚠️ CRITICAL**: The `vehicle_observations_v2` table is a mirror/backup only.
   > All operational queries must target the `observations` table. Never use
   > `vehicle_observations_v2` for search, queries, or inserts.

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

## 15. Learnings & Pitfalls

### Critical Lessons from the Current Build

1. **Never query `vehicle_observations_v2`** — it is a legacy mirror only.
   All operational writes and reads must target the `observations` table.

2. **`observation_jobs` has been permanently removed** — do not recreate it.
   The ALPR pipeline tracks state via `observations.processing_status`. The values
   are `pending`, `processing`, `complete`, `failed`.

3. **Zone column names are different from early docs** — see the `zones` table in
   Section 6 for the exact column names. The old names (`requires_self_contained`,
   `max_nights_per_month`, `is_day_visit_only`) do not exist in the live schema.

4. **Breach alert status values** — the CHECK constraint allows only:
   `pending`, `acknowledged`, `enforcement_started`, `resolved`, `dismissed`.
   The old values `notified` and `escalated` do not exist.

5. **Breach alert type values** — the CHECK constraint allows only:
   `consecutive_nights`, `monthly_limit`, `self_contained`, `after_hours`,
   `day_visit_violation`, `allowed_days_violation`. Old type names will be rejected.

6. **`vehicle_embedding` not `embedding_384`** — the vector column in `observations`
   is named `vehicle_embedding vector(384)`. Always pass it as a native JS number
   array — never `JSON.stringify()` it.

7. **`ensure_other_location_zone()` is the fallback zone RPC** — when a scan GPS
   is outside all known zone geofences, call this SECURITY DEFINER RPC to get or
   create the "Other Location" zone for the org. Never insert directly into `zones`
   from the officer client (RLS blocks it).

8. **`sync_zone_to_matrix` trigger is resilient** — it wraps its matrix INSERT in
   an exception block. Trigger errors produce a WARNING log entry but never abort
   the zone INSERT. Zone creation is always more important than the auto-sync.
   Admins can reconcile the matrix separately.

9. **Storage 403 (`mark_object_ref`)** — when Supabase's "Database References"
   (Object Reference Tracking) feature is enabled on a bucket, it creates an internal
   trigger that calls `storage.mark_object_ref()`. The `authenticated` role must have
   EXECUTE on this function or all inserts to that table will return HTTP 403. Fix:
   ```sql
   GRANT USAGE ON SCHEMA storage TO authenticated;
   GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA storage TO authenticated;
   ALTER DEFAULT PRIVILEGES IN SCHEMA storage GRANT EXECUTE ON FUNCTIONS TO authenticated;
   ```
   The `ALTER DEFAULT PRIVILEGES` line is essential — it covers functions added by
   Supabase in future (e.g. when a new bucket feature is enabled via the Dashboard).

10. **`supabase config push --include-all` can break PostgREST** — this flag pushes the
    `[api]` section from `config.toml` to the remote project, which can trigger a
    PostgREST schema cache reload. If a trigger (e.g. `sync_zone_to_matrix`) has a bug
    at that moment, RPCs that insert into those tables will fail. After deploying config
    changes, always verify key RPCs (especially `ensure_other_location_zone`) still work.

11. **TypeScript config must stay lenient** — `strict: false`, `noImplicitAny: false`,
    `strictNullChecks: false`. The codebase has 600+ pre-existing TS errors under strict
    mode. Do not tighten these settings; `vite build` succeeds even when `tsc -b` fails.

12. **Timezone is always NZ** — `Pacific/Auckland`. Every datetime operation must
    account for this. The Supabase client sends `X-Client-Timezone: Pacific/Auckland`
    on every request. Use `nz_now()` in SQL instead of `now()` where timezone matters.

13. **RLS helper functions need exception handlers** — wrap all `SELECT` queries in
    `EXCEPTION WHEN invalid_text_representation OR data_exception` to prevent bad data
    from crashing policy evaluation and locking users out.

14. **Migrations must be idempotent** — use `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE
    IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, and `information_schema` checks before
    any `ALTER TABLE`. Every migration must be safe to re-run.

15. **CORS has two modes** — `cors.ts` (wildcard `*`, dev only) and `withCors.ts`
    (production allowlist). All Edge Functions must handle `OPTIONS` preflight with a
    `200 OK` response before any auth or body parsing.

16. **Edge Function auth pattern** — always check `Authorization` header starts with
    `Bearer `. Use `SUPABASE_SERVICE_ROLE_KEY` for server-side DB operations that must
    bypass RLS. Never expose the service role key to the browser.

17. **`sticker_presence = null` requires human review** — never auto-approve compliance
    when the sticker result is inconclusive. Always surface these observations for officer
    review before making a compliance decision.

18. **Models are baked into Docker** — the inference-service exports ONNX models during
    the Docker build (Python stage). There are no external download URLs. Rebuild the
    Docker image if models need updating.

19. **GPS accuracy is 15m** — the geofence system uses a 15-metre threshold (not 5m) to
    account for GPS inaccuracy on mobile devices in urban/coastal environments.

20. **Session management prevents duplicate logins** — the login flow checks for an
    existing active session. `forceLogin()` terminates the existing session before
    creating a new one. This prevents ghost sessions blocking officers from logging in.

21. **NZSCV is source of truth** — for self-contained vehicle status, the NZSCV registry
    overrides AI sticker detection. AI detection is a fast pre-check only.

22. **Photo evidence is mandatory** — no observation can exist without a verifiable photo.
    The `evidence_state` column tracks integrity: `original_present`, `legacy_no_photo`,
    `hash_mismatch`, etc.

23. **Compliance matrix is versioned** — every change to zone rules auto-creates a new
    matrix version (via the `sync_zone_to_matrix` trigger). Compliance results reference
    the matrix version used, providing a full audit trail for rule-change disputes.

24. **Offline-first design** — the Field Officer Portal uses IndexedDB for the offline
    queue. Scans queue locally and sync automatically when connectivity returns. The
    `useOfflineQueue` hook manages this with statuses `pending`, `syncing`, `synced`,
    `failed`.

25. **PWA is critical** — officers use the app in the field on mobile devices. The
    install prompt, update notification, and "Keep Screen Awake" feature are essential
    for operational use. Do not remove these without user testing.

26. **No root package.json is committed** — if missing after clone, create it:
    ```json
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
    ```

27. **Security DEFINER RPCs only grant to `authenticated`** — never grant EXECUTE
    on sensitive SECURITY DEFINER functions to `anon`. See `ensure_other_location_zone`
    and `check_location_in_org` for the correct pattern.

### Security Considerations

- All Edge Functions validate auth tokens before processing
- RLS policies enforce org-scoped data isolation
- Proxy server authenticates via shared secret (`X-Proxy-Secret`)
- CORS allowlist in production prevents unauthorised origins
- Photo hashing (SHA-256) ensures evidence integrity
- Legal hold flag on incidents prevents accidental deletion
- User deactivation is queued (not immediate) to prevent auth.users table issues
- Privacy access log records every PII field access (Privacy Act 2020 compliance)
- `sticker_presence = null` always requires human review — never auto-approve

### Performance Notes

- Core indexes on `observations`: `recorded_at`, `org_id`, `zone_id`, `plate_number`, GPS
- IVFFlat index on `vehicle_embedding` for fast top-K similarity search
- Compliance recalculation runs in batches to avoid timeout
- ALPR processing has 10s timeout; inference has separate 15s timeout
- Edge Functions use `SUPABASE_SERVICE_ROLE_KEY` to bypass RLS for admin operations
- `get_admin_dashboard_stats()` is a pre-computed RPC, not a live aggregate query

---

## Appendix A: Complete Page Inventory

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
- PatrolCheckpointManagement
- PrivacyCurtain
- SystemDiagnostics

### Field Officer Pages
- FieldOfficerPortal (multi-view: dashboard, scanning, reports, history, settings)

### Shared Pages
- Login, PortalSelection
- Settings, Profile

## Appendix B: Supabase Storage Buckets

| Bucket | Purpose | RLS | Access |
|---|---|---|---|
| `evidence` | Vehicle observation photos | Scoped to officer's org | Auth only |
| `incident-evidence` | Incident report photos & documents | Scoped to user UUID path | Auth only |
| `credentials` | COA/Warrant documents | Scoped to user | Auth only |
| `scans` | Field officer scan photos | Public read; auth write | Public read |

> **⚠️ Storage 403 fix** — when enabling "Database References" (Object Reference Tracking)
> on a bucket in the Supabase Dashboard, always run:
> ```sql
> GRANT USAGE ON SCHEMA storage TO authenticated;
> GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA storage TO authenticated;
> ALTER DEFAULT PRIVILEGES IN SCHEMA storage GRANT EXECUTE ON FUNCTIONS TO authenticated;
> ```
> This prevents HTTP 403 errors caused by the `storage.mark_object_ref()` function not
> having EXECUTE permission for the `authenticated` role.

## Appendix C: Scheduled Jobs (pg_cron)

| Schedule | Function | Purpose |
|---|---|---|
| Daily 3am NZT | `correct-zone-assignments` | GPS zone correction |
| Periodic | `monitor-officer-welfare` | Welfare check & auto-logoff |
| Periodic | `check-almost-breaches` | Overnight breach prediction |

## Appendix D: RPC Functions (PostgreSQL)

| Function | Signature | Purpose |
|---|---|---|
| `nz_now()` | `() → timestamptz` | Current NZ time (`Pacific/Auckland`) |
| `get_admin_dashboard_stats()` | `(org_id, from, to) → jsonb` | KPI aggregations for admin dashboard |
| `get_zones_with_activity()` | `(org_id, from, to) → table` | Zones with recent observations + counts |
| `match_vehicle()` | `(obs_id, k, since, org_id, zone_id, min_quality) → table` | Top-K visual similarity via pgvector |
| `get_my_scans_24h()` | `() → table` | Officer's own scans in the last 24 hours |
| `check_organization_compliance()` | `(org_id) → jsonb` | Org-level compliance summary |
| `calculate_vehicle_compliance_v3()` | `(plate, zone_id, obs_id, date) → table` | **Single compliance engine** |
| `evaluate_observation_requirements()` | `(obs_id) → table` | Per-requirement compliance breakdown |
| `ensure_other_location_zone()` | `(org_id) → uuid` | Get-or-create "Other Location" fallback zone (SECURITY DEFINER) |
| `check_location_in_org()` | `(org_id, lat, lon) → jsonb` | Check if GPS is inside any active org zone (SECURITY DEFINER) |
| `sync_zone_to_matrix()` | trigger function | Auto-creates matrix entry on zone INSERT/UPDATE (resilient) |

---

## 16. V1 Inference Contract

> This section documents the response fields produced by the Railway ORC/AI inference
> service (`POST /infer`) and how they map to columns in the `observations` table.
> See also `docs/INFERENCE_CONTRACT_V1.md` for the full specification.

### Inference Service Endpoint

```
POST /infer   (Railway inference-service, multipart/form-data or JSON)
GET  /health  (liveness check)
```

### Response Shape

```json
{
  "success": true,
  "data": {
    "embedding": [/* 384 floats — MobileNetV3 feature vector */],
    "embedding_quality": 0.82,
    "embedding_model_version": "yolov8n_mobilenetv3_v1.0",

    "detection": {
      "confidence": 0.91,
      "bbox": { "x": 120, "y": 40, "width": 320, "height": 200 },
      "class": 2
    },

    "plate_number": "ABC123",

    "vehicle_make":  "Toyota",
    "vehicle_model": "HiAce",
    "vehicle_colour": "White",
    "vehicle_make_confidence":  0.88,
    "vehicle_model_confidence": 0.76,
    "vehicle_colour_confidence": 0.91,

    "sticker": {
      "presence": true,
      "color": "blue",
      "bbox": { "x": 10, "y": 5, "width": 60, "height": 30 },
      "detection_confidence": 0.94,
      "color_confidence": 0.87
    },

    "movement": {
      "moved": false,
      "background_similarity": 0.96,
      "vehicle_bbox_iou": 0.91,
      "decision": "stationary"
    },

    "metadata": {
      "norm": 12.4,
      "dimension": 384,
      "processing_time_ms": 220
    }
  }
}
```

### Field → Database Column Mapping

| Inference field | `observations` column | Notes |
|---|---|---|
| `embedding` (array) | `vehicle_embedding` | 384-D vector, passed as native JS array |
| `embedding_quality` | `embedding_quality` | |
| `embedding_model_version` | `embedding_model_version` | |
| `detection.confidence` | `plate_confidence` | |
| `vehicle_make` | `vehicle_make` | |
| `vehicle_model` | `vehicle_model` | |
| `vehicle_colour` | `vehicle_colour` | Note: DB column is `vehicle_colour` |
| `vehicle_make_confidence` | `vehicle_make_confidence` | |
| `vehicle_model_confidence` | `vehicle_model_confidence` | |
| `vehicle_colour_confidence` | `vehicle_color_confidence` | Note: DB column uses `color` |
| `sticker.presence` | `sticker_presence` | nullable boolean: `null` = inconclusive |
| `sticker.color` | `sticker_color` | `blue`, `green`, or `unknown` |
| `sticker.bbox` | `sticker_bbox` | jsonb |
| `sticker.detection_confidence` | `sticker_detection_confidence` | |
| `sticker.color_confidence` | `sticker_color_confidence` | |
| `movement.moved` | `movement_moved` | nullable — null if not requested |
| `movement.background_similarity` | `movement_background_similarity` | |
| `movement.vehicle_bbox_iou` | `movement_vehicle_bbox_iou` | |
| `movement.decision` | `movement_decision` | `moved`, `stationary`, `inconclusive` |

### Critical Rules

1. **`sticker_presence = null` means "inconclusive"** — never auto-approve compliance
   when sticker result is null. Always surface for officer review.
2. **`sticker_color` must be `'unknown'` when `sticker_presence IS NULL`** — enforced
   by database CHECK constraint.
3. **Movement comparison is opt-in** — pass `previous_observation_id` in the
   `alpr-process` request body. If omitted, all movement columns remain `null`.
4. **Embeddings are native arrays** — pass `vehicle_embedding` as a JavaScript array,
   never as a `JSON.stringify()`-encoded string. The pgvector column accepts the array
   directly from the Supabase JS client.
5. **GPS stays with the phone** — GPS coordinates are always captured by the mobile app
   and never sourced from the inference service.
