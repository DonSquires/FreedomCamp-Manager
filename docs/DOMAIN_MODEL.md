# Domain Model — Location, Zone, and Dispatch Architecture

> **Status**: Active — introduced in PR [update-domain-model-architecture](https://github.com/DonSquires/FreedomCamp-Manager/pull/new/copilot/update-domain-model-architecture)  
> **Version**: 1.0  
> **Date**: 2026-07-07

---

## Overview

FieldOps Manager tracks enforcement and patrol work across multiple location
types.  Historically the `zones` table served as both a *geographic area*
definition and an *operational dispatch run / callsign*.  This document
explains the clarified domain model and how the codebase is transitioning to
a cleaner separation of concerns.

---

## Core Location Entities

### 1. Location of Interest (LOI) — `locations_of_interest`

**What it is**: The single canonical *point* record for any real-world address
or place.

| Field | Purpose |
|---|---|
| `address_full` | Human-readable address string |
| `gps_lat` / `gps_lng` | WGS-84 coordinates |
| `loi_kind` | Semantic flavour (see below) |
| `geo_zone_ids` | Cached array of geo_zone IDs containing this point |
| `canonical_loi_id` | Points to the preferred record if this is a duplicate |

**LOI kinds**:

| Kind | Example |
|---|---|
| `address` | 14 Trafalgar St, Nelson |
| `park_reserve` | Tahunanui Reserve |
| `freedom_camp` | Annesbrook Drive Campsite |
| `poi` | Nelson Countdown Carpark |
| `intersection` | Bridge St / Hardy St |
| `ad_hoc` | GPS fix with no resolved address |
| `unknown` | Placeholder when no location data exists |

**Design rules**:
- Client sites, jobs, and dispatch resources *reference* LOI rather than
  storing duplicate address/coordinate data.
- LOI does **not** store polygon geometry — that belongs to `geo_zones`.
- Multiple LOIs can exist for the same physical place (before deduplication).
  Use `canonical_loi_id` to point duplicates to the preferred record.
- Jobs should populate `loi_id` even when no `client_site_id` exists (e.g.
  noise/community jobs against a street address not in the client database).

---

### 2. GeoZone — `geo_zones`

**What it is**: A polygon/area entity representing a geographic coverage zone.

| Field | Purpose |
|---|---|
| `geometry_geojson` | GeoJSON Polygon/MultiPolygon |
| `geom` | PostGIS geography for spatial queries |
| `center_lat` / `center_lng` | Centroid for Haversine/display |
| `task_types` | Applicable task types in this area |
| `land_managing_agency` | Authority (council, DOC, LINZ, etc.) |
| `bylaw_reference` | Specific bylaw clause for infringement notices |

**Key distinction**: A GeoZone is a *place on a map*.  It does not know which
patrol run covers it — that mapping lives in `geo_zone_dispatch_map`.

**Task types per zone** (examples):

| Zone | Task types |
|---|---|
| Nelson CBD | `parking`, `noise`, `trespass`, `litter` |
| Tahuna Beach | `freedom_camping`, `noise`, `bylaw_enforcement` |
| Annesbrook Shops | `parking`, `noise`, `suspicious_activity` |

---

### 3. Site — `client_sites`

**What it is**: A *legal parcel of land* owned by a person or organisation
that is under a contract with an Iron Eagle / OnSpace AI client.

A Site specialises LOI — it adds billing context, security profile, keys
management, SLA overrides, and contact details.

```
client_sites.loi_id → locations_of_interest (planned future migration)
```

**Currently** `client_sites` stores its own `address`, `gps_lat`, `gps_lng`
fields.  A future migration will:
1. Create an LOI for each site from those fields.
2. Set `client_sites.loi_id` to the new LOI.
3. Deprecate the inline address columns.

---

### 4. Location Group / Area — `zones` (zone_kind = 'location_group')

**What it is**: A wide operational area that may contain many LOIs and/or
Sites — e.g. a shopping mall (static guarding footprint), an event precinct,
or a hospital campus.

A LocationGroup is *larger than a parcel* (unlike Site) but may not be a
formal enforcement polygon (unlike GeoZone).  It is used for patrol and
static guarding contexts where the "zone" is an operational boundary, not a
legal or jurisdictional one.

Currently modelled as a `zones` record with `zone_kind = 'location_group'`.
A dedicated `location_groups` table may be introduced in a future stage.

---

## Dispatch Entities

### 5. DispatchResource — `dispatch_resources`

**What it is**: A patrol run, callsign, or operational unit that can be
dispatched to jobs or scheduled to run on a recurring template.

| Field | Purpose |
|---|---|
| `callsign` | Short ID (e.g. "587", "Nelson Night") |
| `name` | Full name ("587 Nelson Night Patrol") |
| `resource_kind` | patrol_run \| static_guard \| response_unit \| supervisor |
| `base_loi_id` | Home depot / base (references LOI) |
| `active_days` | ISO weekdays (1=Mon … 7=Sun) this run operates |
| `default_start_time` / `default_end_time` | Shift window |
| `scheduling_enabled` | Stub: TRUE when scheduling engine applies |
| `auto_dispatch_enabled` | Allow system to assign jobs without human approval |
| `patrol_route_id` | Optional bridge to existing `patrol_routes` table |

**Key distinction**: A DispatchResource is an *operational resource*.  It
covers one or more GeoZones (defined via `geo_zone_dispatch_map`) but is not
itself a geographic area.

---

### 6. GeoZone–Dispatch Mapping — `geo_zone_dispatch_map`

**What it is**: The routing rule that says "when a job is created inside
*this GeoZone* for *this job type* during *this time window*, assign it to
*this DispatchResource*."

| Field | Purpose |
|---|---|
| `geo_zone_id` | The polygon area |
| `dispatch_resource_id` | The run/callsign to assign |
| `job_types` | Empty = all types; otherwise restrict |
| `active_days` | Days this mapping is in effect |
| `window_start_time` / `window_end_time` | Time window |
| `priority` | Tie-break when multiple mappings match |
| `assignment_mode` | primary \| assist \| overflow |

**Example**:

```
GeoZone: "Nelson CBD"
  → primary: DispatchResource "587 Nelson Night" (Mon–Sun, 22:00–06:00, types: parking,noise)
  → primary: DispatchResource "583 Nelson Day"  (Mon–Fri, 08:00–17:00, all types)
  → assist:  DispatchResource "589 Nelson Rover" (all days, all hours, overflow)
```

---

## Entity Relationship Summary

```
organizations
  ├── locations_of_interest (LOI)  ← canonical point/address
  │     └── referenced by: client_sites, dispatch_resources, dispatch_jobs
  │
  ├── geo_zones                    ← polygon areas (geographic)
  │     └── mapped to dispatch_resources via geo_zone_dispatch_map
  │
  ├── dispatch_resources           ← patrol runs / callsigns (operational)
  │     ├── base_loi_id → LOI
  │     └── patrol_route_id → patrol_routes (legacy bridge)
  │
  ├── geo_zone_dispatch_map        ← routing rules
  │     ├── geo_zone_id → geo_zones
  │     └── dispatch_resource_id → dispatch_resources
  │
  ├── client_sites                 ← legal parcels / contracted sites
  │     └── (future) loi_id → LOI
  │
  ├── dispatch_jobs                ← individual jobs
  │     ├── loi_id → LOI  (new; replaces or supplements address fields)
  │     ├── assigned_run_id → dispatch_resources  (new)
  │     ├── client_site_id → client_sites  (existing, still optional)
  │     └── zone_id → zones  (existing, still optional)
  │
  └── zones                        ← legacy / transitional
        ├── zone_kind: geo | dispatch | both | location_group
        ├── geo_zone_id → geo_zones  (bridge; NULL if not migrated)
        └── dispatch_resource_id → dispatch_resources  (bridge; NULL if not migrated)
```

---

## The `zones` Table — Legacy Status and Migration Path

The `zones` table currently conflates **two** distinct concerns:

| Concern | New home |
|---|---|
| Polygon / geofence area | `geo_zones` |
| Patrol run / callsign | `dispatch_resources` |

### Why `zones` is kept intact (for now)

- Dozens of existing features reference `zones.id` (patrols, breach alerts,
  officer shifts, infringement notices, scan pipeline, etc.).
- A hard cutover would require simultaneous changes across the frontend,
  edge functions, and migrations.

### Transition flags on `zones`

Three columns were added in migration `20260707000004`:

| Column | Purpose |
|---|---|
| `zone_kind` | Declare what this record represents |
| `geo_zone_id` | FK bridge: if `zone_kind` includes `'geo'`, point to `geo_zones` |
| `dispatch_resource_id` | FK bridge: if `zone_kind` includes `'dispatch'`, point to `dispatch_resources` |

**Recommended process for existing zone records**:

1. Admin reviews each `zones` record and sets `zone_kind`.
2. For `zone_kind = 'geo'` or `'both'`: create a corresponding `geo_zones`
   record from the zone's geometry fields; set `zones.geo_zone_id`.
3. For `zone_kind = 'dispatch'` or `'both'`: create a corresponding
   `dispatch_resources` record from the zone's callsign/shift data; set
   `zones.dispatch_resource_id`.
4. New code reads from `geo_zones` / `dispatch_resources` directly.
5. Old code continues reading from `zones` (bridge FKs available if needed).

### Planned future stages

| Stage | Action |
|---|---|
| Stage 0 (this PR) | Add new tables, add bridge FKs to `zones`, add LOI to jobs |
| Stage 1 | Admin tooling to classify and migrate zone records |
| Stage 2 | Migrate frontend reads to `geo_zones` + `dispatch_resources` |
| Stage 3 | Deprecate `zones`; keep as a legacy view for backwards compat |

---

## LOI Backfill Strategy

### What was backfilled in this PR

Migration `20260707000004` backfills `dispatch_jobs.loi_id` for jobs where
**all three** of the following are true:

1. `loi_id IS NULL` (not yet linked)
2. `address IS NOT NULL AND trim(address) != ''`
3. `gps_lat IS NOT NULL AND gps_lng IS NOT NULL`

These records have both an address string **and** GPS coordinates — the safest
possible infer.  The created LOI has `geocoder_source = 'backfill_dispatch_jobs'`
and `geocoder_confidence = 0.6`.

### What was NOT backfilled (and why)

| Condition | Reason not backfilled |
|---|---|
| `address` present but no GPS | Would require geocoder round-trip (LINZ AddressFinder / Google Maps) — do in a separate migration once the geocoder service is connected |
| GPS present but no address | Would create an `ad_hoc` LOI with no address text — safe but low value; do separately with a clear `loi_kind = 'ad_hoc'` |
| `client_site_id` present | Requires mapping site address → LOI; planned for the `client_sites` LOI migration |

### Remaining TODOs

```sql
-- TODO: backfill LOI from dispatch_jobs.address where gps_lat IS NULL
--       (needs geocoder integration)
-- TODO: backfill LOI from client_sites.address / gps_lat / gps_lng
--       (set client_sites.loi_id when done)
-- TODO: backfill geo_zone_ids[] on LOI records using polygon containment
--       (run after geo_zones are populated)
```

---

## Scheduling Groundwork

Full scheduling (ServicePlan / ScheduledOccurrence / missed visit handling) is
planned for a future stage.  The following stubs are in place:

| Stub | Location | Description |
|---|---|---|
| `dispatch_resources.scheduling_enabled` | `dispatch_resources` table | Boolean flag; TRUE when this resource participates in the scheduling engine |
| `dispatch_resources.active_days` | `dispatch_resources` table | ISO weekday mask for the resource's operational schedule |
| `dispatch_resources.default_start_time` / `default_end_time` | `dispatch_resources` table | Shift window template |

### Planned scheduling entities (future stages)

```
service_plans (template)
  ├── plan_kind: permanent | casual | ad_hoc_addon
  ├── recurrence rules (days, windows, public-holiday behaviour)
  ├── pricing model (fee-per-visit, per-minute, fixed monthly, no-charge)
  ├── dispatch_resource_id → dispatch_resources
  └── generates → scheduled_occurrences

scheduled_occurrences (each expected visit)
  ├── scheduled window
  ├── status: due | dispatched | completed | missed | cancelled | rescheduled
  ├── completion fields: on/off-site, officer, GPS proof, comments, attachments
  └── produces → billing_line_items (configurable per contract)
```

See [Build Plan V3](./BUILD_PLAN_V3.md) Stage 4 for full details.

---

## Reference: Domain Glossary

| Term | Definition |
|---|---|
| **LOI** (Location of Interest) | Canonical point/address record. Single source of truth for coordinates and address text. |
| **GeoZone** | Polygon or area entity. Defines "where" geographically. Does not own any dispatch logic. |
| **DispatchResource** | Patrol run or callsign. Defines "who covers what" operationally. References LOI for its base/depot. |
| **Site** | Legal parcel of land owned by a person/organisation; in the system as a `client_sites` record. |
| **LocationGroup / Area** | Wide operational area (e.g. mall, hospital campus) containing many LOIs or Sites. Currently `zones` with `zone_kind = 'location_group'`. |
| **GeoZoneDispatchMap** | Routing rule: (GeoZone + job type + time window) → DispatchResource. |
| **Zone** (legacy) | Legacy `zones` table record that may represent a GeoZone, a DispatchResource, or both. Use `zone_kind` to determine which. |
| **ServicePlan** | (Planned) Scheduling template that generates ScheduledOccurrences for patrol/guarding visits. |
| **ScheduledOccurrence** | (Planned) A single expected visit on a schedule — has its own completion record and billing line. |

---

## Related Documents

- [Build Plan V3](./BUILD_PLAN_V3.md) — Full staged build plan (Stages 0–9)
- [Architecture Plan](./ARCHITECTURE_PLAN.md) — High-level system architecture
- [Decisions](./DECISIONS.md) — Architecture decision record
- [Backend Redesign](./BACKEND_REDESIGN.md) — Prior backend redesign notes
