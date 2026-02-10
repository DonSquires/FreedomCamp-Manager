import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

interface Zone {
  id: string;
  name: string;
  geometry: any;
  organization_id: string;
}

interface VehicleRecord {
  id: string;
  zone_id: string;
  gps_latitude: number;
  gps_longitude: number;
  plate_number: string;
}

// Point-in-polygon ray-casting algorithm
function isPointInPolygon(lat: number, lng: number, polygon: number[][]): boolean {
  let inside = false;
  
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][1]; // latitude
    const yi = polygon[i][0]; // longitude
    const xj = polygon[j][1];
    const yj = polygon[j][0];
    
    const intersect = ((yi > lng) !== (yj > lng)) &&
      (lat < (xj - xi) * (lng - yi) / (yj - yi) + xi);
    
    if (intersect) inside = !inside;
  }
  
  return inside;
}

// Calculate distance between two GPS coordinates in meters
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
    Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Check if point is within zone
function isPointInZone(lat: number, lng: number, zone: Zone): boolean {
  if (!zone.geometry) return false;
  
  const geometry = zone.geometry;
  
  // Handle Point geometry (circular zone with radius)
  if (geometry.type === 'Point') {
    const centerLat = geometry.coordinates[1];
    const centerLng = geometry.coordinates[0];
    const radius = geometry.radius || 100; // Default 100m radius
    const distance = calculateDistance(lat, lng, centerLat, centerLng);
    return distance <= radius;
  }
  
  // Handle Polygon geometry
  if (geometry.type === 'Polygon' && geometry.coordinates && geometry.coordinates.length > 0) {
    const polygon = geometry.coordinates[0];
    return isPointInPolygon(lat, lng, polygon);
  }
  
  return false;
}

// Find closest zone to a point (within 500m threshold)
function findClosestZone(lat: number, lng: number, zones: Zone[]): Zone | null {
  const PROXIMITY_THRESHOLD = 500; // 500 meters
  let closestZone: Zone | null = null;
  let minDistance = Infinity;
  
  for (const zone of zones) {
    if (!zone.geometry) continue;
    
    let distance: number;
    
    if (zone.geometry.type === 'Point') {
      const centerLat = zone.geometry.coordinates[1];
      const centerLng = zone.geometry.coordinates[0];
      distance = calculateDistance(lat, lng, centerLat, centerLng);
    } else if (zone.geometry.type === 'Polygon' && zone.geometry.coordinates) {
      // Calculate distance to polygon center (rough approximation)
      const polygon = zone.geometry.coordinates[0];
      const centerLat = polygon.reduce((sum: number, p: number[]) => sum + p[1], 0) / polygon.length;
      const centerLng = polygon.reduce((sum: number, p: number[]) => sum + p[0], 0) / polygon.length;
      distance = calculateDistance(lat, lng, centerLat, centerLng);
    } else {
      continue;
    }
    
    if (distance < minDistance && distance <= PROXIMITY_THRESHOLD) {
      minDistance = distance;
      closestZone = zone;
    }
  }
  
  return closestZone;
}

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('🔍 Starting GPS zone correction job...');

    // Fetch all zones with geometry
    const { data: zones, error: zonesError } = await supabaseAdmin
      .from('zones')
      .select('id, name, geometry, organization_id')
      .eq('is_active', true);

    if (zonesError) {
      console.error('Failed to fetch zones:', zonesError);
      throw zonesError;
    }

    console.log(`📍 Found ${zones?.length || 0} active zones`);

    // Find or create "Other" zone for each organization
    const { data: orgs } = await supabaseAdmin
      .from('organizations')
      .select('id, name')
      .eq('is_active', true);

    const otherZonesByOrg = new Map<string, string>();

    for (const org of orgs || []) {
      let otherZone = zones?.find(z => z.name.toLowerCase() === 'other' && z.organization_id === org.id);
      
      if (!otherZone) {
        // Create "Other" zone for this organization
        const { data: newZone, error: createError } = await supabaseAdmin
          .from('zones')
          .insert({
            organization_id: org.id,
            name: 'Other',
            description: 'Records with GPS locations outside defined zones',
            self_contained_required: false,
            nights_per_month: 28,
            max_consecutive_nights: 3,
            geometry: null, // No geofence for "Other" zone
            is_active: true,
          })
          .select('id')
          .single();

        if (createError) {
          console.error(`Failed to create Other zone for ${org.name}:`, createError);
          continue;
        }

        otherZonesByOrg.set(org.id, newZone.id);
        console.log(`✅ Created "Other" zone for ${org.name}`);
      } else {
        otherZonesByOrg.set(org.id, otherZone.id);
      }
    }

    // Fetch all vehicle observations with GPS coordinates
    const { data: observations, error: observationsError } = await supabaseAdmin
      .from('vehicle_observations_v2')
      .select('observation_id, zone_id, gps_latitude, gps_longitude, plate_number, organization_id, zones!inner(name, organization_id)')
      .not('gps_latitude', 'is', null)
      .not('gps_longitude', 'is', null);

    if (observationsError) {
      console.error('Failed to fetch observations:', observationsError);
      throw observationsError;
    }

    console.log(`📋 Processing ${observations?.length || 0} observations with GPS coordinates`);

    let corrected = 0;
    let skipped = 0;
    let movedToOther = 0;

    for (const observation of observations || []) {
      const lat = parseFloat(observation.gps_latitude);
      const lng = parseFloat(observation.gps_longitude);
      const currentZoneId = observation.zone_id;
      const orgId = observation.organization_id;

      // Get zones for this organization
      const orgZones = zones?.filter(z => z.organization_id === orgId && z.name.toLowerCase() !== 'other') || [];

      // Check if current location is in current zone
      const currentZone = zones?.find(z => z.id === currentZoneId);
      const isInCurrentZone = currentZone ? isPointInZone(lat, lng, currentZone) : false;

      if (isInCurrentZone) {
        skipped++;
        continue; // Record is in correct zone
      }

      // Find correct zone
      let correctZone: Zone | null = null;

      // First, check if point is inside any zone
      for (const zone of orgZones) {
        if (isPointInZone(lat, lng, zone)) {
          correctZone = zone;
          break;
        }
      }

      // If not inside any zone, find closest zone (within 500m)
      if (!correctZone) {
        correctZone = findClosestZone(lat, lng, orgZones);
      }

      // If still no match, assign to "Other" zone
      if (!correctZone) {
        const otherZoneId = otherZonesByOrg.get(orgId);
        if (otherZoneId && otherZoneId !== currentZoneId) {
          const { error: updateError } = await supabaseAdmin
            .from('vehicle_observations_v2')
            .update({ zone_id: otherZoneId })
            .eq('observation_id', observation.observation_id);

          if (updateError) {
            console.error(`Failed to update observation ${observation.observation_id}:`, updateError);
          } else {
            movedToOther++;
            console.log(`📌 Moved ${observation.plate_number} to "Other" zone (GPS outside all zones)`);
          }
        }
        continue;
      }

      // Update zone if different
      if (correctZone.id !== currentZoneId) {
        const { error: updateError } = await supabaseAdmin
          .from('vehicle_observations_v2')
          .update({ zone_id: correctZone.id })
          .eq('observation_id', observation.observation_id);

        if (updateError) {
          console.error(`Failed to update observation ${observation.observation_id}:`, updateError);
        } else {
          corrected++;
          console.log(`✅ Corrected ${observation.plate_number}: ${(observation as any).zones?.name} → ${correctZone.name}`);
        }
      }
    }

    const summary = {
      total_observations: observations?.length || 0,
      corrected,
      moved_to_other: movedToOther,
      already_correct: skipped,
      timestamp: new Date().toISOString(),
    };

    console.log('📊 GPS Zone Correction Summary:', summary);

    return new Response(
      JSON.stringify({
        success: true,
        summary,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error: any) {
    console.error('❌ GPS zone correction failed:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
