import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// ---------------------------------------------------------------------------
// Data Sources – All public ArcGIS endpoints (no API keys required)
// ---------------------------------------------------------------------------

// 1. DOC Campsites – ~300 conservation campsites (Point)
//    https://doc-deptconservation.opendata.arcgis.com/
const DOC_CAMPSITES_URL =
  "https://services1.arcgis.com/3JjYDyG3oajxU6HO/arcgis/rest/services/DOC_Campsites/FeatureServer/0/query"
  + "?where=1%3D1&outFields=*&f=geojson";

// 2. DOC Huts – ~950 backcountry huts (Point)
//    https://doc-deptconservation.opendata.arcgis.com/datasets/doc-huts
const DOC_HUTS_URL =
  "https://services1.arcgis.com/3JjYDyG3oajxU6HO/arcgis/rest/services/DOC_Huts/FeatureServer/0/query"
  + "?where=1%3D1&outFields=*&f=geojson";

// 3. DOC Freedom Camping Sites – restriction/allowance polygons (Polygon)
//    Shows where freedom camping is prohibited or restricted to self-contained
const DOC_FREEDOM_CAMPING_URL =
  "https://services1.arcgis.com/3JjYDyG3oajxU6HO/ArcGIS/rest/services/DOCFreedomCamping/FeatureServer/0/query"
  + "?where=1%3D1&outFields=*&f=geojson";

// 4. LINZ Managed Crown Property – Crown land parcels (Polygon, ~106MB)
//    Public FeatureServer, CC BY 4.0 license
//    https://services.arcgis.com/xdsHIIxuCWByZiCB/arcgis/rest/services/LINZ_Managed_Crown_Property/FeatureServer
const LINZ_CROWN_PROPERTY_URL =
  "https://services.arcgis.com/xdsHIIxuCWByZiCB/arcgis/rest/services/LINZ_Managed_Crown_Property/FeatureServer/0/query"
  + "?where=1%3D1&outFields=*&f=geojson&resultRecordCount=5000";

// 5. Council freedom camping data (ArcGIS, public)
//    Waikato:       https://data-waikatolass.opendata.arcgis.com/datasets/freedom-camping
//    Nelson:        https://data-nelsoncity.opendata.arcgis.com/ (NelsonCamping FeatureServer)
//    Christchurch:  https://opendata-christchurchcity.hub.arcgis.com/datasets/freedom-camping-management-zone-opendata
//
//    Councils without public freedom camping FeatureServer (covered by DOC data):
//    - Tasman:        https://geohub.tasman.govt.nz/ (GeoHub portal, no camping layer)
//    - Queenstown:    https://data-lakes.opendata.arcgis.com/ (no camping layer found)
//    - Marlborough:   https://smartmaps.marlborough.govt.nz/ (web viewer only)
//    - Wellington:    https://data-wcc.opendata.arcgis.com/ (no camping layer found)
const COUNCIL_FREEDOM_CAMPING_URLS: { council: string; url: string }[] = [
  {
    council: "Waikato",
    url: "https://services3.arcgis.com/Oou6z70yKcGvIDxP/arcgis/rest/services/Freedom_Camping/FeatureServer/0/query"
      + "?where=1%3D1&outFields=*&f=geojson",
  },
  {
    council: "Nelson",
    url: "https://services1.arcgis.com/Y4k7lyf2XTGeQC6V/ArcGIS/rest/services/NelsonCamping/FeatureServer/0/query"
      + "?where=1%3D1&outFields=*&f=geojson",
  },
  {
    council: "Christchurch",
    url: "https://gis.ccc.govt.nz/server/rest/services/OpenData/Regulatory/FeatureServer/5/query"
      + "?where=1%3D1&outFields=*&f=geojson",
  },
];

// Future data sources (no public API available):
// - CamperMate:            https://campermate.com                (no public API)
// - Rankers/CampingNZ:     https://camping-nz.rankers.co.nz      (no public API)
// - WikiCamps NZ:          https://wikicamps.co                   (no public API)
// - Holiday Parks NZ:      https://holidayparks.co.nz             (no public API)
// - Travellers Autobarn:   https://travellers-autobarn.co.nz      (rental company, recommends CamperMate/Rankers)
// - NZYourWay:             https://nzyourway.com                  (aggregator map, no API)

// Control which sources to import (env var, comma-separated)
const IMPORT_SOURCES = (process.env.IMPORT_SOURCES || "all").toLowerCase().split(",").map(s => s.trim());

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

// Compute centroid of a polygon ring
function ringCentroid(ring: number[][]): [number, number] {
  let sumLng = 0, sumLat = 0;
  const n = ring.length > 1 ? ring.length - 1 : ring.length; // skip closing point
  for (let i = 0; i < n; i++) {
    sumLng += ring[i][0];
    sumLat += ring[i][1];
  }
  return [sumLng / n, sumLat / n];
}

function geometryCentroid(geometry: any): [number, number] | null {
  if (!geometry) return null;
  if (geometry.type === 'Point') return geometry.coordinates as [number, number];
  if (geometry.type === 'Polygon' && geometry.coordinates?.[0]) {
    return ringCentroid(geometry.coordinates[0]);
  }
  if (geometry.type === 'MultiPolygon' && geometry.coordinates?.[0]?.[0]) {
    return ringCentroid(geometry.coordinates[0][0]);
  }
  return null;
}

// Find which org a polygon belongs to by checking if its centroid falls within an org zone
function findOrgForGeometry(geometry: any, orgZones: OrgZone[]): OrgZone | null {
  const centroid = geometryCentroid(geometry);
  if (!centroid) return null;
  return findOrgForPoint(centroid[0], centroid[1], orgZones);
}

// Generic helper to upsert a zone (point or polygon)
interface ZoneUpsertParams {
  name: string;
  description: string | null;
  orgId: string;
  parentZoneId: string;
  lat: number;
  lng: number;
  geometry?: any;         // polygon geometry (if available)
}

async function upsertZone(
  params: ZoneUpsertParams,
  existingZones: Map<string, string>,
  counters: { created: number; updated: number }
): Promise<void> {
  const lookupKey = `${params.orgId}::${params.name.trim().toLowerCase()}`;
  const existingId = existingZones.get(lookupKey);

  if (existingId) {
    const updateData: any = {
      description: params.description,
      location_lat: params.lat,
      location_lng: params.lng,
      organization_id: params.orgId,
      parent_zone_id: params.parentZoneId,
    };
    if (params.geometry) {
      updateData.geometry = params.geometry;
    }
    const { error } = await supabase
      .from('zones')
      .update(updateData)
      .eq('id', existingId);

    if (error) {
      console.error(`   ❌ Update failed for '${params.name}': ${error.message}`);
    } else {
      counters.updated++;
    }
  } else {
    const insertData: any = {
      name: params.name,
      description: params.description,
      organization_id: params.orgId,
      zone_type: 'specific',
      parent_zone_id: params.parentZoneId,
      location_lat: params.lat,
      location_lng: params.lng,
      is_active: true,
    };
    if (params.geometry) {
      insertData.geometry = params.geometry;
    }
    const { error } = await supabase
      .from('zones')
      .insert(insertData);

    if (error) {
      console.error(`   ❌ Insert failed for '${params.name}': ${error.message}`);
    } else {
      const { data: inserted } = await supabase
        .from('zones')
        .select('id')
        .eq('name', params.name)
        .eq('organization_id', params.orgId)
        .eq('zone_type', 'specific')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (inserted?.id) {
        existingZones.set(lookupKey, inserted.id);
      }
      counters.created++;
    }
  }
}

// ---------------------------------------------------------------------------
// Pre-fetch existing zones by boundary_source to avoid N+1 queries
// ---------------------------------------------------------------------------
async function fetchExistingZones(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const { data } = await supabase
    .from('zones')
    .select('id, name, organization_id')
    .eq('zone_type', 'specific');

  if (data) {
    for (const z of data) {
      map.set(`${z.organization_id}::${z.name.trim().toLowerCase()}`, z.id);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Source 1: DOC Campsites (~300 conservation campsites)
// ---------------------------------------------------------------------------
async function importDocCampsites(orgZones: OrgZone[]) {
  console.log("📡 Fetching DOC campsites from ArcGIS Open Data...");

  const response = await fetch(DOC_CAMPSITES_URL);
  if (!response.ok) {
    throw new Error(`DOC Campsites request failed: ${response.status} ${response.statusText}`);
  }

  const geojson = await response.json();
  const features = geojson.features || [];
  console.log(`🏕️  Downloaded ${features.length} DOC campsites.`);

  const existingZones = await fetchExistingZones();
  console.log(`   Found ${existingZones.size} existing DOC campsite zones.`);

  const counters = { created: 0, updated: 0 };
  let unmatchedCount = 0;
  let skipCount = 0;

  for (const feature of features) {
    const props = feature.properties || {};
    const name = props.name || props.Name || props.NAME;
    if (!name) { skipCount++; continue; }

    let lng: number, lat: number;
    if (feature.geometry?.type === 'Point' && feature.geometry.coordinates) {
      [lng, lat] = feature.geometry.coordinates;
    } else if (props.longitude && props.latitude) {
      lng = parseFloat(props.longitude);
      lat = parseFloat(props.latitude);
    } else if (props.Longitude && props.Latitude) {
      lng = parseFloat(props.Longitude);
      lat = parseFloat(props.Latitude);
    } else { skipCount++; continue; }

    const org = findOrgForPoint(lng, lat, orgZones);
    if (!org) { unmatchedCount++; continue; }

    const description = [
      props.place || props.Place || '',
      props.region || props.Region || '',
      props.scenario || props.Scenario || '',
    ].filter(Boolean).join(' · ') || null;

    await upsertZone({
      name, description,
      orgId: org.org_id, parentZoneId: org.zone_id,
      lat, lng,
    }, existingZones, counters);
  }

  console.log(`\n🏕️  DOC CAMPSITES IMPORT COMPLETE`);
  console.log(`✅ Created:    ${counters.created} zones`);
  console.log(`🔄 Updated:    ${counters.updated} zones`);
  console.log(`🗺️  Unmatched:  ${unmatchedCount} (no org boundary contains this point)`);
  console.log(`⏭️  Skipped:    ${skipCount} (missing name or coordinates)`);
}

// ---------------------------------------------------------------------------
// Source 2: DOC Huts (~950 backcountry huts)
// ---------------------------------------------------------------------------
async function importDocHuts(orgZones: OrgZone[]) {
  console.log("\n📡 Fetching DOC huts from ArcGIS Open Data...");

  const response = await fetch(DOC_HUTS_URL);
  if (!response.ok) {
    throw new Error(`DOC Huts request failed: ${response.status} ${response.statusText}`);
  }

  const geojson = await response.json();
  const features = geojson.features || [];
  console.log(`🛖  Downloaded ${features.length} DOC huts.`);

  const existingZones = await fetchExistingZones();
  console.log(`   Found ${existingZones.size} existing DOC hut zones.`);

  const counters = { created: 0, updated: 0 };
  let unmatchedCount = 0;
  let skipCount = 0;

  for (const feature of features) {
    const props = feature.properties || {};
    const name = props.name || props.Name || props.NAME;
    if (!name) { skipCount++; continue; }

    let lng: number, lat: number;
    if (feature.geometry?.type === 'Point' && feature.geometry.coordinates) {
      [lng, lat] = feature.geometry.coordinates;
    } else { skipCount++; continue; }

    const org = findOrgForPoint(lng, lat, orgZones);
    if (!org) { unmatchedCount++; continue; }

    const description = [
      props.place || props.Place || '',
      props.region || props.Region || '',
      props.hutCategory || props.HutCategory || '',
      props.status || props.Status || '',
    ].filter(Boolean).join(' · ') || null;

    await upsertZone({
      name, description,
      orgId: org.org_id, parentZoneId: org.zone_id,
      lat, lng,
    }, existingZones, counters);
  }

  console.log(`\n🛖  DOC HUTS IMPORT COMPLETE`);
  console.log(`✅ Created:    ${counters.created} zones`);
  console.log(`🔄 Updated:    ${counters.updated} zones`);
  console.log(`🗺️  Unmatched:  ${unmatchedCount}`);
  console.log(`⏭️  Skipped:    ${skipCount}`);
}

// ---------------------------------------------------------------------------
// Source 3: DOC Freedom Camping Sites (restriction/allowance polygons)
// ---------------------------------------------------------------------------
async function importDocFreedomCamping(orgZones: OrgZone[]) {
  console.log("\n📡 Fetching DOC freedom camping sites from ArcGIS...");

  const response = await fetch(DOC_FREEDOM_CAMPING_URL);
  if (!response.ok) {
    throw new Error(`DOC Freedom Camping request failed: ${response.status} ${response.statusText}`);
  }

  const geojson = await response.json();
  const features = geojson.features || [];
  console.log(`🏕️  Downloaded ${features.length} DOC freedom camping areas.`);

  const existingZones = await fetchExistingZones();
  console.log(`   Found ${existingZones.size} existing DOC freedom camping zones.`);

  const counters = { created: 0, updated: 0 };
  let unmatchedCount = 0;
  let skipCount = 0;

  for (const feature of features) {
    const props = feature.properties || {};
    const name = props.name || props.Name || props.NAME || props.SiteName || props.SITENAME;
    if (!name) { skipCount++; continue; }

    const org = findOrgForGeometry(feature.geometry, orgZones);
    if (!org) { unmatchedCount++; continue; }

    const centroid = geometryCentroid(feature.geometry);
    if (!centroid) { skipCount++; continue; }

    const restriction = props.restriction || props.Restriction || props.RESTRICTION || '';
    const description = [
      restriction ? `Restriction: ${restriction}` : '',
      props.region || props.Region || '',
      props.place || props.Place || '',
    ].filter(Boolean).join(' · ') || null;

    await upsertZone({
      name, description,
      orgId: org.org_id, parentZoneId: org.zone_id,
      lat: centroid[1], lng: centroid[0],
      geometry: feature.geometry,
    }, existingZones, counters);
  }

  console.log(`\n🏕️  DOC FREEDOM CAMPING IMPORT COMPLETE`);
  console.log(`✅ Created:    ${counters.created} zones`);
  console.log(`🔄 Updated:    ${counters.updated} zones`);
  console.log(`🗺️  Unmatched:  ${unmatchedCount}`);
  console.log(`⏭️  Skipped:    ${skipCount}`);
}

// ---------------------------------------------------------------------------
// Source 4: LINZ Managed Crown Property (Crown land parcels)
// ---------------------------------------------------------------------------
async function importLinzCrownProperty(orgZones: OrgZone[]) {
  console.log("\n📡 Fetching LINZ Managed Crown Property from ArcGIS...");
  console.log("   ⚠️  Large dataset (~106MB). Fetching first 5000 records; run multiple times with pagination for full import.");

  const response = await fetch(LINZ_CROWN_PROPERTY_URL);
  if (!response.ok) {
    throw new Error(`LINZ Crown Property request failed: ${response.status} ${response.statusText}`);
  }

  const geojson = await response.json();
  const features = geojson.features || [];
  console.log(`👑 Downloaded ${features.length} LINZ Crown properties.`);

  const existingZones = await fetchExistingZones();
  console.log(`   Found ${existingZones.size} existing LINZ Crown property zones.`);

  const counters = { created: 0, updated: 0 };
  let unmatchedCount = 0;
  let skipCount = 0;

  for (const feature of features) {
    const props = feature.properties || {};
    // LINZ Crown Property typically uses PropertyName, Land_Distr, or similar fields
    const propertyName = props.PropertyName || props.PROPERTYNAME
      || props.Property_Name || props.property_name
      || props.napalis_id
      || props.OBJECTID
      || props.Name || props.name || props.NAME;
    const landDistrict = props.Land_Distr || props.LandDistrict || props.LAND_DISTR || '';
    const purpose = props.Purpose || props.PURPOSE || props.purpose || props.land_use || '';
    const agency = props.ManagingAgency || props.Managing_Agency || props.MANAGING_AGENCY || '';

    if (!propertyName) { skipCount++; continue; }

    const org = findOrgForGeometry(feature.geometry, orgZones);
    if (!org) { unmatchedCount++; continue; }

    const centroid = geometryCentroid(feature.geometry);
    if (!centroid) { skipCount++; continue; }

    const zoneName = `Crown: ${String(propertyName)}`;
    const description = [
      purpose ? `Purpose: ${purpose}` : '',
      agency ? `Agency: ${agency}` : '',
      landDistrict ? `District: ${landDistrict}` : '',
    ].filter(Boolean).join(' · ') || null;

    await upsertZone({
      name: zoneName, description,
      orgId: org.org_id, parentZoneId: org.zone_id,
      lat: centroid[1], lng: centroid[0],
      geometry: feature.geometry,
    }, existingZones, counters);
  }

  console.log(`\n👑 LINZ CROWN PROPERTY IMPORT COMPLETE`);
  console.log(`✅ Created:    ${counters.created} zones`);
  console.log(`🔄 Updated:    ${counters.updated} zones`);
  console.log(`🗺️  Unmatched:  ${unmatchedCount}`);
  console.log(`⏭️  Skipped:    ${skipCount}`);
}

// ---------------------------------------------------------------------------
// Source 5: Council Freedom Camping (Waikato, Nelson, Christchurch, ...)
// ---------------------------------------------------------------------------
async function importCouncilFreedomCamping(orgZones: OrgZone[]) {
  const existingZones = await fetchExistingZones();
  console.log(`\n📂 Found ${existingZones.size} existing council freedom camping zones.`);

  const totalCounters = { created: 0, updated: 0 };
  let totalUnmatched = 0;
  let totalSkipped = 0;

  for (const { council, url } of COUNCIL_FREEDOM_CAMPING_URLS) {
    console.log(`\n📡 Fetching ${council} council freedom camping data...`);

    let response: Response;
    try {
      response = await fetch(url);
    } catch (err: any) {
      console.warn(`   ⚠️  ${council} request failed: ${err.message} – skipping.`);
      continue;
    }
    if (!response.ok) {
      console.warn(`   ⚠️  ${council} request failed: ${response.status} – skipping.`);
      continue;
    }

    const geojson = await response.json();
    const features = geojson.features || [];
    console.log(`🏛️  Downloaded ${features.length} ${council} freedom camping areas.`);

    const counters = { created: 0, updated: 0 };
    let unmatchedCount = 0;
    let skipCount = 0;

    for (const feature of features) {
      const props = feature.properties || {};
      const name = props.SiteName || props.Site_Name || props.name || props.Name || props.NAME
        || props.Label || props.LABEL || props.Location || props.LOCATION
        || props.LocationName || props.location_name || props.Location_Name
        || props.FreedomCampingManagementZoneID || props.OBJECTID;
      if (!name) { skipCount++; continue; }

      // Try centroid-based org matching
      const centroid = geometryCentroid(feature.geometry);
      if (!centroid) { skipCount++; continue; }

      const org = findOrgForPoint(centroid[0], centroid[1], orgZones);
      if (!org) { unmatchedCount++; continue; }

      const restriction = props.Classification || props.Restriction || props.STATUS
        || props.Type || props.type || props.CampingType || '';
      const description = [
        restriction ? `${restriction}` : '',
        `Council: ${council}`,
      ].filter(Boolean).join(' · ') || null;

      const zoneName = `${council}: ${name}`;

      await upsertZone({
        name: zoneName, description,
        orgId: org.org_id, parentZoneId: org.zone_id,
        lat: centroid[1], lng: centroid[0],
      // includes('Polygon') matches both 'Polygon' and 'MultiPolygon' types
        geometry: feature.geometry?.type?.includes('Polygon') ? feature.geometry : undefined,
      }, existingZones, counters);
    }

    console.log(`   ✅ ${council}: Created ${counters.created}, Updated ${counters.updated}, Unmatched ${unmatchedCount}, Skipped ${skipCount}`);
    totalCounters.created += counters.created;
    totalCounters.updated += counters.updated;
    totalUnmatched += unmatchedCount;
    totalSkipped += skipCount;
  }

  console.log(`\n🏛️  COUNCIL FREEDOM CAMPING IMPORT COMPLETE`);
  console.log(`✅ Created:    ${totalCounters.created} zones`);
  console.log(`🔄 Updated:    ${totalCounters.updated} zones`);
  console.log(`🗺️  Unmatched:  ${totalUnmatched}`);
  console.log(`⏭️  Skipped:    ${totalSkipped}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function shouldImport(source: string): boolean {
  return IMPORT_SOURCES.includes('all') || IMPORT_SOURCES.includes(source);
}

async function main() {
  console.log("🚀 Zone Import – NZ Public Data Sources");
  console.log("   Available: doc_campsites, doc_huts, doc_freedom_camping, linz_crown, council");
  console.log(`   Importing: ${IMPORT_SOURCES.join(', ')}\n`);

  // Step 1: Load organization jurisdiction zones for spatial matching
  console.log("📂 Loading organization jurisdiction zones...");
  const orgZones = await fetchOrgZones();
  console.log(`   Loaded ${orgZones.length} jurisdiction zone boundaries.`);
  console.log(`   Organizations: ${orgZones.map(z => z.org_name).join(', ')}\n`);

  // Step 2: Import from each enabled source
  const runSource = async (label: string, task: () => Promise<void>) => {
    try {
      await task();
    } catch (err: any) {
      console.warn(`\n⚠️  ${label} import failed: ${err?.message || err}`);
      console.warn(`   Continuing with remaining sources...`);
    }
  };

  if (shouldImport('doc_campsites')) {
    await runSource('DOC campsites', () => importDocCampsites(orgZones));
  }

  if (shouldImport('doc_huts')) {
    await runSource('DOC huts', () => importDocHuts(orgZones));
  }

  if (shouldImport('doc_freedom_camping')) {
    await runSource('DOC freedom camping', () => importDocFreedomCamping(orgZones));
  }

  if (shouldImport('linz_crown')) {
    await runSource('LINZ crown property', () => importLinzCrownProperty(orgZones));
  }

  if (shouldImport('council')) {
    await runSource('Council freedom camping', () => importCouncilFreedomCamping(orgZones));
  }

  console.log("\n🎉 ALL IMPORTS COMPLETE");
}

main().catch((err) => {
  console.error("\n💥 FATAL ERROR:", err.message || err);
  process.exit(1);
});
