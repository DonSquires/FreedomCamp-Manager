import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

/**
 * SIMPLE ZONE CORRECTION
 * 
 * observations reconciliation
 * - GPS rows: verify zone geofence / proximity and correct zone_id if needed
 * - Missing GPS rows: derive logical GPS from assigned zone geometry/name point
 */

interface Zone {
  id: string;
  name: string;
  geometry: any;
  organization_id: string;
  location_lat?: number | null;
  location_lng?: number | null;
  parent_zone_id?: string | null;
  zone_type?: string | null;
  radius_meters?: number | null;
}

interface ObservationRow {
  observation_id: string;
  plate_number: string;
  zone_id: string;
  organization_id: string;
  recorded_at: string;
  gps_latitude: number | null;
  gps_longitude: number | null;
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

function ringCentroid(ring: number[][]): { lat: number; lng: number } | null {
  if (!Array.isArray(ring) || ring.length === 0) return null;

  let sumLng = 0;
  let sumLat = 0;
  let count = 0;

  for (const p of ring) {
    if (!Array.isArray(p) || p.length < 2) continue;
    sumLng += Number(p[0]);
    sumLat += Number(p[1]);
    count++;
  }

  if (count === 0) return null;
  return { lat: sumLat / count, lng: sumLng / count };
}

function geometryCentroid(geometry: any): { lat: number; lng: number } | null {
  if (!geometry) return null;

  if (geometry.type === 'Point' && Array.isArray(geometry.coordinates)) {
    return {
      lng: Number(geometry.coordinates[0]),
      lat: Number(geometry.coordinates[1]),
    };
  }

  if (geometry.type === 'Polygon' && Array.isArray(geometry.coordinates?.[0])) {
    return ringCentroid(geometry.coordinates[0]);
  }

  if (geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates?.[0]?.[0])) {
    return ringCentroid(geometry.coordinates[0][0]);
  }

  return null;
}

function zoneLogicalPoint(zone: Zone | undefined): { lat: number; lng: number } | null {
  if (!zone) return null;

  const centroid = geometryCentroid(zone.geometry);
  if (centroid) return centroid;

  if (zone.location_lat != null && zone.location_lng != null) {
    return { lat: Number(zone.location_lat), lng: Number(zone.location_lng) };
  }

  return null;
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

    // Build query on observations (active observations table)
    let query = supabaseAdmin
      .from('observations')
      .select('observation_id, plate_number, zone_id, organization_id, recorded_at, gps_latitude, gps_longitude', { count: 'exact' })
      ;

    // GET TOTAL MODE
    if (get_total) {
      const { count, error } = await query.select('*', { count: 'exact', head: true });
      if (error) throw error;

      console.log(`📊 Total observations checked: ${count}`);

      return new Response(
        JSON.stringify({ total: count || 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Load all active zones (needed for zone matching – include parent_zone_id & zone_type for child-zone prioritisation)
    const { data: allZones, error: zonesError } = await supabaseAdmin
      .from('zones')
      .select('id, name, geometry, organization_id, location_lat, location_lng, parent_zone_id, zone_type, radius_meters')
      .eq('is_active', true);

    if (zonesError) throw zonesError;

    // Get or create "Other" zones for each organization
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
    let backfilledGps = 0;
    let correctedAndBackfilled = 0;
    let skippedNoLogicalPoint = 0;
    const corrections: any[] = [];
    const zonesById = new Map((allZones || []).map((z) => [z.id, z]));

    for (const obs of observations as ObservationRow[]) {
      try {
        let lat = obs.gps_latitude != null ? Number(obs.gps_latitude) : null;
        let lng = obs.gps_longitude != null ? Number(obs.gps_longitude) : null;
        const currentZoneId = obs.zone_id;
        const orgId = obs.organization_id;
        const currentZone = zonesById.get(currentZoneId);
        let gpsDerived = false;

        if (lat == null || lng == null) {
          const logicalPoint = zoneLogicalPoint(currentZone);
          if (!logicalPoint) {
            skippedNoLogicalPoint++;
            processed++;
            continue;
          }
          lat = logicalPoint.lat;
          lng = logicalPoint.lng;
          gpsDerived = true;
        }

        // Get zones for this organization (excluding "Other")
        const orgZones = allZones?.filter(z => z.organization_id === orgId && z.name.toLowerCase() !== 'other') || [];

        // Collect ALL matching zones so we can pick the most specific one
        const zoneMatches: Array<{ zone: Zone; distance: number }> = [];

        for (const zone of orgZones) {
          if (isPointInZone(lat, lng, zone)) {
            const dist = (zone.location_lat != null && zone.location_lng != null)
              ? calculateDistance(lat, lng, zone.location_lat, zone.location_lng)
              : 0;
            zoneMatches.push({ zone, distance: dist });
          }
        }

        let correctZone: Zone | null = null;

        if (zoneMatches.length > 0) {
          // Sort so the most *specific* zone appears first:
          //  1. Child zones (have parent_zone_id) before parent/jurisdiction zones
          //  2. Non-general zone_type before general
          //  3. Smaller radius before larger
          //  4. Closer distance to centre as tie-breaker
          zoneMatches.sort((a, b) => {
            const aIsChild = a.zone.parent_zone_id ? 0 : 1;
            const bIsChild = b.zone.parent_zone_id ? 0 : 1;
            if (aIsChild !== bIsChild) return aIsChild - bIsChild;

            const aIsGeneral = a.zone.zone_type === 'general' ? 1 : 0;
            const bIsGeneral = b.zone.zone_type === 'general' ? 1 : 0;
            if (aIsGeneral !== bIsGeneral) return aIsGeneral - bIsGeneral;

            const aRadius = a.zone.radius_meters || 500;
            const bRadius = b.zone.radius_meters || 500;
            if (aRadius !== bRadius) return aRadius - bRadius;

            return a.distance - b.distance;
          });

          correctZone = zoneMatches[0].zone;
        }

        // If not inside any zone, find closest zone (within 500m)
        if (!correctZone) {
          correctZone = findClosestZone(lat, lng, orgZones);
        }

        const payload: Record<string, any> = {};
        if (gpsDerived) {
          payload.gps_latitude = lat;
          payload.gps_longitude = lng;
        }

        // Update zone if different and a new zone is identified
        if (correctZone && correctZone.id !== currentZoneId) {
          payload.zone_id = correctZone.id;
        }

        if (Object.keys(payload).length > 0) {
          await supabaseAdmin
            .from('observations')
            .update(payload)
            .eq('observation_id', obs.observation_id);

          const zoneChanged = payload.zone_id != null;
          const gpsChanged = payload.gps_latitude != null;
          if (zoneChanged && gpsChanged) correctedAndBackfilled++;
          else if (zoneChanged) corrected++;
          else if (gpsChanged) backfilledGps++;

          corrections.push({
            observation_id: obs.observation_id,
            plate_number: obs.plate_number,
            old_zone_name: currentZone?.name || 'Unknown',
            new_zone_name: correctZone?.name || currentZone?.name || 'Unknown',
            gps_backfilled: gpsDerived,
            recorded_at: obs.recorded_at,
          });
        }

        processed++;

      } catch (error: any) {
        console.error(`Error processing ${obs.observation_id}:`, error.message);
        processed++;
      }
    }

    console.log(`✅ Batch complete: ${processed} processed, ${corrected} corrected, ${backfilledGps} GPS-backfilled, ${correctedAndBackfilled} corrected+backfilled`);

    return new Response(
      JSON.stringify({
        processed,
        corrected,
        backfilled_gps: backfilledGps,
        corrected_and_backfilled: correctedAndBackfilled,
        skipped_no_logical_point: skippedNoLogicalPoint,
        corrections,
      }),
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
