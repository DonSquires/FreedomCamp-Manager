# LINZ Geofence Data Import Workflow

This guide explains how to integrate real NZ territorial authority boundaries from LINZ (Land Information New Zealand) into the spatial intelligence system.

## Overview

The spatial intelligence system supports multiple data sources with automatic fallback:

1. **Production geofences** (`data/production-geofences.json`) — Enhanced council definitions
2. **Client intake** (`docs/templates/clients/*/intake.json`) — Private enterprise geofences
3. **GeoJSON import** — Real LINZ boundary data converted to internal format
4. **Static defaults** — Embedded fallback for testing/offline use

## Step 1: Download LINZ GeoJSON Data

LINZ publishes authoritative boundary data at: **https://data.linz.govt.nz/**

### Option A: Download Territorial Authority Boundaries

1. Visit [LINZ Data Service](https://data.linz.govt.nz/)
2. Search for: **"Territorial Authority Boundaries"** (Dataset ID: 1573)
3. Select desired year (e.g., 2024)
4. Download as **GeoJSON** format
5. Save to: `data/raw-linz-ta-boundaries.geojson`

### Option B: Download via WFS API

```bash
# Territorial Authority Boundaries WFS
curl -o data/raw-linz-ta-boundaries.geojson \
  'https://data.linz.govt.nz/services/wfs/v1/geojson?service=WFS&version=2.0.0&request=GetFeature&typeNames=nz:nz_territorial_authorities&outputFormat=application/json&key=YOUR_API_KEY'
```

Get your API key from [LINZ API Dashboard](https://data.linz.govt.nz/dashboard/)

### Option C: Use Alternative OSM Source

For offline/development, use OpenStreetMap Overpass API:

```bash
# Fetch all NZ administrative boundaries (admin_level=8)
curl -o data/raw-osm-nz-boundaries.geojson \
  '[bbox:-47.8,165.8,-33.8,178.5];(relation["boundary"="administrative"]["admin_level"="8"];);out geom;' \
  'https://overpass-api.de/api/interpreter'
```

## Step 2: Convert GeoJSON to Internal Format

Use the provided converter script:

```bash
# Convert LINZ GeoJSON
npm run bob:geojson:convert data/raw-linz-ta-boundaries.geojson

# Output: data/geofences-from-geojson.json
```

### Conversion Details

The converter performs:
- Multi-ring extraction (handles Polygon + MultiPolygon)
- Bounding box calculation
- Coordinate system conversion ([lng, lat] → [lat, lng])
- Council name → ID mapping
- Default bylaw thresholds application

## Step 3: Validate and Enrich Council Data

Edit the converted file to add council-specific bylaws:

```bash
# Review output
cat data/geofences-from-geojson.json | jq '.jurisdictions[] | {council, id, noiseLimit}'
```

Example enrichment for a jurisdiction:

```json
{
  "id": "tasman-dc",
  "council": "Tasman District Council",
  "region": "Top of South Island",
  "bounds": { "north": -40.8, "south": -41.6, ... },
  "polygon": [ [-40.5, 172.1], ... ],
  "bylaws": {
    "freedomCamping": {
      "prohibited": true,
      "exemptions": ["freedom camping grounds"],
      "enforcementOfficers": 1.2,
      "staffRatio": 200
    },
    "noise": {
      "commercialLimit": 80,
      "residentialLimit": 75,
      "enforcementThreshold": 85
    },
    "fire": {
      "openFireProhibited": true,
      "season": { "start": "September", "end": "April" }
    }
  },
  "riskProfile": {
    "seizureRule": "immediate",
    "towing": true,
    "occupantRemoval": true
  }
}
```

## Step 4: Load into Spatial Engine

### Option A: Update Production Geofences (Recommended)

Replace the default payload in `scripts/production-geofence-generator.mjs`:

```javascript
// In production-geofence-generator.mjs
const ENHANCED_JURISDICTIONS = [
  // ... replace with your council data from geofences-from-geojson.json
];
```

Then regenerate:
```bash
npm run bob:geofence:production
```

### Option B: Update Load Function

Modify `scripts/load-production-geofences.mjs` to prioritize your source:

```javascript
export function loadProductionJurisdictions(verbose = false) {
  // Try custom LINZ source first
  const linzPath = path.join(workspaceRoot, 'data', 'geofences-from-geojson.json');
  if (fs.existsSync(linzPath)) {
    // Load from LINZ data...
  }
  
  // Fall back to generated production data
  // ...
}
```

### Option C: Direct Integration

Wire directly into `spatial-intelligence-engine.mjs`:

```javascript
import { loadProductionJurisdictions } from './load-production-geofences.mjs';

const JURISDICTIONS = loadProductionJurisdictions(/* verbose */ false);
```

## Step 5: Validate with Tests

Run integration tests to ensure polygon definitions work:

```bash
npm run bob:test:spatial
```

Expected test output:
- ✅ Layer Priority Resolution (3 tests)
- ✅ Roster Context Resolution (3 tests)
- ✅ Field Evaluator Integration (3 tests)
- ✅ Multi-Jurisdiction Handover (1 test)

## Step 6: Deploy to Production

1. Commit enriched geofences to version control
2. Update CI/CD pipelines to regenerate on commits
3. Enable automatic testing via GitHub Actions (`.github/workflows/bob-spatial-ci.yml`)
4. Deploy via Railway/Vercel with production geofence data

## Data Sources & References

| Source | URL | Format | License |
|--------|-----|--------|---------|
| **LINZ Data Service** | https://data.linz.govt.nz/ | GeoJSON/Shapefile | CC-By-4.0 |
| **OSM Overpass** | https://overpass-api.de/ | GeoJSON/OSM/XML | ODbL 1.0 |
| **NZ Stats Boundary** | https://nzdotstat.stats.govt.nz/ | GeoJSON | CC-By-4.0 |
| **Linz.govt.nz Maps** | https://maps.linz.govt.nz/ | WMS/WFS | CC-By-4.0 |

## Troubleshooting

### Issue: "No rings extracted from feature"

**Cause**: Invalid polygon geometry or unsupported type  
**Fix**: Validate GeoJSON with: `jq '.features[0].geometry' data/raw-linz.geojson`

### Issue: Coordinate system mismatch

**Cause**: GeoJSON in wrong format (e.g., [lat, lng] instead of [lng, lat])  
**Fix**: The converter auto-detects. Verify with: `jq '.jurisdictions[0].polygon[0]' data/geofences-from-geojson.json`

### Issue: Tests fail with "undefined council"

**Cause**: Bylaw thresholds not set for a jurisdiction  
**Fix**: Ensure all councils in `geofences-from-geojson.json` have `bylaws.noise.commercialLimit` defined

## Advanced: Automated LINZ Sync

To automatically fetch and update LINZ data weekly:

```bash
# Add to GitHub Actions workflow
- name: Fetch latest LINZ boundaries
  run: |
    curl -o data/raw-linz.geojson "https://data.linz.govt.nz/..."
    npm run bob:geojson:convert data/raw-linz.geojson
    npm run bob:test:spatial
```

## References

- [LINZ Data Service Documentation](https://www.linz.govt.nz/data/linz-data-service)
- [NZ Territorial Authority Boundaries](https://data.linz.govt.nz/layer/1573-nz-territorial-authorities/)
- [GeoJSON RFC 7946](https://tools.ietf.org/html/rfc7946)
- [Polygon in Polygon Detection (Ray Casting Algorithm)](https://en.wikipedia.org/wiki/Point_in_polygon)

## Support

For issues or questions:
1. Check test output: `npm run bob:test:spatial`
2. Validate GeoJSON: `npm run bob:geojson:convert data/raw-*.geojson --verbose`
3. Review council bylaws: Check local council websites for current enforcement thresholds
