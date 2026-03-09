import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// ---------------------------------------------------------------------------
// Data Sources
// ---------------------------------------------------------------------------
// GeoBoundaries (public, no API key) — Stats NZ sourced for New Zealand.
//   ADM2 Territorial Authorities: https://www.geoboundaries.org/api/current/gbOpen/NZL/ADM2/
//   ADM1 Regions:                https://www.geoboundaries.org/api/current/gbOpen/NZL/ADM1/
//
// Stats NZ Geographic Data Service (requires STATSNZ_API_KEY)
//   TA 2025 (Clipped to coastline): https://datafinder.stats.govt.nz/layer/120962-territorial-authority-2025-clipped/
//   TA 2025 (Generalised):          https://datafinder.stats.govt.nz/layer/120963-territorial-authority-2025/
//   Meshblock 2025:                 https://datafinder.stats.govt.nz/layer/120980-meshblock-2025/
//
// NZTA / Waka Kotahi Open Data (public, no API key needed — used as fallback)
//   TA Boundaries: https://opendata-nzta.opendata.arcgis.com/
//
// LINZ Data Service (requires LINZ_API_KEY — for land district boundaries)
//   Land Districts: https://data.linz.govt.nz/layer/52070-landonline-land-district/
//
// LINZ Managed Crown Property (public, no API key — imported via import_campsites.ts)
//   Crown Land: https://services.arcgis.com/xdsHIIxuCWByZiCB/arcgis/rest/services/LINZ_Managed_Crown_Property/FeatureServer
const LAYER_IDS = {
  territorial: "120962", // Clipped to coastline – more accurate for geofencing
  meshblock: "120980",
};

const GEOBOUNDARIES_ADM1_META_URL = 'https://www.geoboundaries.org/api/current/gbOpen/NZL/ADM1/';
const GEOBOUNDARIES_ADM2_META_URL = 'https://www.geoboundaries.org/api/current/gbOpen/NZL/ADM2/';

const ORG_BOUNDARY_ALIASES: Record<string, string[]> = {
  'Hutt City Council': ['Lower Hutt City'],
  'Rotorua Lakes Council': ['Rotorua District'],
  'Opotiki District Council': ['Opotiki District', 'Opotiki'],
  'Otorohanga District Council': ['Otorohanga District', 'Otorohanga'],
};

const STATSNZ_API_KEY = process.env.STATSNZ_API_KEY;
const IMPORT_MODE = (process.env.IMPORT_MODE || "territorial") as keyof typeof LAYER_IDS;
const ORGANIZATION_ID = process.env.ORGANIZATION_ID; // Required for meshblock mode
const IMPORT_BBOX = process.env.IMPORT_BBOX; // Optional: "minLng,minLat,maxLng,maxLat"

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

let zoneBoundarySourceSupported: boolean | null = null;
let organizationsGeomSupported: boolean | null = null;

interface GeoBoundariesMeta {
  gjDownloadURL?: string;
}

interface BoundaryFeature {
  properties?: Record<string, any>;
  geometry?: any;
}

interface BoundaryDataset {
  features: BoundaryFeature[];
}

async function supportsZoneBoundarySource(): Promise<boolean> {
  if (zoneBoundarySourceSupported !== null) return zoneBoundarySourceSupported;

  const { data, error } = await supabase
    .from('zones')
    .select('boundary_source')
    .limit(1);

  if (error && /boundary_source/i.test(error.message || '')) {
    zoneBoundarySourceSupported = false;
    return zoneBoundarySourceSupported;
  }

  zoneBoundarySourceSupported = true;
  return zoneBoundarySourceSupported;
}

async function supportsOrganizationsGeom(): Promise<boolean> {
  if (organizationsGeomSupported !== null) return organizationsGeomSupported;

  const { error } = await (supabase.from('organizations') as any)
    .select('geom')
    .limit(1);

  if (error && /geom/i.test(error.message || '')) {
    organizationsGeomSupported = false;
    return organizationsGeomSupported;
  }

  organizationsGeomSupported = true;
  return organizationsGeomSupported;
}

function buildWfsUrl(layerId: string, bbox?: string): string | null {
  if (!STATSNZ_API_KEY) return null;
  let url = `https://datafinder.stats.govt.nz/services;key=${STATSNZ_API_KEY}/wfs`
    + `?service=WFS&version=2.0.0&request=GetFeature`
    + `&typeNames=layer-${layerId}`
    + `&outputFormat=application/json`;
  if (bbox) {
    url += `&BBOX=${bbox}`;
  }
  return url;
}

function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\(.*?\)/g, ' ')
    .replace(/[-_']/g, ' ')
    .replace(/\bcity council\b|\bdistrict council\b|\bregional council\b|\bcouncil\b|\bdistrict\b|\bcity\b|\bregion\b|\bte\b|\bthe\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

async function fetchGeoBoundariesDataset(metaUrl: string): Promise<BoundaryDataset> {
  const metaRes = await fetch(metaUrl);
  if (!metaRes.ok) {
    throw new Error(`GeoBoundaries metadata request failed: ${metaRes.status} ${metaRes.statusText}`);
  }

  const meta = (await metaRes.json()) as GeoBoundariesMeta;
  if (!meta.gjDownloadURL) {
    throw new Error(`GeoBoundaries metadata missing gjDownloadURL for ${metaUrl}`);
  }

  const dataRes = await fetch(meta.gjDownloadURL);
  if (!dataRes.ok) {
    throw new Error(`GeoBoundaries GeoJSON request failed: ${dataRes.status} ${dataRes.statusText}`);
  }

  const dataset = (await dataRes.json()) as BoundaryDataset;
  if (!Array.isArray(dataset.features)) {
    throw new Error('Invalid GeoBoundaries dataset: missing features array.');
  }

  return dataset;
}

async function updateOrganizationJurisdiction(orgId: string, geometry: any): Promise<void> {
  const canWriteOrgGeom = await supportsOrganizationsGeom();

  if (canWriteOrgGeom) {
    const { error: orgErr } = await (supabase.from('organizations') as any)
      .update({ geom: geometry })
      .eq('id', orgId);

    if (orgErr) {
      throw new Error(`organizations.geom update failed: ${orgErr.message}`);
    }
  }

  const { error: zoneErr } = await (supabase.from('zones') as any)
    .update({ geometry })
    .eq('organization_id', orgId)
    .eq('zone_type', 'general');

  if (zoneErr) {
    throw new Error(`zones.geometry update failed: ${zoneErr.message}`);
  }
}

function findFuzzyFeature(
  candidates: string[],
  sourceMap: Map<string, BoundaryFeature>,
): BoundaryFeature | undefined {
  const matches: BoundaryFeature[] = [];

  for (const [nameKey, feature] of sourceMap.entries()) {
    for (const candidate of candidates) {
      if (candidate.length < 4) continue;
      if (nameKey.includes(candidate) || candidate.includes(nameKey)) {
        matches.push(feature);
        break;
      }
    }
  }

  // Only accept fuzzy match when exactly one candidate is found.
  return matches.length === 1 ? matches[0] : undefined;
}

// ---------------------------------------------------------------------------
// Mode 1: Import Territorial Authority boundaries → match to organizations
// Uses Stats NZ (clipped coastline) as primary, NZTA as public fallback
// ---------------------------------------------------------------------------
async function importTerritorialAuthorities() {
  console.log('📡 Fetching jurisdiction boundaries from GeoBoundaries (Stats NZ source)...');

  const [adm1, adm2] = await Promise.all([
    fetchGeoBoundariesDataset(GEOBOUNDARIES_ADM1_META_URL),
    fetchGeoBoundariesDataset(GEOBOUNDARIES_ADM2_META_URL),
  ]);

  const adm1ByName = new Map<string, BoundaryFeature>();
  const adm2ByName = new Map<string, BoundaryFeature>();

  for (const feature of adm1.features) {
    const shapeName = String(feature.properties?.shapeName || '').trim();
    if (!shapeName || !feature.geometry) continue;
    adm1ByName.set(normalizeName(shapeName), feature);
  }

  for (const feature of adm2.features) {
    const shapeName = String(feature.properties?.shapeName || '').trim();
    if (!shapeName || !feature.geometry) continue;
    adm2ByName.set(normalizeName(shapeName), feature);
  }

  const { data: organizations, error: orgErr } = await (supabase.from('organizations') as any)
    .select('id, name')
    .eq('is_active', true)
    .order('name');

  if (orgErr) {
    throw new Error(`Failed to load organizations: ${orgErr.message}`);
  }

  console.log(`🗺️  Loaded ${adm1.features.length} ADM1 and ${adm2.features.length} ADM2 boundaries.`);
  console.log(`🏢 Matching ${organizations.length} active organizations...`);

  let successCount = 0;
  let skipCount = 0;

  for (const org of organizations) {
    const orgName = String(org.name || '').trim();
    const candidateNames = [orgName, ...(ORG_BOUNDARY_ALIASES[orgName] || [])];
    const normalizedCandidates = candidateNames.map(normalizeName);
    const isRegional = /regional council/i.test(orgName);

    let feature: BoundaryFeature | undefined;

    for (const candidate of normalizedCandidates) {
      feature = isRegional
        ? adm1ByName.get(candidate)
        : adm2ByName.get(candidate) || adm1ByName.get(candidate);
      if (feature) break;
    }

    if (!feature) {
      feature = isRegional
        ? findFuzzyFeature(normalizedCandidates, adm1ByName)
        : findFuzzyFeature(normalizedCandidates, adm2ByName) || findFuzzyFeature(normalizedCandidates, adm1ByName);
    }

    if (!feature?.geometry) {
      console.log(`   ⚠️  Skipping '${orgName}' - no boundary match found.`);
      skipCount++;
      continue;
    }

    try {
      await updateOrganizationJurisdiction(org.id, feature.geometry);
      console.log(`✅ MATCH: '${orgName}' -> '${feature.properties?.shapeName || 'Unknown'}'`);
      successCount++;
    } catch (err: any) {
      console.error(`   ❌ Update failed for '${orgName}': ${err.message}`);
      skipCount++;
    }
  }

  console.log(`\n🎉 JURISDICTION IMPORT COMPLETE`);
  console.log(`✅ Updated: ${successCount} organizations`);
  console.log(`⏭️  Skipped: ${skipCount} organizations`);
  console.log(`📚 Source: GeoBoundaries API (Stats NZ-derived TA + Region boundaries)`);
}

// ---------------------------------------------------------------------------
// Mode 2: Import Meshblock boundaries → create enforcement zones for an org
// ---------------------------------------------------------------------------
async function importMeshblocks() {
  if (!ORGANIZATION_ID) {
    throw new Error(
      "ORGANIZATION_ID environment variable is required for meshblock import.\n"
      + "Set it to the UUID of the organization you want to import meshblocks for."
    );
  }

  // Look up the organization and its parent zone
  const { data: org, error: orgErr } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('id', ORGANIZATION_ID)
    .single();

  if (orgErr || !org) {
    throw new Error(`Organization '${ORGANIZATION_ID}' not found: ${orgErr?.message}`);
  }

  const { data: parentZone } = await supabase
    .from('zones')
    .select('id')
    .eq('organization_id', org.id)
    .eq('zone_type', 'general')
    .limit(1)
    .single();

  console.log(`🏢 Importing meshblocks for: ${org.name}`);
  if (parentZone) {
    console.log(`   Parent zone ID: ${parentZone.id}`);
  } else {
    console.warn(`   ⚠️  No parent zone found – meshblocks will not have a parent_zone_id.`);
  }

  const url = buildWfsUrl(LAYER_IDS.meshblock, IMPORT_BBOX);
  if (!url) {
    throw new Error("STATSNZ_API_KEY environment variable is required. Register at https://datafinder.stats.govt.nz/ to obtain a key.");
  }

  console.log("📡 Fetching Meshblock boundaries from Stats NZ...");
  if (IMPORT_BBOX) {
    console.log(`   BBOX filter: ${IMPORT_BBOX}`);
  } else {
    console.warn("   ⚠️  No IMPORT_BBOX set – this will download ALL ~57,000 meshblocks. Consider setting IMPORT_BBOX=minLng,minLat,maxLng,maxLat");
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Stats NZ API request failed: ${response.status} ${response.statusText}`);
  }

  const geojson = await response.json();
  console.log(`🗺️  Downloaded ${geojson.features.length} Meshblock boundaries.`);

  // Pre-fetch existing meshblock zones for this org to avoid N+1 queries
  const existingZones = new Map<string, string>();
  const { data: existingData } = await supabase
    .from('zones')
    .select('id, name')
    .eq('organization_id', org.id)
    .like('name', 'Meshblock %');

  if (existingData) {
    for (const z of existingData) {
      existingZones.set(z.name, z.id);
    }
  }
  console.log(`   Found ${existingZones.size} existing meshblock zones for this org.`);

  let createdCount = 0;
  let updatedCount = 0;
  let skipCount = 0;
  const useBoundarySource = await supportsZoneBoundarySource();

  for (const feature of geojson.features) {
    const meshblockCode = feature.properties.MB2025_V1_00
      || feature.properties.MB2025
      || feature.properties.CODE;
    if (!meshblockCode) {
      skipCount++;
      continue;
    }

    // Skip water-only meshblocks (only import land areas)
    const landwater = feature.properties.LANDWATER_NAME || feature.properties.LANDWATER || "";
    if (typeof landwater === "string" && /oceanic|inland water/i.test(landwater)) {
      skipCount++;
      continue;
    }

    const zoneName = `Meshblock ${meshblockCode}`;
    const existingId = existingZones.get(zoneName);

    if (existingId) {
      // Update existing zone geometry
      const updateData: Record<string, any> = {
        geometry: feature.geometry,
      };
      if (useBoundarySource) {
        updateData.boundary_source = 'stats_nz_meshblock_2025';
      }

      const { error: updateErr } = await supabase
        .from('zones')
        .update(updateData)
        .eq('id', existingId);

      if (updateErr) {
        console.error(`   ❌ Update failed for ${zoneName}: ${updateErr.message}`);
      } else {
        updatedCount++;
      }
    } else {
      // Create new enforcement zone
      const insertData: Record<string, any> = {
        name: zoneName,
        organization_id: org.id,
        zone_type: 'specific',
        parent_zone_id: parentZone?.id || null,
        geometry: feature.geometry,
        is_active: true,
      };
      if (useBoundarySource) {
        insertData.boundary_source = 'stats_nz_meshblock_2025';
      }

      const { error: insertErr } = await supabase
        .from('zones')
        .insert(insertData);

      if (insertErr) {
        console.error(`   ❌ Insert failed for ${zoneName}: ${insertErr.message}`);
      } else {
        createdCount++;
      }
    }
  }

  console.log(`\n🎉 MESHBLOCK IMPORT COMPLETE`);
  console.log(`✅ Created:  ${createdCount} zones`);
  console.log(`🔄 Updated:  ${updatedCount} zones`);
  console.log(`⏭️  Skipped:  ${skipCount} (water-only or missing code)`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  if (!(IMPORT_MODE in LAYER_IDS)) {
    throw new Error(`Invalid IMPORT_MODE '${IMPORT_MODE}'. Use 'territorial' or 'meshblock'.`);
  }

  // Stats NZ API key is required for meshblock mode but optional for territorial
  // (territorial falls back to NZTA public endpoint)
  if (IMPORT_MODE === "meshblock" && !STATSNZ_API_KEY) {
    throw new Error("STATSNZ_API_KEY is required for meshblock import. Register at https://datafinder.stats.govt.nz/ to obtain a key.");
  }

  console.log(`🚀 Import mode: ${IMPORT_MODE}`);

  if (IMPORT_MODE === "meshblock") {
    await importMeshblocks();
  } else {
    await importTerritorialAuthorities();
  }
}

main().catch((err) => {
  console.error("\n💥 FATAL ERROR:", err.message || err);
  process.exit(1);
});
