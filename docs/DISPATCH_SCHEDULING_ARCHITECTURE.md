# Dispatch & Scheduling Architecture — Staged Build Plan

> **Status:** Foundation / Phase 1 — Data-model scaffolding and polygon-based dispatch resource selection.

---

## 1. Background and Problem Statement

The current dispatch system requires a **paying client site** to exist before a job can be created and dispatched. This blocks "community" jobs such as:

- **Noise Control** — contracted by a territorial authority (council); no individual client site.
- **Freedom Camping** — council-paid area enforcement.
- **Biosecurity / Smoke Complaints** — jurisdiction-paid jobs at any public address.

In parallel, the WILSAR-inspired **Zone/Callsign model** shows that dispatch should target a **patrol run / dispatch resource** (e.g., Zone 587 "Nelson Night Patrol"), not a specific officer. The roster layer separately resolves which officer is currently on that run.

---

## 2. Core Design Principles

| Principle | Detail |
|---|---|
| **LOI is always required; ClientSite is optional** | Every job has a canonical Location of Interest. ClientSite is *optional enrichment* for alarm/guarding jobs. |
| **Dispatch targets a Patrol Run, not a person** | `DispatchResource` is the callsign container. Roster resolves who is on the run at dispatch time. |
| **Polygon geofences drive automatic assignment** | Given LOI lat/lng + job type + time, the coverage zone polygon lookup selects the default `DispatchResource`. Officers may assist across boundaries (manual override). |
| **ClientPortal requests require approval or auto-dispatch whitelist** | Clients/officers can submit jobs via portal; dispatch team approves (or specific clients have auto-dispatch). |
| **Service Agreement governs payer, SLA, and capabilities** | Each job context (noise/alarm/patrol/etc.) links to a `ServiceAgreement` that controls who pays, SLA minutes, and whether the client can self-dispatch. |

---

## 3. Domain Model

### 3.1 Entity Relationships

```
Organization
  ├── ServiceAgreement (1..N)  ← governs payer + capabilities
  ├── DispatchResource (1..N)  ← patrol runs / callsigns
  │     └── (roster layer) PatrolRunShiftAssignment → officer + vehicle
  └── Zones (geofences)
        └── zone_dispatch_resource_rules → maps zone + job_type + time → DispatchResource

LocationOfInterest (LOI)  ← canonical address, geocoded
  ├── dispatch_jobs (N)        ← always has loi_id (required)
  └── optionally: client_site  ← for alarm/guarding jobs

dispatch_jobs
  ├── loi_id            UUID  (required)
  ├── client_site_id    UUID  (optional — alarm/guarding only)
  ├── service_agreement_id UUID (optional — links to payer/SLA)
  ├── job_type_id       UUID  (optional — structured type registry)
  └── dispatch_resource_id UUID (the assigned patrol run)
```

### 3.2 LocationOfInterest (LOI)

The LOI is a **canonical, reusable address record**. It is created on first encounter and reused on subsequent jobs at the same address.

#### Auto-geofence on address entry

When a geocoded address is saved to the LOI (i.e. `gps_lat` and `gps_lng` are set), the database trigger **`trg_loi_auto_geofence`** automatically generates a circular GeoJSON Polygon geofence and stores it in `geofence_geometry`. This happens server-side in the same transaction, so the geofence is always consistent with the coordinates.

The client-side utility `src/lib/loiGeofence.ts → buildLoiGeofencePayload()` mirrors this calculation so the polygon can be **previewed in the UI** before the record is saved and used for live proximity checks without a DB round-trip.

- **Default radius**: 100 m — tightly bounds a single address for precise job matching.
- **Adjustable**: set `geofence_radius_meters` on the LOI to use a different radius; the polygon is regenerated automatically.
- **Standard format**: GeoJSON `{ type: "Polygon", coordinates: [[[lng,lat],...]] }` — compatible with the existing `detectCurrentZones` / `isPointInPolygon` pipeline in `geofence.ts`.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `organization_id` | UUID | Scoped to org |
| `display_address` | TEXT | Full human-readable address |
| `street_number` | TEXT | |
| `street_name` | TEXT | |
| `suburb` | TEXT | |
| `city` | TEXT | |
| `postcode` | TEXT | |
| `country_code` | TEXT | Default `NZ` |
| `gps_lat` | DOUBLE PRECISION | Geocoded latitude |
| `gps_lng` | DOUBLE PRECISION | Geocoded longitude |
| `geofence_radius_meters` | INTEGER | Geofence radius (default 100 m) |
| `geofence_geometry` | JSONB | **Auto-populated** GeoJSON Polygon by DB trigger |
| `geocode_source` | TEXT | `manual` / `linz` / `google` |
| `is_verified` | BOOLEAN | Confirmed against authoritative source |
| `notes` | TEXT | Site-specific notes (hazards etc.) |

### 3.3 ServiceAgreement (Contract)

Links a payer (client organisation) to a capability and billing context.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `organization_id` | UUID | Provider org |
| `client_org_id` | UUID | Payer / client org (nullable — internal agreements) |
| `name` | TEXT | e.g. "NCC Noise Control 2026" |
| `agreement_type` | TEXT | `alarm` / `patrol` / `noise_control` / `freedom_camping` / `parking` / `investigation` / `other` |
| `allows_client_submission` | BOOLEAN | Client can submit jobs via portal |
| `allows_auto_dispatch` | BOOLEAN | Submitted jobs bypass approval |
| `default_sla_minutes` | INTEGER | Default response SLA |
| `default_priority` | TEXT | `low` / `normal` / `high` / `urgent` |
| `active_from` | DATE | |
| `active_to` | DATE | nullable = open-ended |

### 3.4 JobType

A structured registry of job module/specialty types, including community and security jobs.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `organization_id` | UUID | nullable = global/platform type |
| `code` | TEXT | Unique code e.g. `noise_complaint`, `alarm_response` |
| `label` | TEXT | Display label |
| `module` | TEXT | `security` / `enforcement` / `community` / `investigation` |
| `default_sla_minutes` | INTEGER | |
| `requires_client_site` | BOOLEAN | False for community jobs |
| `is_active` | BOOLEAN | |

### 3.5 DispatchResource (Patrol Run)

Represents a named patrol run / callsign (e.g., Zone 587 "Nelson Night Patrol").

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `organization_id` | UUID | |
| `callsign` | TEXT | Short radio/dispatch callsign (e.g., "587") |
| `display_name` | TEXT | e.g., "Nelson Night Patrol" |
| `resource_type` | TEXT | `patrol_run` / `static_guard` / `response_unit` / `supervisor` |
| `depot_id` | UUID | FK to zones (base depot) |
| `shift_start_time` | TIME | Default shift start |
| `shift_end_time` | TIME | Default shift end |
| `active_days` | INTEGER[] | ISO day-of-week 1=Mon…7=Sun |
| `auto_dispatch_enabled` | BOOLEAN | Allow automatic job assignment |
| `auto_dispatch_sms` | TEXT | SMS number for auto-dispatch |
| `auto_dispatch_app_user_id` | UUID | App user for push notification |
| `is_subcontractor` | BOOLEAN | Run operated by a subcontractor |
| `provider_org_id` | UUID | Subcontractor org (if applicable) |
| `is_active` | BOOLEAN | |

---

## 4. Dispatch Lifecycle State Machine

```
                     ┌──────────┐
                     │  PENDING │  ← Job created (manual, portal, or auto)
                     └────┬─────┘
                          │ dispatch (assign to DispatchResource + officer)
                     ┌────▼──────┐
                     │DISPATCHED │
                     └────┬──────┘
                          │ officer acknowledges
                     ┌────▼──────────┐
                     │ACKNOWLEDGED   │
                     └────┬──────────┘
                          │ officer travelling
                     ┌────▼──────┐
                     │ EN_ROUTE  │
                     └────┬──────┘
                          │ officer arrives
                     ┌────▼──────┐
                     │ ON_SCENE  │
                     └────┬──────┘
                          │ job finished
                     ┌────▼──────┐
                     │COMPLETED  │
                     └───────────┘

At any stage → CANCELLED (with cancel_reason)
```

SLA clock starts at `created_at` and targets `on_scene_at ≤ created_at + sla_minutes`. If breached, `sla_breached = true` and `escalation_level` increments.

---

## 5. Why LOI is Required; ClientSite is Optional

| Scenario | LOI | ClientSite | ServiceAgreement |
|---|---|---|---|
| Alarm Response (guarded site) | ✅ derived from ClientSite | ✅ required | Client alarm contract |
| Noise Complaint (public address) | ✅ ad-hoc or matched | ❌ not required | Council noise contract |
| Freedom Camping (public car park) | ✅ zone address | ❌ not required | Council FC contract |
| Parking Infringement (street) | ✅ street address | ❌ not required | Council parking contract |
| Investigation | ✅ subject address | optional | Investigation agreement |
| Officer-initiated compliance | ✅ scan location | ❌ | Org default |

**LOI decouples dispatch from the billing relationship.** It is the spatial anchor. The `ServiceAgreement` separately identifies who pays and what rules apply.

---

## 6. Polygon-Based Dispatch Resource Selection

### Algorithm

```
selectDispatchResource(loi_lat, loi_lng, job_type, time_of_dispatch):
  1. Find all Zone geofences that contain (loi_lat, loi_lng)
       — Haversine distance check: dist(loi, zone.centre) ≤ zone.radius_meters
       — OR PostGIS ST_Within when polygon geometry is available
  2. For each matching zone, load dispatch_resource_rules:
       WHERE zone_id IN matched_zones
         AND (job_type_code IS NULL OR job_type_code = job_type)
         AND (day_of_week IS NULL OR day_of_week = extract(isodow from time))
         AND (time_from IS NULL OR time_from <= time::time)
         AND (time_to   IS NULL OR time_to   >= time::time)
  3. Filter to active DispatchResources that are on-shift at time_of_dispatch
  4. If multiple candidates: rank by priority, then load balance
  5. Return top candidate (or NULL → manual assignment required)
```

### Manual Override / Cross-Boundary Assist

- Dispatcher can override the auto-selected resource at any point before status = `en_route`.
- An officer can be **transferred** to assist a neighbouring run without changing `dispatch_resource_id`; the `assist_resource_ids[]` array tracks secondary assignments.

---

## 7. Client Portal Job Submission

Three submission modes controlled per `ServiceAgreement`:

| Mode | `allows_client_submission` | `allows_auto_dispatch` | Behaviour |
|---|---|---|---|
| **Disabled** | false | — | Portal submit button hidden |
| **Approval required** | true | false | Job created as `pending_approval`; dispatch team reviews |
| **Auto-dispatch** | true | true | Job created and immediately dispatched (monitoring centres, after-hours call centres) |

### Portal Roles

- **Client staff** (client portal) — can submit jobs for their own `ServiceAgreement` scope.
- **Officer / admin_officer** — can create community jobs (noise, FC, parking) directly in the field officer portal without selecting a ClientSite.

---

## 8. Scheduling: Permanent vs Casual Patrol (Future Phase)

> Phase 2 — Not implemented in this PR. Scaffolding is present via `ServiceAgreement.agreement_type`.

| Type | Description |
|---|---|
| **Permanent Patrol** | Regular recurring patrols (Mon–Fri nights etc.); governed by a `ServicePlan` → `ScheduledOccurrence` model. Each expected visit is its own `ScheduledOccurrence`. |
| **Casual Patrol** | Ad-hoc or on-request patrol; created as a standard dispatch job. |

---

## 9. Staged Build Plan

| Phase | Deliverable | Status |
|---|---|---|
| **Phase 1 (this PR)** | LOI + DispatchResource + ServiceAgreement + JobType tables; `dispatch_jobs.loi_id`; polygon assignment service scaffolding | ✅ Foundation |
| **Phase 2** | Client portal submission flow; `pending_approval` status; approval UI | 🔜 Planned |
| **Phase 3** | Roster → DispatchResource linkage; on-shift awareness in assignment selector | 🔜 Planned |
| **Phase 4** | `ServicePlan` + `ScheduledOccurrence` for permanent patrol scheduling | 🔜 Planned |
| **Phase 5** | Full polygon geometry (PostGIS or GeoJSON) for dispatch resource selection | 🔜 Planned |

---

## 10. Backwards Compatibility

- `dispatch_jobs.loi_id` is **nullable** in this migration. Existing jobs without an LOI continue to work.
- `dispatch_jobs.client_site_id` remains and is still populated for alarm/guarding jobs.
- No existing tables, columns, constraints, or indexes are altered destructively.
- All new tables have independent RLS policies; existing RLS is unchanged.
