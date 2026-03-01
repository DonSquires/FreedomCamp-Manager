import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// CONFIGURATION
// Official Stats NZ Territorial Authorities (Simplified for Web Performance)
const GEOJSON_URL = "https://raw.githubusercontent.com/Udata-io/nz-geojson/refs/heads/main/territorial-authorities-2023.geojson";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!  // <-- MUST use this name to match existing secret
);

async function importBoundaries() {
  console.log("📡 Connecting to Government Data Source...");
  
  const response = await fetch(GEOJSON_URL);
  if (!response.ok) throw new Error(`Failed to download from ${GEOJSON_URL}: ${response.status} ${response.statusText}`);
  
  const geojson = await response.json();
  console.log(`🗺️  Downloaded ${geojson.features.length} Boundary Definitions.`);

  let successCount = 0;
  let skipCount = 0;

  // Loop through every region in the NZ Government dataset
  for (const feature of geojson.features) {
    // Clean the name: "Tasman District" -> "Tasman" to improve matching chances
    // The DB has "Tasman District Council", GeoJSON has "Tasman District"
    const rawName = feature.properties.TA2023_V1_00_NAME || feature.properties.NAME;
    if (!rawName) continue;

    // 1. Find the Matching Organization in Your Database
    // We use ILIKE with wildcards to handle "Council" vs "District" suffix differences
    const { data: orgs } = await supabase
      .from('organizations')
      .select('id, name')
      .ilike('name', `%${rawName}%`) 
      .limit(1);

    const org = orgs?.[0];

    if (org) {
      console.log(`✅ MATCH: Gov '${rawName}' -> DB '${org.name}'`);

      // 2. Update the Organization (The Entity)
      const { error: orgErr } = await supabase
        .from('organizations')
        .update({ geom: feature.geometry })
        .eq('id', org.id);

      if (orgErr) {
        console.error(`   ❌ Org Update Failed: ${orgErr.message}`);
      } else {
        // 3. Update the Jurisdiction Zone (The Geofence)
        // This is the critical part for the "Out of Bounds" check
        const { data: updatedZones, error: zoneErr } = await supabase
          .from('zones')
          .update({ 
            geom: feature.geometry,
            geometry: feature.geometry // Sync both columns if they exist
          })
          .eq('organization_id', org.id)
          .eq('zone_type', 'general') // Only update the top-level jurisdiction
          .select('id');

        if (zoneErr) console.error(`   ❌ Zone Update Failed: ${zoneErr.message}`);
        else if (!updatedZones || updatedZones.length === 0) {
          console.warn(`   ⚠️  No parent zone found for '${org.name}' - org geometry updated but zone not set.`);
          successCount++;
        } else successCount++;
      }
    } else {
      // Expected for "Iron Eagle Security" or regions you haven't onboarded
      console.log(`   ⚠️  Skipping '${rawName}' - Not in DB.`);
      skipCount++;
    }
  }

  console.log(`\n🎉 OPERATION COMPLETE`);
  console.log(`✅ Hydrated: ${successCount} Regions`);
  console.log(`⏭️  Skipped:  ${skipCount} Regions`);
}

importBoundaries();
