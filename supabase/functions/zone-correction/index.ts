/**
 * ZONE CORRECTION - BATCH PROCESSOR
 * 
 * Processes up to 300 observations at a time
 * Uses GPS coordinates to find correct zones
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

    // Process each observation
    for (const obs of observations) {
      const correctZone = findZoneByGPS(
        obs.gps_latitude,
        obs.gps_longitude,
        zones || [],
        obs.organization_id
      );

      if (!correctZone) {
        console.log(`⚠️ No zone found for GPS: ${obs.observation_id}`);
        continue;
      }

      // Update if different
      if (correctZone.id !== obs.zone_id) {
        const { error: updateError } = await supabaseAdmin
          .from('vehicle_observations_v2')
          .update({ zone_id: correctZone.id })
          .eq('observation_id', obs.observation_id);

        if (updateError) {
          console.error(`❌ Failed to update ${obs.observation_id}:`, updateError.message);
        } else {
          corrected++;
          console.log(`✅ Corrected: ${obs.plate_number} → ${correctZone.name}`);
        }
      }
    }

    console.log(`✅ Batch complete: ${observations.length} processed, ${corrected} corrected`);

    return new Response(
      JSON.stringify({
        processed: observations.length,
        corrected,
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
 * Find zone by GPS coordinates using point-in-polygon or distance
 */
function findZoneByGPS(lat: number, lng: number, zones: any[], organizationId: string): any | null {
  const orgZones = zones.filter(z => z.organization_id === organizationId);

  for (const zone of orgZones) {
    if (zone.geometry && zone.geometry.type === 'Polygon') {
      const coordinates = zone.geometry.coordinates[0];
      if (isPointInPolygon(lat, lng, coordinates)) {
        return zone;
      }
    }
    
    if (zone.location_lat && zone.location_lng) {
      const distance = calculateDistance(lat, lng, zone.location_lat, zone.location_lng);
      if (distance <= 100) {
        return zone;
      }
    }
  }

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
