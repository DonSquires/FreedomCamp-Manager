/**
 * CLEANUP AND RECALCULATE EDGE FUNCTION
 * 
 * Comprehensive data cleanup pipeline:
 * 1. Zone Correction: GPS-based automatic zone reassignment
 * 2. Duplicate Detection: Remove duplicate scans within 8 hours in same zone
 * 3. Compliance Recalculation: Measure against zone matrix, monthly stays, homeless status
 * 4. Breach Detection: Create compliance results and breach alerts
 * 
 * Target: vehicle_observations_v2 table (plate_number as reference)
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

interface CleanupParams {
  scope: 'ZONE' | 'ORG' | 'ALL';
  zoneIds?: string[];
  organizationId?: string;
  dateRangeStart?: string;
  dateRangeEnd?: string;
}

interface CleanupStats {
  observations_checked: number;
  zones_corrected: number;
  duplicates_removed: number;
  compliance_recalculated: number;
  breaches_created: number;
  errors: string[];
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
    // Get authenticated user
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');

    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) {
      console.error('❌ Auth failed:', userError);
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const params: CleanupParams = await req.json();
    console.log('🔧 Starting cleanup and recalculation:', params);

    // ============================================
    // VALIDATION: Check required parameters
    // ============================================
    if (params.scope === 'ZONE' && (!params.zoneIds || params.zoneIds.length === 0)) {
      console.error('❌ Validation failed: No zone IDs provided for ZONE scope');
      return new Response(
        JSON.stringify({ 
          error: 'No observations found in zone(s): undefined. Check zone IDs are correct.',
          details: 'ZONE scope requires at least one zone to be selected. Please select zones in the UI.'
        }),
        { 
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    if (params.scope === 'ORG' && !params.organizationId) {
      console.error('❌ Validation failed: No organization ID provided for ORG scope');
      return new Response(
        JSON.stringify({ 
          error: 'No organization ID provided for ORG scope.' 
        }),
        { 
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Create initial tracking record in admin_recalculation_actions
    console.log('📝 Creating recalculation tracking record...');
    const { data: actionRecord, error: actionError } = await supabaseAdmin
      .from('admin_recalculation_actions')
      .insert({
        scope_type: params.scope,
        target_zone_ids: params.zoneIds || null,
        target_org_ids: params.organizationId ? [params.organizationId] : null,
        date_range_start: params.dateRangeStart || null,
        date_range_end: params.dateRangeEnd || null,
        observations_processed: 0,
        compliance_changed: 0,
        drift_events_created: 0,
        status: 'running',
        performed_by: user.id,
        performed_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (actionError || !actionRecord) {
      console.error('❌ Failed to create tracking record:', actionError);
      throw new Error('Failed to create tracking record');
    }

    const actionId = actionRecord.id;
    console.log('✅ Tracking record created:', actionId);

    const stats: CleanupStats = {
      observations_checked: 0,
      zones_corrected: 0,
      duplicates_removed: 0,
      compliance_recalculated: 0,
      breaches_created: 0,
      errors: [],
    };

    // Helper function to update progress in database
    const updateProgress = async () => {
      await supabaseAdmin
        .from('admin_recalculation_actions')
        .update({
          observations_processed: stats.observations_checked,
          compliance_changed: stats.compliance_recalculated,
          drift_events_created: stats.breaches_created,
        })
        .eq('id', actionId);
    };

    // ============================================
    // STEP 1: LOAD OBSERVATIONS TO PROCESS
    // ============================================
    console.log('📊 STEP 1: Loading observations...');
    
    let query = supabaseAdmin
      .from('vehicle_observations_v2')
      .select(`
        observation_id,
        plate_number,
        zone_id,
        organization_id,
        recorded_at,
        gps_latitude,
        gps_longitude,
        gps_accuracy,
        has_incident,
        has_hs_incident
      `)
      .order('recorded_at', { ascending: false });

    // Apply scope filters
    if (params.scope === 'ZONE' && params.zoneIds && params.zoneIds.length > 0) {
      query = query.in('zone_id', params.zoneIds);
    } else if (params.scope === 'ORG' && params.organizationId) {
      query = query.eq('organization_id', params.organizationId);
    }

    // Apply date range
    if (params.dateRangeStart) {
      query = query.gte('recorded_at', params.dateRangeStart);
    }
    if (params.dateRangeEnd) {
      query = query.lte('recorded_at', params.dateRangeEnd);
    }

    const { data: observations, error: obsError } = await query;
    
    if (obsError) {
      throw new Error(`Failed to load observations: ${obsError.message}`);
    }

    if (!observations || observations.length === 0) {
      console.log('⚠️ No observations found matching criteria');
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No observations to process',
          stats 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    stats.observations_checked = observations.length;
    console.log(`✅ Loaded ${observations.length} observations`);
    
    // Update initial count
    await updateProgress();

    // ============================================
    // STEP 2: LOAD ZONES FOR GPS MATCHING
    // ============================================
    console.log('📍 STEP 2: Loading zones for GPS matching...');
    
    const { data: zones, error: zoneError } = await supabaseAdmin
      .from('zones')
      .select('id, name, organization_id, geometry, location_lat, location_lng, is_active')
      .eq('is_active', true);

    if (zoneError) {
      throw new Error(`Failed to load zones: ${zoneError.message}`);
    }

    console.log(`✅ Loaded ${zones?.length || 0} active zones`);

    // ============================================
    // STEP 3: ZONE CORRECTION (GPS-BASED)
    // ============================================
    console.log('🗺️ STEP 3: Zone correction (GPS-based)...');

    for (const obs of observations) {
      if (!obs.gps_latitude || !obs.gps_longitude || !obs.gps_accuracy) {
        console.log(`⏭️ No GPS data for observation ${obs.observation_id}`);
        continue;
      }

      if (obs.gps_accuracy >= 100) {
        console.log(`⏭️ GPS accuracy too low (${obs.gps_accuracy}m) for ${obs.observation_id}`);
        continue;
      }

      // Find correct zone based on GPS
      const correctZone = findZoneByGPS(
        obs.gps_latitude,
        obs.gps_longitude,
        zones || [],
        obs.organization_id
      );

      if (!correctZone) {
        console.log(`⚠️ No zone found for GPS location: ${obs.observation_id}`);
        continue;
      }

      // Update zone if different
      if (correctZone.id !== obs.zone_id) {
        const { error: updateError } = await supabaseAdmin
          .from('vehicle_observations_v2')
          .update({ zone_id: correctZone.id })
          .eq('observation_id', obs.observation_id);

        if (updateError) {
          stats.errors.push(`Zone correction failed for ${obs.observation_id}: ${updateError.message}`);
        } else {
          stats.zones_corrected++;
          console.log(`✅ Corrected zone: ${obs.observation_id} → ${correctZone.name}`);
          // Update local copy for duplicate detection
          obs.zone_id = correctZone.id;
        }
      }
    }

    console.log(`✅ Zone correction complete: ${stats.zones_corrected} corrected`);
    await updateProgress();

    // ============================================
    // STEP 4: DUPLICATE DETECTION & REMOVAL
    // ============================================
    console.log('🔍 STEP 4: Duplicate detection (8-hour window, same zone)...');

    // Group observations by plate number
    const plateGroups = new Map<string, typeof observations>();
    for (const obs of observations) {
      const existing = plateGroups.get(obs.plate_number) || [];
      existing.push(obs);
      plateGroups.set(obs.plate_number, existing);
    }

    const duplicatesToDelete: string[] = [];

    for (const [plateNumber, plateObs] of plateGroups.entries()) {
      if (plateObs.length <= 1) continue;

      // Sort by recorded_at descending (newest first)
      plateObs.sort((a, b) => 
        new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime()
      );

      // Keep first (newest), check others for duplicates
      for (let i = 1; i < plateObs.length; i++) {
        const current = plateObs[i];
        
        // Skip if has incident/hs report (preserve these)
        if (current.has_incident || current.has_hs_incident) {
          console.log(`⏭️ Preserving observation with incident: ${current.observation_id}`);
          continue;
        }

        // Check against all previous observations (newer ones)
        for (let j = 0; j < i; j++) {
          const previous = plateObs[j];
          
          // Check if same zone
          if (current.zone_id !== previous.zone_id) {
            continue;
          }

          // Check if within 8 hours
          const currentTime = new Date(current.recorded_at).getTime();
          const previousTime = new Date(previous.recorded_at).getTime();
          const hoursDiff = Math.abs(previousTime - currentTime) / (1000 * 60 * 60);

          if (hoursDiff <= 8) {
            // This is a duplicate - mark for deletion
            if (!duplicatesToDelete.includes(current.observation_id)) {
              duplicatesToDelete.push(current.observation_id);
              console.log(`🗑️ Duplicate found: ${plateNumber} in ${current.zone_id} (${hoursDiff.toFixed(1)}h apart)`);
            }
            break;
          }
        }
      }
    }

    // Delete duplicates in batches
    if (duplicatesToDelete.length > 0) {
      console.log(`🗑️ Deleting ${duplicatesToDelete.length} duplicates...`);
      
      for (let i = 0; i < duplicatesToDelete.length; i += 100) {
        const batch = duplicatesToDelete.slice(i, i + 100);
        const { error: deleteError } = await supabaseAdmin
          .from('vehicle_observations_v2')
          .delete()
          .in('observation_id', batch);

        if (deleteError) {
          stats.errors.push(`Duplicate deletion failed: ${deleteError.message}`);
        } else {
          stats.duplicates_removed += batch.length;
        }
      }

      console.log(`✅ Deleted ${stats.duplicates_removed} duplicates`);
      
      // Remove deleted observations from processing list
      const validObservations = observations.filter(
        obs => !duplicatesToDelete.includes(obs.observation_id)
      );
      observations.length = 0;
      observations.push(...validObservations);
    }

    // ============================================
    // STEP 5: COMPLIANCE RECALCULATION (BATCHED)
    // ============================================
    console.log('⚖️ STEP 5: Compliance recalculation (batched processing)...');

    const BATCH_SIZE = 100;
    const totalObservations = observations.length;
    const totalBatches = Math.ceil(totalObservations / BATCH_SIZE);

    console.log(`📦 Processing ${totalObservations} observations in ${totalBatches} batches of ${BATCH_SIZE}`);

    for (let batchNum = 0; batchNum < totalBatches; batchNum++) {
      const start = batchNum * BATCH_SIZE;
      const end = Math.min(start + BATCH_SIZE, totalObservations);
      const batch = observations.slice(start, end);
      
      console.log(`\n📦 Batch ${batchNum + 1}/${totalBatches}: Processing observations ${start + 1}-${end}...`);

      let batchCompliance = 0;
      let batchBreaches = 0;

      for (const obs of batch) {
        try {
          // Call compliance function with updated zone
          const { data: complianceResult, error: complianceError } = await supabaseAdmin
            .rpc('calculate_vehicle_compliance', {
              p_plate_number: obs.plate_number,
              p_zone_id: obs.zone_id,
              p_observation_date: obs.recorded_at.split('T')[0],
            });

          if (complianceError) {
            stats.errors.push(`Compliance check failed for ${obs.plate_number}: ${complianceError.message}`);
            continue;
          }

          if (complianceResult) {
            stats.compliance_recalculated++;
            batchCompliance++;
            
            // Check if breach was created
            if (complianceResult.is_compliant === false) {
              stats.breaches_created++;
              batchBreaches++;
            }
          }
        } catch (error: any) {
          stats.errors.push(`Compliance error for ${obs.plate_number}: ${error.message}`);
        }
      }

      console.log(`✅ Batch ${batchNum + 1}/${totalBatches} complete: ${batchCompliance} processed, ${batchBreaches} breaches`);
      
      // Update progress after each batch
      await updateProgress();
      
      // Small delay between batches to prevent overwhelming the system
      if (batchNum < totalBatches - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log(`\n✅ Compliance recalculation complete: ${stats.compliance_recalculated} processed, ${stats.breaches_created} breaches`);

    // ============================================
    // MARK AS COMPLETED
    // ============================================
    const completedAt = new Date();
    const startedAt = new Date(actionRecord.performed_at || new Date());
    const durationSeconds = Math.round((completedAt.getTime() - startedAt.getTime()) / 1000);

    await supabaseAdmin
      .from('admin_recalculation_actions')
      .update({
        status: 'completed',
        observations_processed: stats.observations_checked,
        compliance_changed: stats.compliance_recalculated,
        drift_events_created: stats.breaches_created,
        completed_at: completedAt.toISOString(),
        duration_seconds: durationSeconds,
      })
      .eq('id', actionId);

    console.log('✅ Tracking record marked as completed');

    // ============================================
    // RETURN RESULTS
    // ============================================
    const summary = {
      success: true,
      message: 'Cleanup and recalculation completed',
      action_id: actionId,
      stats,
      processing_summary: {
        observations_checked: stats.observations_checked,
        zones_corrected: stats.zones_corrected,
        duplicates_removed: stats.duplicates_removed,
        compliance_recalculated: stats.compliance_recalculated,
        breaches_created: stats.breaches_created,
        error_count: stats.errors.length,
        batches_processed: totalBatches,
        batch_size: BATCH_SIZE,
        duration_seconds: durationSeconds,
      }
    };

    console.log('✅ CLEANUP COMPLETE:', summary.processing_summary);

    return new Response(
      JSON.stringify(summary),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ Cleanup failed:', error);
    
    // Try to mark tracking record as failed if it exists
    try {
      const authHeader = req.headers.get('Authorization');
      const token = authHeader?.replace('Bearer ', '');
      const { data: { user } } = await supabaseAdmin.auth.getUser(token);
      
      if (user) {
        // Find the most recent running action for this user
        const { data: runningAction } = await supabaseAdmin
          .from('admin_recalculation_actions')
          .select('id')
          .eq('performed_by', user.id)
          .eq('status', 'running')
          .order('performed_at', { ascending: false })
          .limit(1)
          .single();
        
        if (runningAction) {
          await supabaseAdmin
            .from('admin_recalculation_actions')
            .update({
              status: 'failed',
              error_message: error.message,
              completed_at: new Date().toISOString(),
            })
            .eq('id', runningAction.id);
          
          console.log('✅ Tracking record marked as failed');
        }
      }
    } catch (updateError) {
      console.error('Failed to update tracking record:', updateError);
    }
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message,
        stack: error.stack,
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});

/**
 * Find zone by GPS coordinates using point-in-polygon or distance
 */
function findZoneByGPS(
  lat: number,
  lng: number,
  zones: any[],
  organizationId: string
): any | null {
  // Filter zones by organization
  const orgZones = zones.filter(z => z.organization_id === organizationId);

  for (const zone of orgZones) {
    // Check if zone has geometry (polygon)
    if (zone.geometry && zone.geometry.type === 'Polygon') {
      const coordinates = zone.geometry.coordinates[0];
      if (isPointInPolygon(lat, lng, coordinates)) {
        return zone;
      }
    }
    
    // Fallback: Check distance to zone center
    if (zone.location_lat && zone.location_lng) {
      const distance = calculateDistance(
        lat,
        lng,
        zone.location_lat,
        zone.location_lng
      );
      
      // Within 100 meters of zone center
      if (distance <= 100) {
        return zone;
      }
    }
  }

  return null;
}

/**
 * Point-in-polygon algorithm (ray casting)
 */
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

/**
 * Calculate distance between two GPS points (Haversine formula)
 */
function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371e3; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}
