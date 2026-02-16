/**
 * ZONE CORRECTION - BATCH PROCESSOR
 * 
 * Processes up to 300 observations at a time
 * Uses GPS coordinates to find correct zones via geofence matching
 * If no geofence matches, moves to "Other Location" zone
 * Frontend handles pagination and progress tracking
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  try {
    const { zoneIds, dateRangeStart, dateRangeEnd, offset = 0, batch_size = 50, get_total = false } = await req.json();

    console.log('🗺️ Zone Correction Request:', { zoneIds, dateRangeStart, dateRangeEnd, offset, batch_size, get_total });

    // Build base query
    let query = supabaseAdmin
      .from('vehicle_observations_v2')
      .select('observation_id, plate_number, zone_id, organization_id, recorded_at, gps_latitude, gps_longitude, gps_accuracy', { count: 'exact' });

    // Apply filters
    if (zoneIds && zoneIds.length > 0) {
      query = query.in('zone_id', zoneIds);
    }
    if (dateRangeStart) {
      query = query.gte('recorded_at', dateRangeStart);
    }
    if (dateRangeEnd) {
      query = query.lte('recorded_at', dateRangeEnd);
    }

    // Only get observations with GPS data
    query = query.not('gps_latitude', 'is', null);
    query = query.not('gps_longitude', 'is', null);
    query = query.lt('gps_accuracy', 100); // Only good GPS accuracy

    // If just getting total, return count
    if (get_total) {
      const { count, error: countError } = await query;
      if (countError) throw countError;
      
      console.log(`📊 Total observations with good GPS: ${count}`);
      return new Response(
        JSON.stringify({ total: count || 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get batch
    query = query.range(offset, offset + batch_size - 1).order('recorded_at', { ascending: false });
    
    const { data: observations, error: obsError } = await query;
    if (obsError) throw obsError;

    if (!observations || observations.length === 0) {
      console.log('⚠️ No observations in this batch');
      return new Response(
        JSON.stringify({ processed: 0, corrected: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`📦 Processing ${observations.length} observations...`);

    // Load all zones for GPS matching
    const { data: zones, error: zoneError } = await supabaseAdmin
      .from('zones')
      .select('id, name, organization_id, geometry, location_lat, location_lng')
      .eq('is_active', true);

    if (zoneError) throw zoneError;

    console.log(`📍 Loaded ${zones?.length || 0} active zones`);

    let corrected = 0;
    let movedToOther = 0;
    const otherLocationZones = new Map<string, any>();

    // Process each observation
    for (const obs of observations) {
      const correctZone = findZoneByGPS(
        obs.gps_latitude,
        obs.gps_longitude,
        zones || [],
        obs.organization_id
      );

      let targetZoneId: string;
      let targetZoneName: string;

      if (!correctZone) {
        // GPS doesn't match any geofence - move to "Other Location"
        console.log(`⚠️ No geofence match for GPS (${obs.gps_latitude}, ${obs.gps_longitude}): ${obs.observation_id}`);
        
        // Get or create "Other Location" zone for this organization
        let otherZone = otherLocationZones.get(obs.organization_id);
        
        if (!otherZone) {
          // Try to find existing "Other Location" zone
          const { data: existingOther } = await supabaseAdmin
            .from('zones')
            .select('id, name')
            .eq('organization_id', obs.organization_id)
            .ilike('name', 'other location')
            .eq('is_active', true)
            .single();
          
          if (existingOther) {
            otherZone = existingOther;
            otherLocationZones.set(obs.organization_id, otherZone);
            console.log(`📍 Using existing Other Location zone: ${otherZone.id}`);
          } else {
            // Create "Other Location" zone
            const { data: newOther, error: createError } = await supabaseAdmin
              .from('zones')
              .insert({
                organization_id: obs.organization_id,
                name: 'Other Location',
                description: 'Auto-created zone for observations outside defined geofences',
                zone_type: 'other',
                is_active: true,
                self_contained_required: false,
                nights_per_month: 0,
                max_consecutive_nights: 0,
                day_visit_only: false,
              })
              .select('id, name')
              .single();
            
            if (createError) {
              console.error(`❌ Failed to create Other Location zone:`, createError.message);
              continue;
            }
            
            otherZone = newOther;
            otherLocationZones.set(obs.organization_id, otherZone);
            console.log(`✅ Created Other Location zone: ${otherZone.id}`);
          }
        }
        
        targetZoneId = otherZone.id;
        targetZoneName = otherZone.name;
        movedToOther++;
      } else {
        targetZoneId = correctZone.id;
        targetZoneName = correctZone.name;
      }

      // Update if different from current zone
      if (targetZoneId !== obs.zone_id) {
        const { error: updateError } = await supabaseAdmin
          .from('vehicle_observations_v2')
          .update({ zone_id: targetZoneId })
          .eq('observation_id', obs.observation_id);

        if (updateError) {
          console.error(`❌ Failed to update ${obs.observation_id}:`, updateError.message);
        } else {
          corrected++;
          console.log(`✅ Corrected: ${obs.plate_number} → ${targetZoneName}`);
        }
      }
    }

    console.log(`✅ Batch complete: ${observations.length} processed, ${corrected} corrected (${movedToOther} to Other Location)`);

    return new Response(
      JSON.stringify({
        processed: observations.length,
        corrected,
        movedToOther,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ Zone correction failed:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

/**
 * Find zone by GPS coordinates using geofence matching
 * Priority: 1) Polygon geofence, 2) Point + radius (100m)
 * Returns null if no geofence matches (observation should go to "Other Location")
 */
function findZoneByGPS(lat: number, lng: number, zones: any[], organizationId: string): any | null {
  const orgZones = zones.filter(z => 
    z.organization_id === organizationId && 
    z.name?.toLowerCase() !== 'other location' // Exclude "Other Location" from geofence matching
  );

  // First pass: Check polygon geofences (most accurate)
  for (const zone of orgZones) {
    if (zone.geometry && zone.geometry.type === 'Polygon') {
      const coordinates = zone.geometry.coordinates[0];
      if (isPointInPolygon(lat, lng, coordinates)) {
        console.log(`✅ GPS matches polygon geofence: ${zone.name}`);
        return zone;
      }
    }
  }
  
  // Second pass: Check point + radius (100m) for zones without polygons
  for (const zone of orgZones) {
    if (zone.location_lat && zone.location_lng && !zone.geometry) {
      const distance = calculateDistance(lat, lng, zone.location_lat, zone.location_lng);
      if (distance <= 100) {
        console.log(`✅ GPS within 100m of zone point: ${zone.name} (${distance.toFixed(0)}m)`);
        return zone;
      }
    }
  }

  // No geofence match - observation should go to "Other Location"
  console.log(`⚠️ GPS (${lat}, ${lng}) does not match any geofence`);
  return null;
}

function isPointInPolygon(lat: number, lng: number, polygon: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];
    
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    
    if (intersect) inside = !inside;
  }
  return inside;
}

function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}
