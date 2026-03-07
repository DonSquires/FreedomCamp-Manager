import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

/**
 * Check recent vehicle observations where GPS location doesn't match assigned zone
 * Runs correction and returns summary
 */

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
function isPointInZone(lat: number, lng: number, zone: any): boolean {
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

    console.log('🔍 Checking recent observations for zone mismatches...');

    // Get recent observations from last 24 hours with GPS coordinates
    const cutoffTime = new Date();
    cutoffTime.setHours(cutoffTime.getHours() - 24);

    const { data: observations, error: obsError } = await supabaseAdmin
      .from('observations')
      .select('id, plate_number, zone_id, organization_id, gps_latitude, gps_longitude, recorded_at')
      .not('gps_latitude', 'is', null)
      .not('gps_longitude', 'is', null)
      .is('deleted_at', null)
      .gte('recorded_at', cutoffTime.toISOString())
      .order('recorded_at', { ascending: false });

    if (obsError) throw obsError;

    console.log(`📋 Found ${observations?.length || 0} recent observations with GPS`);

    // Load all active zones
    const { data: zones, error: zonesError } = await supabaseAdmin
      .from('zones')
      .select('id, name, geometry, organization_id')
      .eq('is_active', true);

    if (zonesError) throw zonesError;

    let corrected = 0;
    let alreadyCorrect = 0;
    const corrections: any[] = [];

    for (const obs of observations || []) {
      const lat = parseFloat(obs.gps_latitude);
      const lng = parseFloat(obs.gps_longitude);
      const currentZoneId = obs.zone_id;
      const orgId = obs.organization_id;

      // Get zones for this organization (exclude "Other Location")
      const orgZones = zones?.filter(z => 
        z.organization_id === orgId && 
        z.name.toLowerCase() !== 'other location' &&
        z.name.toLowerCase() !== 'other'
      ) || [];

      // Check if current zone is correct
      const currentZone = zones?.find(z => z.id === currentZoneId);
      const isInCurrentZone = currentZone ? isPointInZone(lat, lng, currentZone) : false;

      if (isInCurrentZone) {
        alreadyCorrect++;
        continue; // Already correct
      }

      // Find correct zone
      let correctZone: any = null;

      // Check if point is inside any zone
      for (const zone of orgZones) {
        if (isPointInZone(lat, lng, zone)) {
          correctZone = zone;
          break;
        }
      }

      // If correct zone found and different from current
      if (correctZone && correctZone.id !== currentZoneId) {
        const { error: updateError } = await supabaseAdmin
          .from('observations')
          .update({ zone_id: correctZone.id })
          .eq('id', obs.id);

        if (!updateError) {
          corrected++;
          corrections.push({
            observation_id: obs.id,
            plate_number: obs.plate_number || 'Unknown',
            old_zone: currentZone?.name || 'Unknown',
            new_zone: correctZone.name,
            recorded_at: obs.recorded_at,
          });
          console.log(`✅ Corrected observation ${obs.id}: ${currentZone?.name} -> ${correctZone.name}`);
        }
      }
    }

    const summary = {
      total_checked: observations?.length || 0,
      corrected,
      already_correct: alreadyCorrect,
      corrections: corrections.slice(0, 10), // Return first 10 corrections
      timestamp: new Date().toISOString(),
    };

    console.log('📊 Zone correction check complete:', summary);

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
    console.error('❌ Zone correction check failed:', error);
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
