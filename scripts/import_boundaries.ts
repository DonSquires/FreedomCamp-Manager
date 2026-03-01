import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// ---------------------------------------------------------------------------
// Data Sources
// ---------------------------------------------------------------------------
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

// NZTA public fallback endpoint (no API key required)
const NZTA_TA_URL =
  "https://spatial.nzta.govt.nz/portal/rest/services/Hosted/Territorial_Authority_Boundaries/FeatureServer/0/query"
  + "?where=1%3D1&outFields=*&f=geojson";

const STATSNZ_API_KEY = process.env.STATSNZ_API_KEY;
const IMPORT_MODE = (process.env.IMPORT_MODE || "territorial") as keyof typeof LAYER_IDS;
const ORGANIZATION_ID = process.env.ORGANIZATION_ID; // Required for meshblock mode
const IMPORT_BBOX = process.env.IMPORT_BBOX; // Optional: "minLng,minLat,maxLng,maxLat"

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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

// ---------------------------------------------------------------------------
// Mode 1: Import Territorial Authority boundaries → match to organizations
// Uses Stats NZ (clipped coastline) as primary, NZTA as public fallback
// ---------------------------------------------------------------------------
async function importTerritorialAuthorities() {
  let url = buildWfsUrl(LAYER_IDS.territorial);
  let source = "Stats NZ (layer 120962 – clipped to coastline)";
  let useNztaFallback = false;

  if (!url) {
    // Fallback to NZTA public endpoint (no API key required)
    console.log("ℹ️  STATSNZ_API_KEY not set – using NZTA public data as fallback.");
    console.log("   For best results, register at https://datafinder.stats.govt.nz/ and set STATSNZ_API_KEY.\n");
    url = NZTA_TA_URL;
    source = "NZTA / Waka Kotahi (public ArcGIS)";
    useNztaFallback = true;
  }

  console.log(`📡 Fetching Territorial Authority boundaries from ${source}...`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }

  const geojson = await response.json();
  console.log(`🗺️  Downloaded ${geojson.features.length} Territorial Authority boundaries.`);

  let successCount = 0;
  let skipCount = 0;

  for (const feature of geojson.features) {
    // Stats NZ properties: TA2025_V1_00_NAME_ASCII, TA2025_V1_00_NAME
    // NZTA properties: TA_NAME, TA2023_V_1
    const rawName = feature.properties.TA2025_V1_00_NAME_ASCII
      || feature.properties.TA2025_V1_00_NAME
      || feature.properties.TA_NAME
      || feature.properties.NAME;
    if (!rawName) continue;

    const { data: orgs } = await supabase
      .from('organizations')
      .select('id, name')
      .ilike('name', `%${rawName}%`)
      .limit(1);

    const org = orgs?.[0];

    if (org) {
      console.log(`✅ MATCH: Gov '${rawName}' -> DB '${org.name}'`);

      const { error: orgErr } = await supabase
        .from('organizations')
        .update({ geom: feature.geometry })
        .eq('id', org.id);

      if (orgErr) {
        console.error(`   ❌ Org Update Failed: ${orgErr.message}`);
      } else {
        const { data: updatedZones, error: zoneErr } = await supabase
          .from('zones')
          .update({
            geom: feature.geometry,
            geometry: feature.geometry,
          })
          .eq('organization_id', org.id)
          .eq('zone_type', 'general')
          .select('id');

        if (zoneErr) console.error(`   ❌ Zone Update Failed: ${zoneErr.message}`);
        else if (!updatedZones || updatedZones.length === 0) {
          console.warn(`   ⚠️  No parent zone found for '${org.name}' - org geometry updated but zone not set.`);
          successCount++;
        } else successCount++;
      }
    } else {
      console.log(`   ⚠️  Skipping '${rawName}' - Not in DB.`);
      skipCount++;
    }
  }

  console.log(`\n🎉 TERRITORIAL AUTHORITY IMPORT COMPLETE`);
  console.log(`✅ Hydrated: ${successCount} Regions`);
  console.log(`⏭️  Skipped:  ${skipCount} Regions`);
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
      const { error: updateErr } = await supabase
        .from('zones')
        .update({
          geom: feature.geometry,
          geometry: feature.geometry,
          boundary_source: 'stats_nz_meshblock_2025',
        })
        .eq('id', existingId);

      if (updateErr) {
        console.error(`   ❌ Update failed for ${zoneName}: ${updateErr.message}`);
      } else {
        updatedCount++;
      }
    } else {
      // Create new enforcement zone
      const { error: insertErr } = await supabase
        .from('zones')
        .insert({
          name: zoneName,
          organization_id: org.id,
          zone_type: 'specific',
          parent_zone_id: parentZone?.id || null,
          geom: feature.geometry,
          geometry: feature.geometry,
          boundary_source: 'stats_nz_meshblock_2025',
          is_active: true,
        });

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
