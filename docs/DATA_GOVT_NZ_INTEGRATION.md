# data.govt.nz Freedom Camping Sites – Integration Guide

## Overview

`scripts/import_campsites.ts` includes **Source 6: data.govt.nz Freedom Camping Sites**, a national consolidated dataset of freedom camping sites published by the New Zealand government.

- **Catalogue page:** <https://catalogue.data.govt.nz/dataset/freedom-camping-sites>
- **License:** [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/)
- **Formats available:** GeoJSON, CSV (discovered at runtime via CKAN API)
- **Maintainer:** Ministry for the Environment / Department of Conservation

---

## Why this supplement?

The existing import sources (DOC ArcGIS, LINZ Crown Property, Council FeatureServers) cover major freedom camping zones but may miss:

- Sites from councils that do not publish an ArcGIS FeatureServer.
- Sites added or updated after individual council APIs were last checked.
- Sites that exist only in the national consolidated record.

The data.govt.nz dataset acts as a **safety net** – it is imported last so that any gap left by the primary sources is filled without overwriting authoritative per-council data.

---

## How it works

### 1. CKAN API discovery

The importer calls the CKAN REST API at runtime:

```
GET https://catalogue.data.govt.nz/api/3/action/package_show?id=freedom-camping-sites
```

The response is parsed to find a `GeoJSON` resource URL first, then a `CSV` resource URL. This ensures the script picks up new format versions automatically if the dataset publisher updates resources.

### 2. Fallback GeoJSON

If the CKAN API is unreachable (network issues, maintenance), the script falls back to a static ArcGIS Open Data mirror:

```
https://doc-deptconservation.opendata.arcgis.com/api/v3/datasets/25e0950229b54e6d8a79d671aa108033_0/downloads/data?format=geojson&spatialRefId=4326
```

### 3. CSV parsing

If no GeoJSON is available, the script downloads the CSV resource and parses it using `csv-parse/sync`. CSV rows are converted to pseudo-GeoJSON features using the following field-name candidates for coordinates:

| Axis | Field names tried |
|------|-------------------|
| Longitude | `longitude`, `Longitude`, `LONGITUDE`, `lng`, `x` |
| Latitude | `latitude`, `Latitude`, `LATITUDE`, `lat`, `y` |

The same field-name candidates are also used as a property-level fallback when a GeoJSON feature has no `geometry` but carries flat coordinate properties.

### 4. Deduplication

Zones are deduplicated using the same key used by all other sources:

```
{organization_id}::{zone_name.trim().toLowerCase()}
```

If a zone with the same name already exists in the same organisation, it is **updated** (not duplicated). This catches exact-name matches from DOC, LINZ, and Council sources.

> **Note:** Sites with slight name variations (e.g., `"Waikato: Site A"` vs `"Site A"`) are not automatically merged. Run `scripts/merge_duplicate_zones.ts` after import to review candidate duplicates.

### 5. Source attribution

Every zone created or updated from this source receives:

- `boundary_source = 'data.govt.nz'` (stored in the `zones.boundary_source` column)
- `description` includes the suffix `Source: data.govt.nz`

This makes it easy to filter or audit zones by their origin:

```sql
SELECT id, name, boundary_source
FROM zones
WHERE boundary_source = 'data.govt.nz';
```

---

## Running the import

### Import only the data.govt.nz source

```bash
SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> \
IMPORT_SOURCES=data_govt_nz \
npx ts-node --esm scripts/import_campsites.ts
```

### Import all sources (data.govt.nz included)

```bash
SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> \
npx ts-node --esm scripts/import_campsites.ts
# IMPORT_SOURCES defaults to "all"
```

### Available source keys

| Key | Description |
|-----|-------------|
| `doc_campsites` | DOC conservation campsites (~300 points) |
| `doc_huts` | DOC backcountry huts (~950 points) |
| `doc_freedom_camping` | DOC Freedom Camping restriction polygons |
| `linz_crown` | LINZ Managed Crown Property parcels |
| `council` | Waikato / Nelson / Christchurch council zones |
| `data_govt_nz` | **data.govt.nz national consolidated dataset** |
| `all` | All of the above (default) |

---

## Test procedure

### 1. Dry-run connectivity check

```bash
# Verify CKAN API is reachable and returns resources
curl -s "https://catalogue.data.govt.nz/api/3/action/package_show?id=freedom-camping-sites" \
  | jq '.result.resources[] | {format: .format, url: .url}'
```

### 2. Import with verbose output

```bash
SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> \
IMPORT_SOURCES=data_govt_nz \
npx ts-node --esm scripts/import_campsites.ts 2>&1 | tee /tmp/data_govt_nz_import.log
```

Check the output for:

- `Downloaded N data.govt.nz freedom camping features` – confirms download succeeded.
- `Created: N zones` / `Updated: N zones` – confirms zones were written to the database.
- `Unmatched: N` – sites whose coordinates fall outside all org jurisdiction zones (may need new org boundaries).
- `Skipped: N` – sites missing a name or coordinates.

### 3. Validate in the database

```sql
-- Count zones attributed to this source
SELECT count(*) FROM zones WHERE boundary_source = 'data.govt.nz';

-- Preview a sample
SELECT name, description, location_lat, location_lng, boundary_source
FROM zones
WHERE boundary_source = 'data.govt.nz'
LIMIT 20;

-- Check for suspiciously high duplicate counts (same name, different IDs)
SELECT name, organization_id, count(*) AS cnt
FROM zones
WHERE zone_type = 'specific'
GROUP BY name, organization_id
HAVING count(*) > 1
ORDER BY cnt DESC;
```

### 4. Coverage check

Compare the count of zones per organisation before and after import to verify new zones were added:

```sql
SELECT o.name AS org, count(z.id) AS zone_count
FROM organizations o
LEFT JOIN zones z ON z.organization_id = o.id AND z.zone_type = 'specific'
GROUP BY o.name
ORDER BY zone_count DESC;
```

---

## Licensing considerations

| Aspect | Detail |
|--------|--------|
| **Dataset license** | CC BY 4.0 – free to use with attribution |
| **Attribution required** | Yes – the `boundary_source = 'data.govt.nz'` column and description suffix satisfy this requirement |
| **Commercial use** | Permitted under CC BY 4.0 |
| **Conflict with DOC/LINZ data** | Both DOC and LINZ datasets are also CC BY 4.0; no conflict |
| **Council data** | Individual council datasets used in Source 5 carry their own CC licences; the data.govt.nz dataset is a consolidated superset and should not override per-council authoritative enforcement boundaries |
| **Authority for enforcement** | For enforcement decisions, always prefer the per-council or DOC FeatureServer zone (primary sources). The data.govt.nz zones supplement coverage for display and reporting purposes |

---

## Data model impact

The integration uses the existing `zones` table with no schema changes. The `boundary_source` column (already present) stores the attribution string `'data.govt.nz'`.

```
zones
├── id                UUID PK
├── name              TEXT
├── description       TEXT  ← includes "Source: data.govt.nz" suffix
├── zone_type         TEXT  = 'specific'
├── organization_id   UUID FK → organizations
├── parent_zone_id    UUID FK → zones (jurisdiction zone)
├── location_lat      FLOAT
├── location_lng      FLOAT
├── geometry          JSONB (GeoJSON polygon, when available)
├── boundary_source   TEXT  = 'data.govt.nz'  ← attribution
└── is_active         BOOL  = true
```
