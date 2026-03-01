import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

/**
 * SIMPLE ZONE CORRECTION
 * 
 * Query v2 with GPS → Test against zone geofences → Process 80 at a time
 */

interface Zone {
  id: string;
  name: string;
  geometry: any;
  organization_id: string;
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
    const radius = geometry.radius || 100;
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
  const PROXIMITY_THRESHOLD = 500;
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
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization');
    }

    const token = authHeader.replace('Bearer ', '');

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    const params = await req.json();
    const { get_total, offset = 0, batch_size = 80 } = params;

    console.log('📥 Request:', { get_total, offset, batch_size });

    // Build query on observations with GPS coordinates
    let query = supabaseAdmin
      .from('observations')
      .select('id, plate_number, zone_id, organization_id, recorded_at, gps_latitude, gps_longitude', { count: 'exact' })
      .not('gps_latitude', 'is', null)
      .not('gps_longitude', 'is', null);

    // GET TOTAL MODE
    if (get_total) {
      const { count, error } = await query.select('*', { count: 'exact', head: true });
      if (error) throw error;

      console.log(`📊 Total observations with GPS: ${count}`);

      return new Response(
        JSON.stringify({ total: count || 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Load all active zones (needed for zone matching)
    const { data: allZones, error: zonesError } = await supabaseAdmin
      .from('zones')
      .select('id, name, geometry, organization_id')
      .eq('is_active', true);

    if (zonesError) throw zonesError;

    // Get or create "Other" zones for each organization
    const { data: orgs } = await supabaseAdmin
      .from('organizations')
      .select('id, name')
      .eq('is_active', true);

    const otherZonesByOrg = new Map<string, { id: string; name: string }>();

    for (const org of orgs || []) {
      let otherZone = allZones?.find(z => z.name.toLowerCase() === 'other' && z.organization_id === org.id);
      
      if (!otherZone) {
        const { data: newZone } = await supabaseAdmin
          .from('zones')
          .insert({
            organization_id: org.id,
            name: 'Other',
            description: 'GPS locations outside defined zones',
            self_contained_required: false,
            geometry: null,
            is_active: true,
          })
          .select('id, name')
          .single();

        if (newZone) {
          otherZonesByOrg.set(org.id, { id: newZone.id, name: 'Other' });
        }
      } else {
        otherZonesByOrg.set(org.id, { id: otherZone.id, name: otherZone.name });
      }
    }

    // PROCESS BATCH MODE
    const { data: observations, error: obsError } = await query
      .order('recorded_at', { ascending: true })
      .range(offset, offset + batch_size - 1);

    if (obsError) throw obsError;

    console.log(`📦 Processing ${observations?.length || 0} observations`);

    if (!observations || observations.length === 0) {
      return new Response(
        JSON.stringify({ processed: 0, corrected: 0, moved_to_other: 0, corrections: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let processed = 0;
    let corrected = 0;
    let movedToOther = 0;
    const corrections: any[] = [];

    for (const obs of observations) {
      try {
        const lat = parseFloat(obs.gps_latitude);
        const lng = parseFloat(obs.gps_longitude);
        const currentZoneId = obs.zone_id;
        const orgId = obs.organization_id;

        // Get zones for this organization (excluding "Other")
        const orgZones = allZones?.filter(z => z.organization_id === orgId && z.name.toLowerCase() !== 'other') || [];

        // Check if in current zone
        const currentZone = allZones?.find(z => z.id === currentZoneId);
        const isInCurrentZone = currentZone ? isPointInZone(lat, lng, currentZone) : false;

        if (isInCurrentZone) {
          processed++;
          continue; // Already correct
        }

        // Find correct zone
        let correctZone: Zone | null = null;

        // Check if point is inside any zone
        for (const zone of orgZones) {
          if (isPointInZone(lat, lng, zone)) {
            correctZone = zone;
            break;
          }
        }

        // If not inside, find closest zone (within 500m)
        if (!correctZone) {
          correctZone = findClosestZone(lat, lng, orgZones);
        }

        // If still no match, assign to "Other"
        if (!correctZone) {
          const otherZone = otherZonesByOrg.get(orgId);
          if (otherZone && otherZone.id !== currentZoneId) {
            await supabaseAdmin
              .from('observations')
              .update({ zone_id: otherZone.id })
              .eq('id', obs.id);

            movedToOther++;
            corrections.push({
              observation_id: obs.id,
              plate_number: obs.plate_number,
              old_zone_name: currentZone?.name || 'Unknown',
              new_zone_name: otherZone.name,
              recorded_at: obs.recorded_at,
            });
          }
          processed++;
          continue;
        }

        // Update zone if different
        if (correctZone.id !== currentZoneId) {
          await supabaseAdmin
            .from('observations')
            .update({ zone_id: correctZone.id })
            .eq('id', obs.id);

          corrected++;
          corrections.push({
            observation_id: obs.id,
            plate_number: obs.plate_number,
            old_zone_name: currentZone?.name || 'Unknown',
            new_zone_name: correctZone.name,
            recorded_at: obs.recorded_at,
          });
        }

        processed++;

      } catch (error: any) {
        console.error(`Error processing ${obs.id}:`, error.message);
        processed++;
      }
    }

    console.log(`✅ Batch complete: ${processed} processed, ${corrected} corrected, ${movedToOther} moved to Other`);

    return new Response(
      JSON.stringify({ processed, corrected, moved_to_other: movedToOther, corrections }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
