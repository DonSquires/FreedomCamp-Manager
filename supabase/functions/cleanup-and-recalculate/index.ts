/**
 * COMPREHENSIVE CLEANUP AND RECALCULATION - BATCH PROCESSOR
 * 
 * Performs three operations in sequence on batches of 300 observations:
 * 1. Zone Correction (GPS-based)
 * 2. Duplicate Detection (8-hour window)
 * 3. Compliance Recalculation (current rules)
 * 
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
    const { zoneIds, dateRangeStart, dateRangeEnd, offset = 0, batch_size = 300, get_total = false } = await req.json();

    console.log('🔧 Cleanup Request:', { zoneIds, dateRangeStart, dateRangeEnd, offset, batch_size, get_total });

    // Build base query
    let query = supabaseAdmin
      .from('vehicle_observations_v2')
      .select('observation_id, plate_number, zone_id, organization_id, recorded_at, gps_latitude, gps_longitude, gps_accuracy, has_incident, has_hs_incident, self_contained, self_contained_expiry', { count: 'exact' });

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
        JSON.stringify({ 
          processed: 0, 
          zonesCorrected: 0, 
          duplicatesRemoved: 0,
          complianceChanged: 0,
          breachesCreated: 0,
          skippedNoMatrix: 0
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`📦 Processing ${observations.length} observations...`);

    // PHASE 1: ZONE CORRECTION
    let zonesCorrected = 0;
    
    // Load all zones for GPS matching
    const { data: zones, error: zoneError } = await supabaseAdmin
      .from('zones')
      .select('id, name, organization_id, geometry, location_lat, location_lng')
      .eq('is_active', true);

    if (zoneError) throw zoneError;

    console.log(`📍 Loaded ${zones?.length || 0} active zones for GPS matching`);

    for (const obs of observations) {
      if (obs.gps_latitude && obs.gps_longitude && obs.gps_accuracy < 100) {
        const correctZone = findZoneByGPS(
          obs.gps_latitude,
          obs.gps_longitude,
          zones || [],
          obs.organization_id
        );

        if (correctZone && correctZone.id !== obs.zone_id) {
          const { error: updateError } = await supabaseAdmin
            .from('vehicle_observations_v2')
            .update({ zone_id: correctZone.id })
            .eq('observation_id', obs.observation_id);

          if (!updateError) {
            zonesCorrected++;
            console.log(`✅ Zone corrected: ${obs.plate_number} → ${correctZone.name}`);
          }
        }
      }
    }

    // PHASE 2: DUPLICATE DETECTION
    let duplicatesRemoved = 0;
    
    const plateGroups = new Map<string, typeof observations>();
    for (const obs of observations) {
      const existing = plateGroups.get(obs.plate_number) || [];
      existing.push(obs);
      plateGroups.set(obs.plate_number, existing);
    }

    const duplicatesToDelete: string[] = [];

    for (const [plateNumber, plateObs] of plateGroups.entries()) {
      if (plateObs.length <= 1) continue;

      // Sort by recorded_at ascending (oldest first)
      plateObs.sort((a, b) => 
        new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
      );

      // Keep first (oldest), check others
      for (let i = 1; i < plateObs.length; i++) {
        const current = plateObs[i];
        
        if (current.has_incident || current.has_hs_incident) continue;

        for (let j = 0; j < i; j++) {
          const previous = plateObs[j];
          
          if (current.zone_id !== previous.zone_id) continue;

          const hoursDiff = Math.abs(
            new Date(current.recorded_at).getTime() - new Date(previous.recorded_at).getTime()
          ) / (1000 * 60 * 60);

          if (hoursDiff <= 8) {
            if (!duplicatesToDelete.includes(current.observation_id)) {
              duplicatesToDelete.push(current.observation_id);
              console.log(`🗑️ Duplicate: ${plateNumber} (${hoursDiff.toFixed(1)}h apart)`);
            }
            break;
          }
        }
      }
    }

    if (duplicatesToDelete.length > 0) {
      const { error: deleteError } = await supabaseAdmin
        .from('vehicle_observations_v2')
        .delete()
        .in('observation_id', duplicatesToDelete);

      if (!deleteError) {
        duplicatesRemoved = duplicatesToDelete.length;
      }
    }

    // PHASE 3: COMPLIANCE RECALCULATION
    // Strategy: Delete old compliance_results, then re-insert observation to trigger cascade
    // This ensures monthly_stays are updated, compliance is evaluated, and breach_alerts are created
    let complianceChanged = 0;
    let breachesCreated = 0;
    let skippedNoMatrix = 0;

    // Filter out deleted observations
    const activeObservations = observations.filter(
      obs => !duplicatesToDelete.includes(obs.observation_id)
    );

    console.log(`⚖️ Starting compliance recalculation for ${activeObservations.length} observations...`);

    for (const obs of activeObservations) {
      try {
        // STEP 1: Get current compliance state
        const { data: currentCompliance } = await supabaseAdmin
          .from('compliance_results')
          .select('is_compliant')
          .eq('observation_id', obs.observation_id)
          .single();

        const wasCompliant = currentCompliance?.is_compliant;

        // STEP 2: Delete old compliance result and breach alert
        // This allows the triggers to recreate them fresh
        await supabaseAdmin
          .from('compliance_results')
          .delete()
          .eq('observation_id', obs.observation_id);

        await supabaseAdmin
          .from('breach_alerts')
          .delete()
          .eq('observation_id', obs.observation_id);

        // STEP 3: Delete and re-insert monthly_stays to recalculate
        const currentMonth = new Date(obs.recorded_at);
        currentMonth.setDate(1);
        currentMonth.setHours(0, 0, 0, 0);
        const monthStart = currentMonth.toISOString().split('T')[0];

        await supabaseAdmin
          .from('vehicle_monthly_stays')
          .delete()
          .eq('plate_number', obs.plate_number)
          .eq('zone_id', obs.zone_id)
          .eq('organization_id', obs.organization_id)
          .eq('calendar_month', monthStart);

        // Get all observations for this plate/zone/month to recalculate monthly stays
        const { data: monthObs } = await supabaseAdmin
          .from('vehicle_observations_v2')
          .select('observation_id, plate_number, zone_id, organization_id, recorded_at, gps_latitude, gps_longitude, gps_accuracy')
          .eq('plate_number', obs.plate_number)
          .eq('zone_id', obs.zone_id)
          .eq('organization_id', obs.organization_id)
          .gte('recorded_at', monthStart)
          .lt('recorded_at', new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1).toISOString())
          .order('recorded_at');

        if (monthObs && monthObs.length > 0) {
          // Calculate nights_stayed and consecutive_nights using GPS-based logic
          const { data: consecResult } = await supabaseAdmin.rpc(
            'calculate_consecutive_nights',
            {
              p_plate_number: obs.plate_number,
              p_zone_id: obs.zone_id,
              p_organization_id: obs.organization_id,
              p_calendar_month: monthStart
            }
          );

          const nightsStayed = consecResult?.nights_stayed || monthObs.length;
          const consecutiveNights = consecResult?.consecutive_nights || 1;

          // Insert updated monthly_stays
          await supabaseAdmin
            .from('vehicle_monthly_stays')
            .upsert({
              plate_number: obs.plate_number,
              zone_id: obs.zone_id,
              organization_id: obs.organization_id,
              calendar_month: monthStart,
              nights_stayed: nightsStayed,
              consecutive_nights: consecutiveNights,
              last_observation_date: obs.recorded_at.split('T')[0],
              observation_ids: monthObs.map(o => o.observation_id),
            });
        }

        // STEP 4: Simulate observation re-insert to trigger auto_create_compliance_result
        // We do this by manually calling the compliance logic (same as the trigger)
        const { data: matrix } = await supabaseAdmin
          .from('zone_compliance_matrix')
          .select('*')
          .eq('zone_id', obs.zone_id)
          .is('effective_to', null)
          .single();

        if (!matrix) {
          skippedNoMatrix++;
          console.log(`⚠️ No matrix for zone ${obs.zone_id}, skipping ${obs.observation_id}`);
          continue;
        }

        // Get homeless status for exemption check
        const { data: canonicalVehicle } = await supabaseAdmin
          .from('canonical_vehicles')
          .select('homeless_status')
          .eq('plate_number', obs.plate_number)
          .single();

        const homelessStatus = canonicalVehicle?.homeless_status;

        // Get monthly stays (now recalculated)
        const { data: monthlyStay } = await supabaseAdmin
          .from('vehicle_monthly_stays')
          .select('*')
          .eq('plate_number', obs.plate_number)
          .eq('zone_id', obs.zone_id)
          .eq('organization_id', obs.organization_id)
          .eq('calendar_month', monthStart)
          .single();

        // Evaluate compliance rules
        let isCompliant = true;
        const violationReasons: string[] = [];

        // RULE 1: Self-contained requirement
        if (matrix.self_contained_required && !obs.self_contained) {
          if (!(homelessStatus === 'confirmed' && matrix.homeless_exemption)) {
            isCompliant = false;
            violationReasons.push('not_self_contained');
          }
        }

        // RULE 2: Consecutive nights limit
        if (monthlyStay && monthlyStay.consecutive_nights > matrix.max_consecutive_nights) {
          if (!(homelessStatus === 'confirmed' && matrix.homeless_exemption)) {
            isCompliant = false;
            violationReasons.push(`consecutive_nights_exceeded_${monthlyStay.consecutive_nights}_of_${matrix.max_consecutive_nights}`);
          }
        }

        // RULE 3: Monthly nights limit
        if (monthlyStay && monthlyStay.nights_stayed > matrix.nights_per_month) {
          if (!(homelessStatus === 'confirmed' && matrix.homeless_exemption)) {
            isCompliant = false;
            violationReasons.push(`monthly_nights_exceeded_${monthlyStay.nights_stayed}_of_${matrix.nights_per_month}`);
          }
        }

        // Insert compliance_results (triggers auto_create_breach_alert)
        await supabaseAdmin
          .from('compliance_results')
          .insert({
            observation_id: obs.observation_id,
            zone_id: obs.zone_id,
            organization_id: obs.organization_id,
            matrix_id: matrix.id,
            matrix_version: matrix.version,
            is_compliant: isCompliant,
            violation_reasons: violationReasons,
            matrix_snapshot: {
              self_contained_required: matrix.self_contained_required,
              nights_per_month: matrix.nights_per_month,
              max_consecutive_nights: matrix.max_consecutive_nights,
              day_visit_only: matrix.day_visit_only,
              homeless_exemption: matrix.homeless_exemption,
            },
            evaluated_at: new Date().toISOString(),
          });

        // Track changes
        if (wasCompliant !== isCompliant) {
          complianceChanged++;
        }

        if (!isCompliant && violationReasons.length > 0) {
          breachesCreated++;
          console.log(`🚨 Breach created for ${obs.plate_number}: ${violationReasons.join(', ')}`);
        }

      } catch (err: any) {
        console.error(`❌ Error processing ${obs.observation_id}:`, err.message);
      }
    }

    console.log(`✅ Batch complete: ${observations.length} processed, ${zonesCorrected} zones corrected, ${duplicatesRemoved} duplicates removed, ${complianceChanged} compliance changed, ${breachesCreated} breaches`);

    return new Response(
      JSON.stringify({
        processed: observations.length,
        zonesCorrected,
        duplicatesRemoved,
        complianceChanged,
        breachesCreated,
        skippedNoMatrix,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ Cleanup failed:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

/**
 * Find zone by GPS coordinates
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
