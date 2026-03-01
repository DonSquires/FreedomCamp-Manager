import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// ---------------------------------------------------------------------------
// Data Sources
// ---------------------------------------------------------------------------
// 1. DOC Campsites – Public ArcGIS GeoJSON endpoint (no API key required)
//    https://doc-deptconservation.opendata.arcgis.com/
const DOC_CAMPSITES_URL =
  "https://services2.arcgis.com/b5ADKIcWivL5vNaV/arcgis/rest/services/DOC_Campsites/FeatureServer/0/query"
  + "?where=1%3D1&outFields=*&f=geojson";

// Future data sources (require API keys or partnerships):
// - CamperMate:       https://campermate.com          (no public API)
// - Rankers/CampingNZ: https://camping-nz.rankers.co.nz (no public API)
// - WikiCamps NZ:     https://wikicamps.co              (no public API)
// - Holiday Parks NZ: https://holidayparks.co.nz        (no public API)

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ---------------------------------------------------------------------------
// Point-in-polygon (ray-casting algorithm)
// ---------------------------------------------------------------------------
function isPointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > lat) !== (yj > lat))
      && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function isPointInGeometry(lng: number, lat: number, geometry: any): boolean {
  if (!geometry) return false;
  if (geometry.type === 'Polygon') {
    return isPointInRing(lng, lat, geometry.coordinates[0]);
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some((poly: number[][][]) =>
      isPointInRing(lng, lat, poly[0])
    );
  }
  return false;
}

// ---------------------------------------------------------------------------
// Fetch organization jurisdiction zones for spatial matching
// ---------------------------------------------------------------------------
interface OrgZone {
  org_id: string;
  org_name: string;
  zone_id: string;
  geometry: any;
}

async function fetchOrgZones(): Promise<OrgZone[]> {
  // Fetch all jurisdiction zones (zone_type='general') with their geometry
  const { data: zones, error } = await supabase
    .from('zones')
    .select('id, organization_id, geometry')
    .eq('zone_type', 'general')
    .not('geometry', 'is', null);

  if (error) throw new Error(`Failed to fetch zones: ${error.message}`);
  if (!zones || zones.length === 0) {
    throw new Error(
      "No jurisdiction zones found. Run the territorial authority import first:\n"
      + "  IMPORT_MODE=territorial npx ts-node scripts/import_boundaries.ts"
    );
  }

  // Fetch organization names
  const orgIds = [...new Set(zones.map(z => z.organization_id))];
  const { data: orgs, error: orgErr } = await supabase
    .from('organizations')
    .select('id, name')
    .in('id', orgIds);

  if (orgErr) throw new Error(`Failed to fetch organizations: ${orgErr.message}`);

  const orgMap = new Map((orgs || []).map(o => [o.id, o.name]));

  return zones
    .filter(z => z.geometry && (z.geometry.type === 'Polygon' || z.geometry.type === 'MultiPolygon'))
    .map(z => ({
      org_id: z.organization_id,
      org_name: orgMap.get(z.organization_id) || 'Unknown',
      zone_id: z.id,
      geometry: z.geometry,
    }));
}

function findOrgForPoint(lng: number, lat: number, orgZones: OrgZone[]): OrgZone | null {
  for (const oz of orgZones) {
    if (isPointInGeometry(lng, lat, oz.geometry)) {
      return oz;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Import DOC Campsites
// ---------------------------------------------------------------------------
async function importDocCampsites(orgZones: OrgZone[]) {
  console.log("📡 Fetching DOC campsites from ArcGIS Open Data...");

  const response = await fetch(DOC_CAMPSITES_URL);
  if (!response.ok) {
    throw new Error(`DOC ArcGIS request failed: ${response.status} ${response.statusText}`);
  }

  const geojson = await response.json();
  const features = geojson.features || [];
  console.log(`🏕️  Downloaded ${features.length} DOC campsites.`);

  // Pre-fetch existing DOC campsite zones to avoid N+1 queries
  const existingZones = new Map<string, string>();
  const { data: existingData } = await supabase
    .from('zones')
    .select('id, name')
    .eq('boundary_source', 'doc_campsites');

  if (existingData) {
    for (const z of existingData) {
      existingZones.set(z.name, z.id);
    }
  }
  console.log(`   Found ${existingZones.size} existing DOC campsite zones.`);

  let createdCount = 0;
  let updatedCount = 0;
  let unmatchedCount = 0;
  let skipCount = 0;

  for (const feature of features) {
    const props = feature.properties || {};
    const name = props.name || props.Name || props.NAME;
    if (!name) {
      skipCount++;
      continue;
    }

    // Get coordinates from GeoJSON geometry (Point)
    let lng: number, lat: number;
    if (feature.geometry?.type === 'Point' && feature.geometry.coordinates) {
      [lng, lat] = feature.geometry.coordinates;
    } else if (props.longitude && props.latitude) {
      lng = parseFloat(props.longitude);
      lat = parseFloat(props.latitude);
    } else if (props.Longitude && props.Latitude) {
      lng = parseFloat(props.Longitude);
      lat = parseFloat(props.Latitude);
    } else {
      skipCount++;
      continue;
    }

    // Find which organization this campsite belongs to
    const org = findOrgForPoint(lng, lat, orgZones);
    if (!org) {
      unmatchedCount++;
      continue;
    }

    const zoneName = name;
    const description = [
      props.place || props.Place || '',
      props.region || props.Region || '',
      props.scenario || props.Scenario || '',
    ].filter(Boolean).join(' · ') || null;

    const existingId = existingZones.get(zoneName);

    if (existingId) {
      // Update existing zone
      const { error: updateErr } = await supabase
        .from('zones')
        .update({
          description,
          location_lat: lat,
          location_lng: lng,
          organization_id: org.org_id,
          parent_zone_id: org.zone_id,
          boundary_source: 'doc_campsites',
        })
        .eq('id', existingId);

      if (updateErr) {
        console.error(`   ❌ Update failed for '${zoneName}': ${updateErr.message}`);
      } else {
        updatedCount++;
      }
    } else {
      // Create new enforcement zone
      const { error: insertErr } = await supabase
        .from('zones')
        .insert({
          name: zoneName,
          description,
          organization_id: org.org_id,
          zone_type: 'specific',
          parent_zone_id: org.zone_id,
          location_lat: lat,
          location_lng: lng,
          boundary_source: 'doc_campsites',
          is_active: true,
        });

      if (insertErr) {
        console.error(`   ❌ Insert failed for '${zoneName}': ${insertErr.message}`);
      } else {
        createdCount++;
      }
    }
  }

  console.log(`\n🏕️  DOC CAMPSITES IMPORT COMPLETE`);
  console.log(`✅ Created:    ${createdCount} zones`);
  console.log(`🔄 Updated:    ${updatedCount} zones`);
  console.log(`🗺️  Unmatched:  ${unmatchedCount} (no org boundary contains this point)`);
  console.log(`⏭️  Skipped:    ${skipCount} (missing name or coordinates)`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("🚀 Campsite Zone Import");
  console.log("   Data sources: DOC Campsites (ArcGIS Open Data)");
  console.log("   Future: CamperMate, Rankers, WikiCamps, Holiday Parks NZ\n");

  // Step 1: Load organization jurisdiction zones for spatial matching
  console.log("📂 Loading organization jurisdiction zones...");
  const orgZones = await fetchOrgZones();
  console.log(`   Loaded ${orgZones.length} jurisdiction zone boundaries.`);
  console.log(`   Organizations: ${orgZones.map(z => z.org_name).join(', ')}\n`);

  // Step 2: Import DOC campsites
  await importDocCampsites(orgZones);
}

main().catch((err) => {
  console.error("\n💥 FATAL ERROR:", err.message || err);
  process.exit(1);
});
