# Zones & Locations of Interest (LOI) — Unified Model

## Overview

**All zones are Locations of Interest (LOI) records.** There is no separate `zones` table. Instead, we use a canonical `locations_of_interest` table with a `loi_kind` field to categorize different zone types:

- `loi_kind = 'freedom_camp'` → Freedom camping enforcement zones (NCC-owned)
- `loi_kind = 'patrol_zone'` → Routine patrol areas
- `loi_kind = 'alarm_zone'` → Burglar alarm response zones
- `loi_kind = 'static_site'` → Static resource locations (cameras, gates, etc.)
- `loi_kind = 'poi'` → Points of interest (landmarks, hazards, etc.)
- `loi_kind = 'address'` → Individual addresses
- `loi_kind = 'park_reserve'` → Park or reserve boundaries

## Data Model

### Locations of Interest (LOI)

Every zone, site, or location is stored as a single LOI record:

```sql
id                      UUID        PRIMARY KEY
organization_id         UUID        -- NCC for freedom camping zones
name                    TEXT        -- e.g., "Muritai St Freedom Camp"
description             TEXT        -- Enforcement rules, hazards, etc.
loi_kind                TEXT        -- Category: 'freedom_camp', 'patrol_zone', etc.

-- Address components
address_line1           TEXT
suburb                  TEXT
city                    TEXT
region                  TEXT
postcode                TEXT

-- Geolocation
gps_lat                 DOUBLE PRECISION
gps_lng                 DOUBLE PRECISION
geo_zone_ids            UUID[]      -- Spatial zones this LOI belongs to

-- Dedup/merge
canonical_loi_id        UUID        -- Link to canonical record if merged
is_canonical            BOOLEAN

-- Hazards and access
hazard_summary          TEXT
access_summary          TEXT

-- Audit
is_active               BOOLEAN
created_at              TIMESTAMPTZ
updated_at              TIMESTAMPTZ
```

### Evidence Index

Evidence photos (EXIF metadata, GPS attribution) link **directly to LOI**, not to zones:

```sql
id                      UUID        PRIMARY KEY
organization_id         UUID        -- NCC
storage_path            TEXT        -- Path in Supabase Storage
gps_latitude            DOUBLE PRECISION
gps_longitude           DOUBLE PRECISION
inferred_region         TEXT        -- Derived from GPS coords
inferred_branch_id      UUID        -- First Security Nelson, etc.
inferred_loi_id         UUID        -- ← Link to LOI (not zone_id)
priority_band           TEXT        -- P0 (ready), P1, P2, P3 (triage)
ingest_action           TEXT        -- ingest_to_branch_pipeline, manual_review, etc.
linked_observation_id   UUID        -- FK to observations after ALPR
```

## Workflow Examples

### Example 1: Freedom Camping Enforcement (NCC)

**Setup:**
1. Create LOI records for each freedom camping site:
   ```sql
   INSERT INTO locations_of_interest 
     (organization_id, name, loi_kind, address_line1, gps_lat, gps_lng, hazard_summary)
   VALUES 
     ('bd59679c-f0b5-4b4f-9cb6-847dfc3f5993', 'Muritai St Campground', 'freedom_camp', 
      '123 Muritai Street', -41.27, 172.08, '7-day max stay, $0/night'),
     ('bd59679c-f0b5-4b4f-9cb6-847dfc3f5993', 'Tahurangi Day-Use', 'freedom_camp',
      'Tahurangi Mt Access', -41.30, 172.10, 'Day-use only, scenic reserve');
   ```

2. Photo from officer comes in:
   - Supabase Storage bucket: `evidence/nelson_fc_01.jpg`
   - EXIF GPS: -41.271, 172.081
   - Geo-bounding-box match → Nelson region
   - Branch assignment → First Security Nelson

3. Evidence index record created:
   ```json
   {
     "storage_path": "nelson_fc_01.jpg",
     "gps_latitude": -41.271,
     "gps_longitude": 172.081,
     "inferred_region": "Nelson",
     "inferred_branch_id": "11111111-0001-0001-0001-000000000002",
     "inferred_loi_id": "loi-uuid-muritai",
     "priority_band": "P0",
     "ingest_action": "ingest_to_branch_pipeline"
   }
   ```

4. Reingest pipeline:
   - Load P0 evidence photos
   - Run processOfficerScan (ALPR) on each
   - Link plate matches to observations
   - Check if observation GPS is within LOI bounds → mark as breach
   - Update compliance matrix

### Example 2: Patrol Zone Monitoring

**Setup:**
```sql
INSERT INTO locations_of_interest 
  (organization_id, name, loi_kind, gps_lat, gps_lng)
VALUES 
  ('11111111-0001-0001-0001-000000000002', 'CBD North Patrol', 'patrol_zone', -41.26, 172.09);
```

**Dispatch linking:**
- Patrol observation GPS (-41.261, 172.089) matches LOI
- Officer field app knows which patrol_zone they're in
- Can trigger location-based alerts

### Example 3: Static Site / Resource

**Setup:**
```sql
INSERT INTO locations_of_interest 
  (organization_id, name, loi_kind, address_line1, gps_lat, gps_lng, hazard_summary)
VALUES 
  ('bd59679c-f0b5-4b4f-9cb6-847dfc3f5993', 'Nelson Camera #5', 'static_site', 
   'Nile Street', -41.27, 172.083, 'CCTV coverage: +/-100m');
```

**Usage:**
- Events within +/- 100m trigger alerts
- Cross-reference with observations in evidence table
- Generate KPI reports by static_site

## Multi-Organization & Multi-Branch

### Multi-Org Scenario

- **Nelson City Council (NCC)** is the CLIENT
  - Owns freedom_camp LOI records (loi_kind='freedom_camp')
  - organization_id = `bd59679c-f0b5-4b4f-9cb6-847dfc3f5993`

- **First Security Nelson** is the SERVICE PROVIDER
  - Manages patrol_zone and static_site LOI records (organization_id=FS_Nelson)
  - Can see NCC's freedom_camp zones via RLS (org-scoped read)
  - Photos ingested into NCC's evidence_index after branch processing

### Multi-Branch Service Provider

If First Security has multiple branches (Nelson, Otago, Wellington):
- `inferred_branch_id` routes evidence photos to correct regional worker
- Each branch worker processes P0 → P3 queues independently
- Results linked back to NCC's evidence_index and observations

## RLS (Row-Level Security)

Evidence index and LOI have RLS policies:

```sql
-- Master / Grand Master: See all orgs
-- Admin / Officer: See only their org's LOI + evidence

SELECT * FROM locations_of_interest 
WHERE organization_id IN (
  SELECT organization_id FROM user_profiles WHERE id = auth.uid()
);
```

## Queries by Zone Type

### Find all freedom camping LOI for NCC
```sql
SELECT * FROM locations_of_interest
WHERE organization_id = 'bd59679c-f0b5-4b4f-9cb6-847dfc3f5993'
  AND loi_kind = 'freedom_camp'
  AND is_active = true;
```

### Find evidence photos ready to ingest (P0) within a specific LOI
```sql
SELECT e.* 
FROM evidence_index e
WHERE e.inferred_loi_id = 'loi-uuid-muritai'
  AND e.priority_band = 'P0'
  AND e.ingest_status = 'queued';
```

### Find observations that breach freedom camping zones
```sql
SELECT o.*, l.name, l.address_full
FROM observations o
JOIN locations_of_interest l ON l.id = o.linked_loi_id
WHERE l.loi_kind = 'freedom_camp'
  AND l.organization_id = 'bd59679c-f0b5-4b4f-9cb6-847dfc3f5993'
  AND o.vehicle_plate IS NOT NULL;
```

## Implementation in UI Components

### PhotoReingest.tsx — Filter by LOI

```tsx
// Instead of zone selection:
const [selectedLoiId, setSelectedLoiId] = useState<string>('')
const [selectedLoiKind, setSelectedLoiKind] = useState<'freedom_camp' | 'patrol_zone' | ''>('')

// Query LOI for UI dropdown
const lois = useQuery({
  queryKey: ['lois', effectiveOrgId, selectedLoiKind],
  queryFn: async () => {
    let q = supabase.from('locations_of_interest')
      .select('id, name, loi_kind')
      .eq('organization_id', effectiveOrgId);
    
    if (selectedLoiKind) q = q.eq('loi_kind', selectedLoiKind);
    
    const { data } = await q;
    return data || [];
  }
})

// Pass to reingest edge function
const reingestParams = {
  organization_id: effectiveOrgId,
  inferred_loi_id: selectedLoiId,  // ← LOI, not zone
  priority_band: selectedPriorityBand
}
```

### Evidence Ingestion Script

```javascript
// build-evidence-index.mjs infers LOI from GPS coords
const region = inferRegionFromGPS(lat, lon);  // 'Nelson', 'Otago', etc.
const loiRecords = await queryLoiByRegionAndKind(region, 'freedom_camp');

// Match photo to nearest LOI
const inferred_loi_id = findNearestLoi(lat, lon, loiRecords);

const indexRecord = {
  inferred_loi_id,  // Direct reference to LOI
  priority_band: determineP0_P3(lat, lon, loiRecords),
  ingest_action: 'ingest_to_branch_pipeline'
};
```

## Summary

| Concept | Implementation | Storage |
|---------|---|---|
| **Freedom Camping Zone** | LOI with `loi_kind='freedom_camp'` | `locations_of_interest` |
| **Patrol Area** | LOI with `loi_kind='patrol_zone'` | `locations_of_interest` |
| **Static Site** | LOI with `loi_kind='static_site'` | `locations_of_interest` |
| **Photo-to-Zone Link** | Evidence → inferred_loi_id → LOI | `evidence_index.inferred_loi_id` |
| **Multi-Org Access** | RLS by organization_id | LOI, evidence_index RLS policies |
| **Multi-Branch Routing** | `evidence_index.inferred_branch_id` | Edge function worker dispatch |

---

**Key Principle:** Canonical single source of truth for all site/zone data in LOI. No parallel zones table. All zone types use the same table with `loi_kind` categorization.
