# FreedomCamp Manager — System Overview & Build Review

> **Last updated**: March 2026
> **Purpose**: Complete system architecture reference with diagrams explaining what the build does, how data flows, and how all services connect.

---

## Table of Contents

1. [What This System Does](#1-what-this-system-does)
2. [High-Level Architecture](#2-high-level-architecture)
3. [Frontend Architecture](#3-frontend-architecture)
4. [Database Schema](#4-database-schema)
5. [Data Flow: Observation → Compliance → Breach](#5-data-flow-observation--compliance--breach)
6. [Edge Functions](#6-edge-functions)
7. [External Services & Integrations](#7-external-services--integrations)
8. [Build & Deployment Process](#8-build--deployment-process)
9. [CI/CD Pipelines](#9-cicd-pipelines)
10. [Authentication & Authorization](#10-authentication--authorization)

---

## 1. What This System Does

FreedomCamp Manager is a **web-based enforcement platform** for freedom camping compliance in New Zealand. It tracks vehicles at camping zones, detects rule violations (overstays, non-self-contained vehicles), and manages the enforcement workflow from detection to resolution.

```
┌──────────────────────────────────────────────────────────────────┐
│                    WHAT THE SYSTEM MANAGES                       │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  👮 Field Officers        → Patrol zones, scan vehicle plates    │
│  📷 Vehicle Scanning      → ALPR + AI photo recognition          │
│  🗺️  Zone Geofencing      → Per-zone rules (nights, SC required) │
│  📊 Compliance Engine     → Automated breach detection            │
│  ⚠️  Breach Management    → Warnings → Notices → Escalation      │
│  📈 Reporting             → Dashboards, KPIs, leadership packs   │
│  🏢 Multi-Organisation    → Owner → Provider → Client hierarchy  │
│  🛡️  Officer Welfare      → Inactivity detection, wellness checks│
│  🅿️  ParkPow Integration  → Parking enforcement platform sync    │
│  ⚖️  Incident Management  → Court-ready evidence with legal holds│
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### User Roles

| Role | Portal | Access Level |
|------|--------|-------------|
| `master` | Admin Portal | Full system access across all organisations |
| `admin` | Admin Portal | Organisation-scoped administration |
| `officer` | Field Officer Portal | Mobile-optimised scanning & patrols |
| `admin_officer` | Both Portals | Can switch between admin and field views |

---

## 2. High-Level Architecture

```mermaid
graph TB
    subgraph "Browser / Mobile"
        SPA["React SPA<br/>(Vite + TypeScript)"]
    end

    subgraph "Supabase Platform"
        AUTH["Supabase Auth"]
        DB["PostgreSQL Database<br/>(+ RLS Policies)"]
        STORAGE["Supabase Storage<br/>(evidence bucket)"]
        EDGE["Edge Functions<br/>(47 Deno functions)"]
        REALTIME["Supabase Realtime<br/>(live subscriptions)"]
    end

    subgraph "Railway Services"
        INFERENCE["Inference Service<br/>(YOLOv8 + MobileNetV3)"]
        PROXY["NZSCV Proxy Server<br/>(Express.js)"]
    end

    subgraph "External APIs"
        PLATEREC["Plate Recognizer<br/>(Cloud ALPR)"]
        NZSCV["NZSCV Registry<br/>(Self-Contained DB)"]
        MOTORWEB["MotorWeb<br/>(Vehicle Details)"]
        PARKPOW["ParkPow<br/>(Parking Enforcement)"]
    end

    SPA -->|"Auth tokens"| AUTH
    SPA -->|"CRUD + RPC"| DB
    SPA -->|"Photo uploads"| STORAGE
    SPA -->|"invoke()"| EDGE
    SPA -->|"subscribe()"| REALTIME

    EDGE -->|"Service role"| DB
    EDGE -->|"HTTP"| INFERENCE
    EDGE -->|"HTTP"| PROXY
    EDGE -->|"HTTP"| PLATEREC
    EDGE -->|"HTTP"| PARKPOW

    PROXY -->|"Whitelisted IP"| NZSCV
    PROXY -->|"API"| MOTORWEB

    INFERENCE -->|"ONNX models"| INFERENCE

    style SPA fill:#3b82f6,color:#fff
    style DB fill:#22c55e,color:#fff
    style EDGE fill:#a855f7,color:#fff
    style INFERENCE fill:#f97316,color:#fff
    style PROXY fill:#f97316,color:#fff
```

### Component Summary

| Component | Technology | Deployment | Purpose |
|-----------|-----------|-----------|---------|
| **React SPA** | React 18 + Vite + TypeScript | Static hosting | User interface |
| **Supabase** | PostgreSQL + Auth + Edge Functions | Supabase Cloud | Backend-as-a-service |
| **Inference Service** | Node.js + ONNX Runtime | Railway | AI vehicle detection & embeddings |
| **Proxy Server** | Express.js | Railway | Static IP for NZSCV API whitelist |

---

## 3. Frontend Architecture

### Tech Stack

```
┌─────────────────────────────────────────────────┐
│                   React SPA                      │
├─────────────────────────────────────────────────┤
│  UI Layer     │ shadcn/ui (33 Radix primitives) │
│  Styling      │ Tailwind CSS v3 + animations    │
│  Routing      │ React Router v6                  │
│  State        │ Zustand (auth + global filters)  │
│  Server State │ TanStack Query v5                │
│  Forms        │ react-hook-form + zod            │
│  Charts       │ Recharts                         │
│  Maps         │ Leaflet + React Leaflet          │
│  Build        │ Vite + SWC                       │
│  Package Mgr  │ bun                              │
└─────────────────────────────────────────────────┘
```

### Routing Map

```mermaid
graph LR
    subgraph "Public"
        LOGIN["/login"]
    end

    subgraph "Protected Routes"
        HOME["/"]
        ADMIN["/admin"]
        VEHICLES["/vehicles"]
        ZONES["/zones"]
        COMPLIANCE["/compliance"]
        BREACHES["/breaches"]
        INCIDENTS["/incidents"]
        REPORTS["/reports"]
        DATA["/data"]
        USERS["/users"]
        ORGS["/organizations"]
        TRACKING["/live-tracking"]
        DIAG["/diagnostics"]
        RECALC["/compliance-recalculation"]
    end

    LOGIN -->|"authenticate"| HOME

    HOME -->|"officer role"| FOP["FieldOfficerPortal"]
    HOME -->|"admin roles"| AP["AdminPortal"]

    ADMIN -->|"admin, admin_officer, master"| AP
    ZONES -->|"admin, admin_officer, master"| ZM["ZoneManagement"]
    DATA -->|"admin, master"| DM["DataManagement"]
    USERS -->|"admin, master"| UM["UserManagement"]
    ORGS -->|"master only"| OM["OrganizationManagement"]
    DIAG -->|"master only"| SD["SystemDiagnostics"]
    TRACKING -->|"admin, master"| LOT["LiveOfficerTracking"]
    RECALC -->|"admin, master"| CR["ComplianceRecalculation"]

    VEHICLES -->|"all roles"| VM["VehicleManagement"]
    COMPLIANCE -->|"all roles"| CD["ComplianceDashboard"]
    BREACHES -->|"all roles"| BA["BreachAlerts"]
    INCIDENTS -->|"all roles"| IM["IncidentManagement"]
    REPORTS -->|"admin, admin_officer, master"| RP["Reports"]

    style LOGIN fill:#ef4444,color:#fff
    style HOME fill:#3b82f6,color:#fff
    style FOP fill:#22c55e,color:#fff
    style AP fill:#8b5cf6,color:#fff
```

### Source Directory Layout

```
src/
├── main.tsx                 # Entry → React 18 createRoot
├── App.tsx                  # Router + auth guards + providers
├── index.css                # Tailwind base styles
│
├── pages/                   # 30 page components
│   ├── AdminPortal.tsx          Dashboard for admin/master
│   ├── FieldOfficerPortal.tsx   Mobile-first scanning interface
│   ├── VehicleManagement.tsx    Vehicle search & details
│   ├── ZoneManagement.tsx       CRUD zones with map
│   ├── ComplianceDashboard.tsx  Compliance metrics
│   ├── BreachAlerts.tsx         Breach list & resolution
│   ├── IncidentManagement.tsx   Incident tracking
│   ├── Reports.tsx              Report generation hub
│   ├── LiveOfficerTracking.tsx  Real-time GPS map
│   └── ...                      (20 more pages)
│
├── components/
│   ├── ui/                  # 33 shadcn/ui primitives
│   │   ├── button.tsx, dialog.tsx, form.tsx, table.tsx, ...
│   └── features/            # 65+ domain components
│       ├── PlateScanner.tsx, BreachCard.tsx, ZoneMap.tsx, ...
│
├── hooks/                   # 29 custom React hooks
│   ├── useVehicles.ts           canonical_vehicles CRUD
│   ├── usePatrols.ts            Patrol lifecycle management
│   ├── useBreaches.ts           Breach queries & resolution
│   ├── useZones.ts              Zone CRUD + stats
│   ├── useVehicleCompliance.ts  Compliance history
│   ├── usePlateScans.ts         ALPR scan management
│   ├── useIncidents.ts          Incident CRUD
│   └── ...                      (22 more hooks)
│
├── stores/                  # Zustand state stores
│   ├── authStore.ts             User session + role
│   └── globalFiltersStore.ts    Date/org/zone filters
│
├── lib/                     # 21 utility modules
│   ├── supabase.ts              Supabase client (NZ timezone)
│   ├── edgeFunctions.ts         Edge function caller wrapper
│   ├── fileUpload.ts            Storage upload helpers
│   ├── geocoding.ts             Reverse geocoding
│   └── ...                      (17 more utilities)
│
└── types/
    ├── database.ts              Generated Supabase DB types
    └── index.ts                 App-level type definitions
```

---

## 4. Database Schema

### Core Tables (Entity Relationship)

```mermaid
erDiagram
    organizations ||--o{ user_profiles : "employs"
    organizations ||--o{ zones : "manages"
    organizations ||--o{ observations : "owns"
    organizations ||--o{ breach_alerts : "has"
    organizations ||--o{ patrols : "schedules"
    organizations ||--o| organizations : "parent_of"

    zones ||--o{ observations : "recorded_in"
    zones ||--o{ breach_alerts : "flagged_in"
    zones ||--o{ patrols : "patrolled"

    canonical_vehicles ||--o{ observations : "plate_number"
    canonical_vehicles ||--o{ breach_alerts : "plate_number"

    user_profiles ||--o{ observations : "recorded_by"
    user_profiles ||--o{ patrols : "assigned_to"

    observations ||--o| breach_alerts : "triggers"

    organizations {
        uuid id PK
        string name
        enum organization_type "client | security_company"
        int organization_level
        uuid parent_organization_id FK
        string enforcement_workflow
        boolean is_active
    }

    user_profiles {
        uuid id PK
        string email
        string first_name
        string last_name
        enum role "master | admin | officer | admin_officer"
        uuid organization_id FK
        uuid employer_organization_id FK
        string[] authorized_work_locations
        string coa_number
        string warrant_number
        json last_location
        boolean is_active
    }

    zones {
        uuid id PK
        string name
        uuid organization_id FK
        float location_lat
        float location_lng
        geometry geom
        boolean day_visit_only
        int nights_per_month
        int max_consecutive_nights
        boolean self_contained_required
        string zone_type
        uuid parent_zone_id FK
        int parkpow_lot_id
    }

    canonical_vehicles {
        string plate_number PK
        uuid id
        string make
        string model
        boolean self_contained
        string homeless_status
        boolean is_flagged
        boolean is_exempt
        string profile_photo
        int total_observations
        int total_breaches
        int enforcement_count
        timestamp first_seen_at
        timestamp last_seen_at
    }

    observations {
        uuid id PK
        string idempotency_key UK
        string plate_number FK
        string photo_url
        timestamp recorded_at
        uuid zone_id FK
        uuid organization_id FK
        float gps_latitude
        float gps_longitude
        uuid recorded_by FK
        boolean is_compliant
        string breach_type
        int nights_stayed_this_month
        int consecutive_nights
    }

    breach_alerts {
        uuid id PK
        uuid organization_id FK
        uuid zone_id FK
        string breach_type
        json breach_details
        string status
        string plate_number
        uuid observation_id FK
        uuid assigned_to FK
        timestamp resolved_at
    }

    patrols {
        uuid id PK
        uuid organization_id FK
        uuid zone_id FK
        date patrol_date
        string shift
        uuid assigned_to FK
        string status "scheduled | in_progress | completed"
        timestamp checked_in_at
        timestamp completed_at
    }
```

### Table Purposes

| Table | Purpose | Key Relationships |
|-------|---------|-------------------|
| **organizations** | Multi-tenant hierarchy (owner → provider → client) | Parent-child self-reference |
| **user_profiles** | All users with roles, credentials, permissions | Belongs to organization |
| **zones** | Geofenced camping areas with compliance rules | Belongs to organization |
| **canonical_vehicles** | Master vehicle record (one per plate) | Aggregates from observations |
| **observations** | Individual vehicle sightings with GPS + photo | Links vehicle → zone → officer |
| **breach_alerts** | Compliance violations requiring action | Links observation → zone → vehicle |
| **patrols** | Officer patrol assignments and check-ins | Links officer → zone |

### Additional Tables (via Migrations)

The 82 SQL migrations define additional tables not in the TypeScript type definitions, including:

| Table | Purpose |
|-------|---------|
| `compliance_results` | Cached compliance calculation results |
| `enforcement_actions` | Warnings, notices to vacate, escalations |
| `incidents` | Incident reports with evidence |
| `incident_attachments` | Photos/documents for incidents |
| `vehicle_observations_v2` | Mirror/backup of observations (not for queries) |
| `plate_scans` | Raw ALPR scan records |
| `drift_events` | Compliance rule change tracking |
| `admin_recalculation_actions` | Audit log for recalculations |
| `zone_compliance_matrix` | Per-zone compliance rules |
| `person_records` | Individual person tracking |
| `audit_logs` | System audit trail |

---

## 5. Data Flow: Observation → Compliance → Breach

This is the **core pipeline** of the system — how a vehicle sighting becomes a compliance check and potentially a breach alert.

### Step-by-Step Flow

```mermaid
sequenceDiagram
    participant Officer as 👮 Field Officer
    participant SPA as React SPA
    participant Storage as Supabase Storage
    participant Edge as Edge Functions
    participant Railway as Inference Service
    participant DB as PostgreSQL
    participant ALPR as Plate Recognizer

    Note over Officer,DB: STEP 1: Vehicle Scan

    Officer->>SPA: Takes photo of vehicle
    SPA->>Storage: Upload photo to "evidence" bucket
    SPA->>Edge: vehicle-ingest (photo URL + GPS + metadata)
    Edge->>Edge: Deduplicate by idempotency key
    Edge->>Railway: POST /infer (photo for AI detection)
    Railway-->>Edge: Vehicle bounding box + embedding
    Edge->>ALPR: Plate recognition (if AI insufficient)
    ALPR-->>Edge: Plate number + confidence
    Edge->>DB: INSERT into observations
    Edge->>DB: UPSERT into canonical_vehicles

    Note over Officer,DB: STEP 2: Compliance Check

    Edge->>DB: Query zone rules (nights_per_month, max_consecutive, SC required)
    Edge->>DB: Count prior observations this month for same plate + zone
    Edge->>Edge: Calculate compliance (nights stayed vs limits)
    Edge->>DB: INSERT into compliance_results

    Note over Officer,DB: STEP 3: Breach Detection

    alt Non-compliant
        Edge->>DB: INSERT into breach_alerts
        Edge->>SPA: Return breach notification
        SPA->>Officer: Show breach alert on screen
    else Compliant
        Edge-->>SPA: Return compliant status
        SPA->>Officer: Show green checkmark
    end

    Note over Officer,DB: STEP 4: Enforcement (if breach)

    Officer->>SPA: Initiate enforcement action
    SPA->>Edge: generate-notice-to-vacate
    Edge->>DB: INSERT into enforcement_actions
    Edge-->>SPA: Generated PDF notice
```

### Compliance Rules Engine

```
┌─────────────────────────────────────────────────────────┐
│              ZONE COMPLIANCE RULES                       │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Each zone defines:                                      │
│                                                          │
│  ┌──────────────────────┬───────────────────────────┐   │
│  │ nights_per_month     │ Max nights in a calendar   │   │
│  │                      │ month (e.g., 3)            │   │
│  ├──────────────────────┼───────────────────────────┤   │
│  │ max_consecutive_     │ Max nights in a row        │   │
│  │ nights               │ (e.g., 2)                  │   │
│  ├──────────────────────┼───────────────────────────┤   │
│  │ self_contained_      │ Must vehicle be certified  │   │
│  │ required             │ self-contained? (T/F)      │   │
│  ├──────────────────────┼───────────────────────────┤   │
│  │ day_visit_only       │ No overnight stays (T/F)   │   │
│  ├──────────────────────┼───────────────────────────┤   │
│  │ allowed_days         │ Which days camping is      │   │
│  │                      │ permitted                  │   │
│  └──────────────────────┴───────────────────────────┘   │
│                                                          │
│  Breach Types:                                           │
│  • overstay            – Exceeded nights_per_month       │
│  • consecutive_days    – Exceeded max_consecutive_nights │
│  • no_self_contained   – Not certified in SC zone        │
│  • unauthorized_zone   – Camping in prohibited zone      │
│  • nights_exceeded     – General night limit violation    │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### Batch Recalculation Flow

```mermaid
flowchart TD
    A["Admin triggers recalculation<br/>(by zone, org, or full rebuild)"] --> B["recalculate-compliance<br/>Edge Function"]
    B --> C{"Scope?"}
    C -->|ZONE| D["Fetch all observations<br/>for selected zone"]
    C -->|ORG| E["Fetch all observations<br/>for all org zones"]
    C -->|BUILD| F["Fetch ALL observations<br/>system-wide"]

    D --> G["For each unique plate:"]
    E --> G
    F --> G

    G --> H["Count nights in zone<br/>this calendar month"]
    H --> I["Check consecutive nights"]
    I --> J["Check self-contained status"]
    J --> K{"Compliant?"}

    K -->|Yes| L["Write compliance_result<br/>(is_compliant = true)"]
    K -->|No| M["Write compliance_result<br/>(is_compliant = false)"]
    M --> N["Create breach_alert<br/>(with dedup check)"]
    N --> O["Update canonical_vehicles<br/>(total_breaches counter)"]

    L --> P["Done"]
    O --> P

    style A fill:#3b82f6,color:#fff
    style B fill:#a855f7,color:#fff
    style K fill:#eab308,color:#000
    style M fill:#ef4444,color:#fff
    style L fill:#22c55e,color:#fff
```

---

## 6. Edge Functions

The system has **47 Supabase Edge Functions** organized into these categories:

```mermaid
mindmap
  root((Edge Functions<br/>47 total))
    Vehicle & ALPR
      alpr-process
      alpr-retry
      vehicle-ingest
      analyze-vehicle-photo
      select-best-vehicle-photo
      duplicate-detection
    Observations
      observations-list
      observations-in-bounds
      observations-export
    Compliance & Breaches
      recalculate-compliance
      recalculate-compliance-v2
      cleanup-and-recalculate
      scan-breaches
      check-almost-breaches
      check-data-integrity
    Enforcement & Notices
      generate-notice-to-vacate
      generate-vehicle-report
    Reporting
      generate-dashboard-report
      generate-incident-pdf
      generate-leadership-pack
      get-compliance-statistics
      hotspot-data
    Admin & Users
      admin-incident-ops
      create-user
      update-user-password
      update-compliance-policy
    Integrations
      enrich-from-motorweb
      check-nzscv-status
      stream-webhook
      parkpow-sync
      orc-ingest
    Data Management
      import-data
      import-historical-data
      process-homeless-data
      check-zone-corrections
      correct-zone-assignments
    Utilities
      upload-file
      send-push-notification
      monitor-officer-welfare
      onspace-ai-chat
      suggest-new-zone
      zone-correction
      check-railway-health
```

### Key Edge Function Flows

| Function | Trigger | Input | Output |
|----------|---------|-------|--------|
| `vehicle-ingest` | Officer scan | Photo + GPS + plate | Observation + canonical vehicle |
| `alpr-process` | After photo upload | Photo URL | Plate number via AI/OCR |
| `recalculate-compliance` | Admin action | Scope (zone/org/build) | Updated compliance_results |
| `scan-breaches` | Scheduled / manual | Organization ID | New breach_alerts |
| `generate-notice-to-vacate` | Admin action | Breach ID | PDF document |
| `parkpow-sync` | Nightly cron | Action type | Synced lot/watchlist data |
| `monitor-officer-welfare` | Periodic | Officer ID | Welfare alert if inactive |

---

## 7. External Services & Integrations

```mermaid
graph LR
    subgraph "FreedomCamp Manager"
        EDGE["Edge Functions"]
        PROXY["Proxy Server<br/>(Railway)"]
        INFER["Inference Service<br/>(Railway)"]
    end

    subgraph "Vehicle Data"
        NZSCV["NZSCV Registry<br/>NZ Self-Contained<br/>Vehicle Database"]
        MOTORWEB["MotorWeb<br/>Vehicle Details<br/>(make/model/owner)"]
    end

    subgraph "Plate Recognition"
        PLATEREC["Plate Recognizer<br/>Cloud ALPR API"]
        ONNX["YOLOv8n + MobileNetV3<br/>(on-premise ONNX)"]
    end

    subgraph "Enforcement"
        PARKPOW["ParkPow<br/>Parking Platform<br/>(watchlists, violations)"]
    end

    subgraph "Communication"
        PUSH["Push Notifications<br/>(Web Push API)"]
    end

    EDGE -->|"plate photo"| PLATEREC
    EDGE -->|"plate photo"| INFER
    INFER -->|"ONNX inference"| ONNX
    EDGE -->|"plate lookup"| PROXY
    PROXY -->|"whitelisted IP"| NZSCV
    PROXY -->|"API call"| MOTORWEB
    EDGE -->|"sync lots/violations"| PARKPOW
    EDGE -->|"welfare alerts"| PUSH

    style EDGE fill:#a855f7,color:#fff
    style PROXY fill:#f97316,color:#fff
    style INFER fill:#f97316,color:#fff
    style PLATEREC fill:#06b6d4,color:#fff
    style NZSCV fill:#06b6d4,color:#fff
    style PARKPOW fill:#06b6d4,color:#fff
```

### Integration Details

| Service | Purpose | Connection Method |
|---------|---------|------------------|
| **Plate Recognizer** | Cloud ALPR — reads plate numbers from photos | Direct HTTP from Edge Functions |
| **Inference Service** | On-premise AI — YOLOv8n vehicle detection + MobileNetV3 embeddings | HTTP via Railway |
| **NZSCV Proxy** | Checks if vehicle is certified self-contained | Via proxy server (static IP required) |
| **MotorWeb** | NZ vehicle registration details (make, model, owner) | Via proxy server |
| **ParkPow** | Parking enforcement platform — watchlists, sessions, violations | Direct HTTP from Edge Functions |
| **Web Push** | Officer welfare alerts and breach notifications | Web Push API |

---

## 8. Build & Deployment Process

### Frontend Build Pipeline

```mermaid
flowchart LR
    A["Source Code<br/>(TypeScript + TSX)"] --> B["tsc -b<br/>(Type Check)"]
    B --> C["Vite Build<br/>(SWC compiler)"]
    C --> D["dist/<br/>(Static assets)"]
    D --> E["Deploy to<br/>Static Host"]

    style A fill:#3b82f6,color:#fff
    style B fill:#eab308,color:#000
    style C fill:#a855f7,color:#fff
    style D fill:#22c55e,color:#fff
    style E fill:#f97316,color:#fff
```

```
Build Commands:
──────────────────────────────────────────────────────
bun install          Install dependencies (bun.lock)
bun run build        tsc -b && vite build → dist/
bun run dev          Vite dev server (localhost:5173)
bun run lint         ESLint 9 flat config check
bun run preview      Preview production build
──────────────────────────────────────────────────────
```

### Inference Service Build (Multi-Stage Docker)

```mermaid
flowchart TD
    subgraph "Stage 0: Model Export"
        P1["Python 3.11-slim"] --> P2["Install ultralytics +<br/>PyTorch + torchvision"]
        P2 --> P3["Run export-models.py"]
        P3 --> P4["Output: yolov8n.onnx +<br/>mobilenet_v3.onnx"]
    end

    subgraph "Stage 1: Node Builder"
        N1["Node 18-slim"] --> N2["npm install"]
        N2 --> N3["Prune devDependencies"]
    end

    subgraph "Stage 2: Production"
        F1["Node 18-slim"] --> F2["Copy node_modules<br/>from Stage 1"]
        F2 --> F3["Copy ONNX models<br/>from Stage 0"]
        F3 --> F4["Copy server.js"]
        F4 --> F5["Run as non-root user<br/>(nodejs:1001)"]
        F5 --> F6["EXPOSE 3000<br/>HEALTHCHECK /health"]
    end

    P4 -.->|"models/"| F3
    N3 -.->|"node_modules/"| F2

    style P1 fill:#3b82f6,color:#fff
    style N1 fill:#22c55e,color:#fff
    style F1 fill:#f97316,color:#fff
    style F6 fill:#ef4444,color:#fff
```

### Deployment Targets

```
┌──────────────────────────────────────────────────────────┐
│                  DEPLOYMENT ARCHITECTURE                  │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  ┌─────────────┐    ┌──────────────┐    ┌────────────┐  │
│  │  React SPA  │    │   Supabase   │    │  Railway   │  │
│  │             │    │              │    │            │  │
│  │  Static     │    │  PostgreSQL  │    │ Inference  │  │
│  │  hosting    │◄──►│  Auth        │◄──►│ Service    │  │
│  │  (Vite      │    │  Edge Fns    │    │            │  │
│  │   build)    │    │  Storage     │    │ Proxy      │  │
│  │             │    │  Realtime    │    │ Server     │  │
│  └─────────────┘    └──────────────┘    └────────────┘  │
│                                                           │
│  Environment Variables Required:                          │
│  • VITE_SUPABASE_URL         (Frontend)                  │
│  • VITE_SUPABASE_ANON_KEY    (Frontend)                  │
│  • SUPABASE_SERVICE_ROLE_KEY (Edge Functions)            │
│  • RAILWAY_TOKEN             (CI/CD)                     │
│  • PROXY_SECRET              (Proxy Server auth)         │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

---

## 9. CI/CD Pipelines

```mermaid
flowchart TD
    subgraph "GitHub Actions Workflows"
        W1["deploy-edge-functions.yml<br/>Manual trigger"]
        W2["deploy-railway.yml<br/>Push to main (inference-service/)"]
        W3["run-migrations.yml<br/>Manual trigger"]
        W4["extract-schema.yml<br/>Manual trigger"]
        W5["parkpow-sync.yml<br/>Nightly 2AM UTC + manual"]
    end

    W1 -->|"Supabase CLI"| E1["Deploy 1 or all<br/>Edge Functions"]
    W2 -->|"Railway CLI"| R1["Deploy Inference<br/>Service + health check"]
    W3 -->|"supabase db push"| M1["Apply pending<br/>SQL migrations"]
    W4 -->|"pg_dump"| S1["Extract schema<br/>→ artifact + branch"]
    W5 -->|"HTTP call"| P1["Invoke parkpow-sync<br/>Edge Function"]

    subgraph "Secrets Required"
        SEC1["SUPABASE_ACCESS_TOKEN"]
        SEC2["SUPABASE_PROJECT_REF"]
        SEC3["RAILWAY_TOKEN"]
        SEC4["RAILWAY_SERVICE_ID"]
        SEC5["PG connection creds"]
    end

    style W1 fill:#a855f7,color:#fff
    style W2 fill:#f97316,color:#fff
    style W3 fill:#22c55e,color:#fff
    style W4 fill:#3b82f6,color:#fff
    style W5 fill:#eab308,color:#000
```

### Workflow Summary

| Workflow | Trigger | What It Does |
|----------|---------|-------------|
| **deploy-edge-functions** | Manual | Deploys one or all 47 Edge Functions via Supabase CLI |
| **deploy-railway** | Push to `main` (inference-service changes) OR manual | Builds + deploys inference service to Railway, verifies health |
| **run-migrations** | Manual | Applies pending SQL migrations to Supabase PostgreSQL |
| **extract-schema** | Manual | Dumps current DB schema for documentation/audit |
| **parkpow-sync** | Nightly 2AM UTC + manual | Syncs parking lot data, watchlists, violations with ParkPow |

---

## 10. Authentication & Authorization

```mermaid
flowchart TD
    A["User visits app"] --> B{"Has session?"}
    B -->|No| C["Show Login page"]
    B -->|Yes| D["Restore session<br/>from Supabase Auth"]

    C --> E["Email + Password<br/>→ supabase.auth.signInWithPassword"]
    E --> F["Fetch user_profiles<br/>for role + org"]
    F --> G["Store in Zustand<br/>(authStore)"]

    D --> G

    G --> H{"User role?"}
    H -->|officer| I["FieldOfficerPortal<br/>(mobile-optimised)"]
    H -->|admin| J["AdminPortal<br/>(dashboard)"]
    H -->|admin_officer| K["Portal Selection<br/>(choose mode)"]
    H -->|master| L["AdminPortal<br/>(full access)"]

    subgraph "Route Guards"
        M["ProtectedRoute<br/>checks isAuthenticated"]
        N["RoleRoute<br/>checks allowedRoles[]"]
    end

    G --> M
    M --> N
    N --> O["Render page<br/>or redirect"]

    style C fill:#ef4444,color:#fff
    style G fill:#3b82f6,color:#fff
    style I fill:#22c55e,color:#fff
    style J fill:#8b5cf6,color:#fff
```

### Row-Level Security (RLS)

All database access is governed by PostgreSQL RLS policies:

```
┌─────────────────────────────────────────────────────────┐
│                   RLS POLICY MODEL                       │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  master role      → Can see ALL data across ALL orgs     │
│  admin role       → Can see data for OWN organisation    │
│                     + child organisations                │
│  officer role     → Can see data for assigned zones      │
│                     within own organisation              │
│  admin_officer    → Same as admin (uses admin policies)  │
│                                                          │
│  Service Role Key → Bypasses all RLS (Edge Functions)    │
│                                                          │
│  Special handling:                                       │
│  • authorized_work_locations limits officer zone access  │
│  • employer_organization_id for security company staff   │
│  • EXCEPTION handlers for bad data in RLS functions      │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

---

## Quick Reference

### Key Files

| File | Purpose |
|------|---------|
| `src/App.tsx` | Main router, auth guards, providers |
| `src/stores/authStore.ts` | Authentication state (Zustand) |
| `src/lib/supabase.ts` | Supabase client (NZ timezone) |
| `src/lib/edgeFunctions.ts` | Edge function caller (47 functions) |
| `src/types/database.ts` | Generated Supabase DB types |
| `supabase/functions/_shared/cors.ts` | CORS headers for Edge Functions |
| `inference-service/server.js` | AI inference API (YOLOv8 + MobileNetV3) |
| `proxy-server/server.js` | NZSCV/MotorWeb proxy API |

### Build Commands

| Command | What It Does |
|---------|-------------|
| `bun install` | Install all dependencies |
| `bun run dev` | Start Vite dev server (localhost:5173) |
| `bun run build` | TypeScript check + Vite production build |
| `bun run lint` | ESLint code quality check |
| `bun run preview` | Preview production build locally |
