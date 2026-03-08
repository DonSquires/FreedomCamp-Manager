/**
 * DUPLICATE DETECTION - BATCH PROCESSOR
 * 
 * Processes up to 300 observations at a time
 * Finds duplicates in same zone during NZ patrol windows:
 * - 16:00 to 23:59 NZT
 * - 00:00 to 09:59 NZT
 * and within 50 meters GPS proximity.
 * Keeps newest observation, deletes older duplicates
 * Frontend handles pagination and progress tracking
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

const DUPLICATE_DISTANCE_METERS = 50;

function calculateDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLng = (lng2 - lng1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(lat1 * (Math.PI / 180))
    * Math.cos(lat2 * (Math.PI / 180))
    * Math.sin(dLng / 2)
    * Math.sin(dLng / 2);
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function nzDateKey(value: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}

function nzHour(value: string): number {
  return Number(new Intl.DateTimeFormat('en-NZ', {
    timeZone: 'Pacific/Auckland',
    hour: '2-digit',
    hour12: false,
  }).format(new Date(value)));
}

function nzDuplicateWindow(value: string): 'evening' | 'morning' | null {
  const h = nzHour(value);
  if (h >= 16 && h < 24) return 'evening';
  if (h >= 0 && h < 10) return 'morning';
  return null;
}

function isDuplicateByRule(current: any, previous: any): boolean {
  if (current.zone_id !== previous.zone_id) return false;

  const currentWindow = nzDuplicateWindow(current.recorded_at);
  const previousWindow = nzDuplicateWindow(previous.recorded_at);
  if (!currentWindow || currentWindow !== previousWindow) return false;
  if (nzDateKey(current.recorded_at) !== nzDateKey(previous.recorded_at)) return false;

  const lat1 = Number(current.gps_latitude);
  const lng1 = Number(current.gps_longitude);
  const lat2 = Number(previous.gps_latitude);
  const lng2 = Number(previous.gps_longitude);
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return false;

  return calculateDistanceMeters(lat1, lng1, lat2, lng2) <= DUPLICATE_DISTANCE_METERS;
}

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

    console.log('🔍 Duplicate Detection Request:', { zoneIds, dateRangeStart, dateRangeEnd, offset, batch_size, get_total });

    // Build base query
    let query = supabaseAdmin
      .from('observations')
      .select('observation_id,id,plate_number,zone_id,recorded_at,gps_latitude,gps_longitude', { count: 'exact' });

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

    // If just getting total, return count
    if (get_total) {
      const { count, error: countError } = await query;
      if (countError) throw countError;
      
      console.log(`📊 Total observations: ${count}`);
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
        JSON.stringify({ processed: 0, removed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`📦 Processing ${observations.length} observations...`);

    // Group by plate number
    const plateGroups = new Map<string, typeof observations>();
    for (const obs of observations) {
      const existing = plateGroups.get(obs.plate_number) || [];
      existing.push(obs);
      plateGroups.set(obs.plate_number, existing);
    }

    const duplicatesToDelete: string[] = [];
    const hasObservationId = observations.some((obs) => (obs as any).observation_id != null);
    const deleteKeyColumn: 'id' | 'observation_id' = hasObservationId ? 'observation_id' : 'id';

    // Find duplicates in each group
    for (const [plateNumber, plateObs] of plateGroups.entries()) {
      if (plateObs.length <= 1) continue;

      // Sort by recorded_at ascending (oldest first)
      plateObs.sort((a, b) => 
        new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
      );

      // Keep first (oldest), check others
      for (let i = 1; i < plateObs.length; i++) {
        const current = plateObs[i];
        
        

        // Check against previous observations (earlier ones)
        for (let j = 0; j < i; j++) {
          const previous = plateObs[j];
          
          if (isDuplicateByRule(current, previous)) {
            const currentId = (current as any).observation_id ?? (current as any).id;
            if (!duplicatesToDelete.includes(currentId)) {
              duplicatesToDelete.push(currentId);
              console.log(`🗑️ Duplicate: ${plateNumber} (same zone window + <=${DUPLICATE_DISTANCE_METERS}m)`);
            }
            break;
          }
        }
      }
    }

    // Delete duplicates
    if (duplicatesToDelete.length > 0) {
      console.log(`🗑️ Deleting ${duplicatesToDelete.length} duplicates...`);
      
      const { error: deleteError } = await supabaseAdmin
        .from('observations')
        .delete()
        .in(deleteKeyColumn, duplicatesToDelete);

      if (deleteError) {
        console.error('❌ Delete failed:', deleteError.message);
        throw deleteError;
      }
    }

    console.log(`✅ Batch complete: ${observations.length} processed, ${duplicatesToDelete.length} removed`);

    return new Response(
      JSON.stringify({
        processed: observations.length,
        removed: duplicatesToDelete.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ Duplicate detection failed:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
