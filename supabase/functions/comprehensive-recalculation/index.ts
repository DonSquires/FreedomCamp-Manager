import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

/**
 * COMPREHENSIVE RECALCULATION - REBUILT FROM SCRATCH
 * 
 * Clean, simple all-in-one data cleanup pipeline:
 * 1. Duplicate Detection & Removal
 * 2. Zone GPS Corrections
 * 3. Compliance Recalculation
 * 4. Breach Alert Creation
 */

interface RecalculationParams {
  scope: 'ZONE' | 'ORG' | 'BUILD';
  zoneIds?: string[];
  orgIds?: string[];
  dateRangeStart?: string;
  dateRangeEnd?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    // ============================================================
    // AUTH & PERMISSIONS
    // ============================================================
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('role, organization_id')
      .eq('id', user.id)
      .single();

    if (!profile || !['admin', 'master'].includes(profile.role)) {
      return new Response(
        JSON.stringify({ error: 'Admin or master role required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ============================================================
    // PARSE REQUEST
    // ============================================================
    const params: RecalculationParams = await req.json();
    console.log('📥 Recalculation request:', params);

    if (!params.scope || !['ZONE', 'ORG', 'BUILD'].includes(params.scope)) {
      return new Response(
        JSON.stringify({ error: 'Invalid scope - must be ZONE, ORG, or BUILD' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (params.scope === 'ZONE' && (!params.zoneIds || params.zoneIds.length === 0)) {
      return new Response(
        JSON.stringify({ error: 'zoneIds required when scope=ZONE' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (params.scope === 'ORG' && (!params.orgIds || params.orgIds.length === 0)) {
      return new Response(
        JSON.stringify({ error: 'orgIds required when scope=ORG' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ============================================================
    // CREATE AUDIT RECORD
    // ============================================================
    const { data: actionRecord, error: actionError } = await supabaseAdmin
      .from('admin_recalculation_actions')
      .insert({
        scope_type: params.scope,
        target_zone_ids: params.zoneIds || null,
        target_org_ids: params.orgIds || null,
        date_range_start: params.dateRangeStart || null,
        date_range_end: params.dateRangeEnd || null,
        status: 'running',
        performed_by: user.id,
      })
      .select()
      .single();

    if (actionError) throw new Error(`Failed to create audit record: ${actionError.message}`);

    console.log(`📝 Audit record created: ${actionRecord.id}`);

    // ============================================================
    // DIAGNOSTIC: Check what data exists BEFORE filtering
    // ============================================================
    console.log('🔍 DIAGNOSTIC: Checking zone data...');
    console.log('Zone IDs:', params.zoneIds);
    console.log('Date Range Start:', params.dateRangeStart);
    console.log('Date Range End:', params.dateRangeEnd);

    // Check total observations in zone (NO date filter)
    const { count: totalInZone, error: countError } = await supabaseAdmin
      .from('vehicle_observations_v2')
      .select('observation_id', { count: 'exact', head: true })
      .in('zone_id', params.zoneIds || []);

    console.log(`📊 Total observations in zone(s): ${totalInZone || 0}`);

    if (totalInZone === 0) {
      throw new Error(`No observations found in zone(s): ${params.zoneIds?.join(', ')}. Check zone IDs are correct.`);
    }

    // Get sample observations to see date range
    const { data: sampleObs } = await supabaseAdmin
      .from('vehicle_observations_v2')
      .select('observation_id, plate_number, zone_id, recorded_at')
      .in('zone_id', params.zoneIds || [])
      .order('recorded_at', { ascending: false })
      .limit(5);

    console.log('📋 Sample recent observations:');
    sampleObs?.forEach(obs => {
      console.log(`  ${obs.plate_number} - ${obs.recorded_at}`);
    });

    // ============================================================
    // BUILD OBSERVATION QUERY WITH FILTERS
    // ============================================================
    let query = supabaseAdmin
      .from('vehicle_observations_v2')
      .select(`
        observation_id,
        plate_number,
        zone_id,
        organization_id,
        recorded_at,
        has_incident,
        has_hs_incident,
        gps_latitude,
        gps_longitude
      `);

    // Apply zone filter (NOT organization - organization is just for frontend filtering)
    if (params.scope === 'ZONE') {
      query = query.in('zone_id', params.zoneIds!);
      console.log(`🎯 Filtering by zone IDs: ${params.zoneIds?.join(', ')}`);
    } else if (params.scope === 'ORG') {
      query = query.in('organization_id', params.orgIds!);
      console.log(`🎯 Filtering by organization IDs: ${params.orgIds?.join(', ')}`);
    }

    // Apply date filters - SIMPLIFIED: Just use the ISO strings directly
    if (params.dateRangeStart) {
      // Add time component if not present
      const startTimestamp = params.dateRangeStart.includes('T') 
        ? params.dateRangeStart 
        : `${params.dateRangeStart}T00:00:00.000Z`;
      query = query.gte('recorded_at', startTimestamp);
      console.log(`📅 Date filter start: ${startTimestamp}`);
    }

    if (params.dateRangeEnd) {
      // Add time component if not present
      const endTimestamp = params.dateRangeEnd.includes('T') 
        ? params.dateRangeEnd 
        : `${params.dateRangeEnd}T23:59:59.999Z`;
      query = query.lte('recorded_at', endTimestamp);
      console.log(`📅 Date filter end: ${endTimestamp}`);
    }

    // ============================================================
    // FETCH OBSERVATIONS
    // ============================================================
    console.log('🔍 Fetching observations with filters...');
    const { data: observations, error: obsError } = await query.order('recorded_at', { ascending: true });

    if (obsError) throw new Error(`Failed to fetch observations: ${obsError.message}`);

    const totalObs = observations?.length || 0;
    console.log(`📊 Found ${totalObs} observations after date filtering`);

    if (totalObs === 0) {
      const message = `No observations found. Total in zone: ${totalInZone}, but 0 matched date range ${params.dateRangeStart} to ${params.dateRangeEnd}. Check date range settings.`;
      console.warn(`⚠️ ${message}`);

      await supabaseAdmin
        .from('admin_recalculation_actions')
        .update({
          status: 'completed',
          observations_processed: 0,
          compliance_changed: 0,
          completed_at: new Date().toISOString(),
          duration_seconds: Math.round((Date.now() - startTime) / 1000),
          error_message: message,
        })
        .eq('id', actionRecord.id);

      return new Response(
        JSON.stringify({
          success: false,
          message,
          diagnostic: {
            total_in_zone: totalInZone,
            zone_ids: params.zoneIds,
            date_range_start: params.dateRangeStart,
            date_range_end: params.dateRangeEnd,
            sample_recent_observations: sampleObs,
          },
          summary: {
            observations_processed: 0,
            duplicates_removed: 0,
            zone_corrections: 0,
            compliance_changed: 0,
            breach_alerts_created: 0,
          },
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ============================================================
    // PHASE 1: DUPLICATE DETECTION & REMOVAL
    // ============================================================
    console.log('🔍 PHASE 1: Duplicate Detection');
    
    const duplicatesToRemove: string[] = [];
    const observationsByDay = new Map<string, any[]>();

    // Group observations by plate + zone + date
    for (const obs of observations) {
      const date = obs.recorded_at.split('T')[0];
      const key = `${obs.plate_number}_${obs.zone_id}_${date}`;
      
      if (!observationsByDay.has(key)) {
        observationsByDay.set(key, []);
      }
      observationsByDay.get(key)!.push(obs);
    }

    // Check each group for duplicates
    for (const [key, group] of observationsByDay.entries()) {
      // Separate incident/H&S exceptions from regular scans
      const exceptions = group.filter(obs => obs.has_incident || obs.has_hs_incident);
      const regular = group.filter(obs => !obs.has_incident && !obs.has_hs_incident);

      if (regular.length <= 2) continue; // No duplicates

      // Split into morning (6am-3pm) and evening (3pm-6am) shifts
      const morning: any[] = [];
      const evening: any[] = [];

      for (const obs of regular) {
        const hour = new Date(obs.recorded_at).getUTCHours();
        if (hour >= 6 && hour < 15) {
          morning.push(obs);
        } else {
          evening.push(obs);
        }
      }

      // Keep only FIRST scan from each shift
      const toKeep = new Set<string>();
      
      if (morning.length > 0) {
        morning.sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
        toKeep.add(morning[0].observation_id);
      }
      
      if (evening.length > 0) {
        evening.sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
        toKeep.add(evening[0].observation_id);
      }

      // Mark extras for removal
      for (const obs of regular) {
        if (!toKeep.has(obs.observation_id)) {
          duplicatesToRemove.push(obs.observation_id);
        }
      }
    }

    console.log(`🗑️ Found ${duplicatesToRemove.length} duplicates to remove`);

    // Delete duplicates
    let duplicatesRemoved = 0;
    if (duplicatesToRemove.length > 0) {
      const { error: deleteError } = await supabaseAdmin
        .from('vehicle_observations_v2')
        .delete()
        .in('observation_id', duplicatesToRemove);

      if (deleteError) {
        console.error('⚠️ Failed to delete duplicates:', deleteError.message);
      } else {
        duplicatesRemoved = duplicatesToRemove.length;
        console.log(`✅ Removed ${duplicatesRemoved} duplicates`);
      }
    }

    // ============================================================
    // PHASE 2: ZONE CORRECTIONS
    // ============================================================
    console.log('🗺️ PHASE 2: Zone GPS Corrections');
    
    let zoneCorrections = 0;
    const remainingObs = observations.filter(o => !duplicatesToRemove.includes(o.observation_id));

    // Get all zones with GPS coordinates
    const { data: zones } = await supabaseAdmin
      .from('zones')
      .select('id, name, location_lat, location_lng')
      .not('location_lat', 'is', null)
      .not('location_lng', 'is', null);

    if (zones && zones.length > 0) {
      for (const obs of remainingObs) {
        if (!obs.gps_latitude || !obs.gps_longitude) continue;

        // Find nearest zone (simple distance calculation)
        let nearestZone: any = null;
        let minDistance = Infinity;

        for (const zone of zones) {
          const latDiff = obs.gps_latitude - zone.location_lat;
          const lngDiff = obs.gps_longitude - zone.location_lng;
          const distance = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff);

          if (distance < minDistance) {
            minDistance = distance;
            nearestZone = zone;
          }
        }

        // If nearest zone is different and within 100m threshold, correct it
        if (nearestZone && nearestZone.id !== obs.zone_id && minDistance < 0.001) {
          const { error: updateError } = await supabaseAdmin
            .from('vehicle_observations_v2')
            .update({ zone_id: nearestZone.id })
            .eq('observation_id', obs.observation_id);

          if (!updateError) {
            zoneCorrections++;
            console.log(`📍 Corrected ${obs.observation_id}: ${obs.zone_id} → ${nearestZone.id}`);
          }
        }
      }
    }

    console.log(`✅ Zone corrections: ${zoneCorrections}`);

    // ============================================================
    // PHASE 3: COMPLIANCE RECALCULATION
    // ============================================================
    console.log('⚖️ PHASE 3: Compliance Recalculation');
    
    let processed = 0;
    let complianceChanged = 0;
    let breachAlertsCreated = 0;

    for (const obs of remainingObs) {
      try {
        if (!obs.plate_number) {
          processed++;
          continue;
        }

        // Get vehicle homeless status
        const { data: vehicle } = await supabaseAdmin
          .from('canonical_vehicles')
          .select('homeless_status')
          .eq('plate_number', obs.plate_number)
          .maybeSingle();

        const isHomeless = vehicle?.homeless_status === 'confirmed';

        // Get active compliance matrix
        const { data: matrix } = await supabaseAdmin
          .from('zone_compliance_matrix')
          .select('*')
          .eq('zone_id', obs.zone_id)
          .lte('effective_from', obs.recorded_at)
          .or(`effective_to.is.null,effective_to.gte.${obs.recorded_at}`)
          .order('version', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!matrix) {
          processed++;
          continue;
        }

        // Calculate compliance
        const checkDate = obs.recorded_at.split('T')[0];
        const { data: complianceData, error: calcError } = await supabaseAdmin.rpc(
          'calculate_vehicle_compliance',
          {
            p_plate_number: obs.plate_number,
            p_zone_id: obs.zone_id,
            p_check_date: checkDate,
          }
        );

        if (calcError || !complianceData || complianceData.length === 0) {
          processed++;
          continue;
        }

        const compliance = complianceData[0];

        // Get current result to track changes
        const { data: currentResult } = await supabaseAdmin
          .from('compliance_results')
          .select('is_compliant')
          .eq('observation_id', obs.observation_id)
          .maybeSingle();

        // Upsert compliance result
        await supabaseAdmin
          .from('compliance_results')
          .upsert({
            observation_id: obs.observation_id,
            vehicle_id: null,
            zone_id: obs.zone_id,
            organization_id: obs.organization_id,
            matrix_id: matrix.id,
            matrix_version: matrix.version,
            is_compliant: compliance.is_compliant,
            violation_reasons: compliance.violation_type ? [compliance.violation_type] : [],
            metrics_json: compliance,
            matrix_snapshot: {
              matrix_id: matrix.id,
              version: matrix.version,
              self_contained_required: matrix.self_contained_required,
              nights_per_month: matrix.nights_per_month,
              max_consecutive_nights: matrix.max_consecutive_nights,
              day_visit_only: matrix.day_visit_only,
              allowed_days: matrix.allowed_days,
              homeless_exemption: matrix.homeless_exemption,
            },
            evaluated_at: new Date().toISOString(),
          }, { onConflict: 'observation_id,matrix_id' });

        // Track compliance changes
        if (!currentResult || currentResult.is_compliant !== compliance.is_compliant) {
          complianceChanged++;
        }

        // Create breach alert if non-compliant
        if (!compliance.is_compliant) {
          const { data: existingBreach } = await supabaseAdmin
            .from('breach_alerts')
            .select('id')
            .eq('observation_id', obs.observation_id)
            .maybeSingle();

          if (!existingBreach) {
            const { error: breachError } = await supabaseAdmin
              .from('breach_alerts')
              .insert({
                organization_id: obs.organization_id,
                zone_id: obs.zone_id,
                observation_id: obs.observation_id,
                plate_number: obs.plate_number,
                breach_type: compliance.violation_type || 'compliance_violation',
                breach_details: {
                  violation_message: compliance.violation_message,
                  violation_severity: compliance.violation_severity,
                  consecutive_nights: compliance.consecutive_nights,
                  month_nights: compliance.month_nights,
                  fine_amount: compliance.fine_amount,
                  recommended_action: compliance.recommended_action,
                  is_homeless: isHomeless,
                  detected_at: obs.recorded_at,
                  auto_created_by_recalculation: true,
                },
                status: 'pending',
              });

            if (!breachError) {
              breachAlertsCreated++;
            }
          }
        }

        processed++;

      } catch (error: any) {
        console.error(`❌ Error processing ${obs.observation_id}:`, error.message);
        processed++;
      }
    }

    // ============================================================
    // COMPLETE
    // ============================================================
    const durationSeconds = Math.round((Date.now() - startTime) / 1000);

    await supabaseAdmin
      .from('admin_recalculation_actions')
      .update({
        status: 'completed',
        observations_processed: processed,
        compliance_changed: complianceChanged,
        completed_at: new Date().toISOString(),
        duration_seconds: durationSeconds,
      })
      .eq('id', actionRecord.id);

    console.log(`✅ Complete: ${processed} processed, ${duplicatesRemoved} duplicates, ${zoneCorrections} zone corrections, ${complianceChanged} changed, ${breachAlertsCreated} breach alerts`);

    return new Response(
      JSON.stringify({
        success: true,
        actionId: actionRecord.id,
        summary: {
          observations_processed: processed,
          duplicates_removed: duplicatesRemoved,
          zone_corrections: zoneCorrections,
          compliance_changed: complianceChanged,
          breach_alerts_created: breachAlertsCreated,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ Recalculation failed:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Unknown error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
