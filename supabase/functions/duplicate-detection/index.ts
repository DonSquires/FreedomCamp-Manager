/**
 * DUPLICATE DETECTION - BATCH PROCESSOR
 * 
 * Processes up to 300 observations at a time
 * Finds duplicates within 8-hour window in same zone
 * Keeps newest observation, deletes older duplicates
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

    console.log('🔍 Duplicate Detection Request:', { zoneIds, dateRangeStart, dateRangeEnd, offset, batch_size, get_total });

    // Build base query
    let query = supabaseAdmin
      .from('observations')
      .select('id, plate_number, zone_id, recorded_at', { count: 'exact' });

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
        
        // Skip if has incident/hs report
        // (has_incident/has_hs_incident not present in observations table)

        // Check against previous observations (earlier ones)
        for (let j = 0; j < i; j++) {
          const previous = plateObs[j];
          
          // Check if same zone
          if (current.zone_id !== previous.zone_id) continue;

          // Check if within 8 hours
          const currentTime = new Date(current.recorded_at).getTime();
          const previousTime = new Date(previous.recorded_at).getTime();
          const hoursDiff = Math.abs(previousTime - currentTime) / (1000 * 60 * 60);

          if (hoursDiff <= 8) {
            if (!duplicatesToDelete.includes(current.id)) {
              duplicatesToDelete.push(current.id);
              console.log(`🗑️ Duplicate: ${plateNumber} (${hoursDiff.toFixed(1)}h apart)`);
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
        .in('id', duplicatesToDelete);

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
