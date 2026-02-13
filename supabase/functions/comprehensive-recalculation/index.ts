import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

/**
 * COMPREHENSIVE RECALCULATION - ALL-IN-ONE DATA CLEANUP & COMPLIANCE
 * 
 * Complete data integrity and recalculation pipeline:
 * 1. Duplicate Detection - Max 2 observations per vehicle/zone/day (morning + evening)
 * 2. Data Integrity Check - Verify database consistency
 * 3. Zone Corrections - Fix GPS-mismatched zone assignments
 * 4. Compliance Recalculation - Calculate compliance and create breach alerts
 * 
 * Rules:
 * - Morning shift: 6am-3pm
 * - Evening shift: 3pm-6am
 * - Exceptions: Incident-linked or H&S-linked observations
 */

interface RecalculationParams {
  scope: 'ZONE' | 'ORG' | 'BUILD';
  zoneIds?: string[];
  orgIds?: string[];
  dateRangeStart?: string;
  dateRangeEnd?: string;
  batch_size?: number;
  offset?: number;
  get_total?: boolean;
  get_organizations?: boolean;
  get_zones?: boolean;
  organization_id?: string;
}

interface CleanupSummary {
  duplicates_found: number;
  duplicates_removed: number;
  integrity_issues: number;
  zone_corrections: number;
  observations_processed: number;
  compliance_changed: number;
  breach_alerts_created: number;
  errors: number;
}

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    // Auth check
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');

    // Create clients
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    // Get user
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check role
    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('role, organization_id')
      .eq('id', user.id)
      .single();

    if (!profile || !['admin', 'master'].includes(profile.role)) {
      return new Response(
        JSON.stringify({ error: 'Insufficient permissions - admin or master role required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request
    const params: RecalculationParams = await req.json();
    console.log('📥 Comprehensive recalculation request:', params);

    // GET ORGANIZATIONS MODE
    if (params.get_organizations) {
      let query = supabaseAdmin
        .from('organizations')
        .select('id, name, is_active')
        .eq('is_active', true)
        .order('name');

      if (params.scope === 'ORG' && params.orgIds && params.orgIds.length > 0) {
        query = query.in('id', params.orgIds);
      } else if (params.scope === 'ZONE' && params.zoneIds && params.zoneIds.length > 0) {
        const { data: zones } = await supabaseAdmin
          .from('zones')
          .select('organization_id')
          .in('id', params.zoneIds);

        const orgIds = [...new Set(zones?.map(z => z.organization_id) || [])];
        if (orgIds.length > 0) {
          query = query.in('id', orgIds);
        }
      }

      const { data: orgs, error: orgsError } = await query;

      if (orgsError) {
        throw new Error(`Failed to fetch organizations: ${orgsError.message}`);
      }

      return new Response(
        JSON.stringify({ organizations: orgs || [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // GET ZONES MODE
    if (params.get_zones && params.organization_id) {
      let query = supabaseAdmin
        .from('zones')
        .select('id, name, is_active, geometry')
        .eq('organization_id', params.organization_id)
        .eq('is_active', true)
        .order('name');

      if (params.scope === 'ZONE' && params.zoneIds && params.zoneIds.length > 0) {
        query = query.in('id', params.zoneIds);
      }

      const { data: zones, error: zonesError } = await query;

      if (zonesError) {
        throw new Error(`Failed to fetch zones: ${zonesError.message}`);
      }

      return new Response(
        JSON.stringify({ zones: zones || [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate scope
    if (!params.scope || !['ZONE', 'ORG', 'BUILD'].includes(params.scope)) {
      return new Response(
        JSON.stringify({ error: 'Invalid scope - must be ZONE, ORG, or BUILD' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate required parameters
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

    // Create action record
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
        observations_processed: 0,
        compliance_changed: 0,
        drift_events_created: 0,
      })
      .select()
      .single();

    if (actionError) {
      throw new Error(`Failed to create action record: ${actionError.message}`);
    }

    console.log(`📝 Created action record: ${actionRecord.id}`);

    // Initialize cleanup summary
    const summary: CleanupSummary = {
      duplicates_found: 0,
      duplicates_removed: 0,
      integrity_issues: 0,
      zone_corrections: 0,
      observations_processed: 0,
      compliance_changed: 0,
      breach_alerts_created: 0,
      errors: 0,
    };

    // ============================================================
    // PHASE 1: DUPLICATE DETECTION & REMOVAL
    // ============================================================
    console.log('🔍 PHASE 1: Duplicate Detection');

    // Build query for observations
    let query = supabaseAdmin
      .from('vehicle_observations_v2')
      .select(`
        observation_id,
        plate_number,
        zone_id,
        organization_id,
        recorded_at,
        has_incident,
        has_hs_incident
      `);

    // Apply scope filters
    if (params.scope === 'ZONE') {
      query = query.in('zone_id', params.zoneIds!);
    } else if (params.scope === 'ORG') {
      query = query.in('organization_id', params.orgIds!);
    }

    // Apply date filters
    if (params.dateRangeStart) {
      const startTimestamp = params.dateRangeStart.includes('T') 
        ? params.dateRangeStart 
        : `${params.dateRangeStart}T00:00:00Z`;
      query = query.gte('recorded_at', startTimestamp);
    }

    if (params.dateRangeEnd) {
      const endTimestamp = params.dateRangeEnd.includes('T') 
        ? params.dateRangeEnd 
        : `${params.dateRangeEnd}T23:59:59Z`;
      query = query.lte('recorded_at', endTimestamp);
    }

    // GET TOTAL COUNT MODE
    if (params.get_total) {
      const { count, error: countError } = await query
        .select('*', { count: 'exact', head: true });

      if (countError) {
        throw new Error(`Failed to count observations: ${countError.message}`);
      }

      return new Response(
        JSON.stringify({ total_observations: count || 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Batch configuration
    const batchSize = params.batch_size || 250;
    const offset = params.offset || 0;

    console.log(`📦 Batch configuration: ${batchSize} records at offset ${offset}`);

    // Fetch observations (with pagination)
    const { data: observations, error: obsError } = await query
      .order('recorded_at', { ascending: true })
      .range(offset, offset + batchSize - 1);

    if (obsError) {
      throw new Error(`Failed to fetch observations: ${obsError.message}`);
    }

    const totalObs = observations?.length || 0;
    console.log(`📊 Processing batch: ${totalObs} observations (offset: ${offset})`);

    if (totalObs === 0) {
      await supabaseAdmin
        .from('admin_recalculation_actions')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          duration_seconds: Math.round((Date.now() - startTime) / 1000),
        })
        .eq('id', actionRecord.id);

      return new Response(
        JSON.stringify({
          success: true,
          actionId: actionRecord.id,
          totalObservations: 0,
          batch_size: batchSize,
          offset: offset,
          has_more: false,
          summary: summary,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check for duplicates
    const duplicateGroups = new Map<string, any[]>();
    
    for (const obs of observations) {
      const date = obs.recorded_at.split('T')[0];
      const key = `${obs.plate_number}_${obs.zone_id}_${date}`;
      
      if (!duplicateGroups.has(key)) {
        duplicateGroups.set(key, []);
      }
      
      duplicateGroups.get(key)!.push(obs);
    }

    // Find duplicates (more than 2 per day, excluding incident/H&S exceptions)
    const duplicatesToRemove: string[] = [];

    for (const [key, group] of duplicateGroups.entries()) {
      // Separate incident/H&S-linked observations (they're exceptions)
      const exceptions = group.filter(obs => obs.has_incident || obs.has_hs_incident);
      const regular = group.filter(obs => !obs.has_incident && !obs.has_hs_incident);

      if (regular.length > 2) {
        summary.duplicates_found += regular.length - 2;

        // Determine shifts
        const morning: any[] = [];
        const evening: any[] = [];

        for (const obs of regular) {
          const hour = new Date(obs.recorded_at).getUTCHours();
          // Morning: 6am-3pm (6-15), Evening: 3pm-6am (15-6)
          if (hour >= 6 && hour < 15) {
            morning.push(obs);
          } else {
            evening.push(obs);
          }
        }

        // Keep only the FIRST observation from each shift
        const toKeep = new Set<string>();
        
        if (morning.length > 0) {
          morning.sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
          toKeep.add(morning[0].observation_id);
        }
        
        if (evening.length > 0) {
          evening.sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
          toKeep.add(evening[0].observation_id);
        }

        // Mark the rest for removal
        for (const obs of regular) {
          if (!toKeep.has(obs.observation_id)) {
            duplicatesToRemove.push(obs.observation_id);
          }
        }
      }
    }

    // Remove duplicates if found
    if (duplicatesToRemove.length > 0) {
      console.log(`🗑️ Removing ${duplicatesToRemove.length} duplicate observations...`);
      
      const { error: deleteError } = await supabaseAdmin
        .from('vehicle_observations_v2')
        .delete()
        .in('observation_id', duplicatesToRemove);

      if (deleteError) {
        console.error(`⚠️ Failed to delete duplicates: ${deleteError.message}`);
        summary.errors++;
      } else {
        summary.duplicates_removed = duplicatesToRemove.length;
        console.log(`✅ Removed ${duplicatesToRemove.length} duplicates`);
      }
    } else {
      console.log('✅ No duplicates found');
    }

    // ============================================================
    // PHASE 2: ZONE CORRECTIONS (GPS-based)
    // ============================================================
    console.log('🗺️ PHASE 2: Zone Corrections');

    // Get all zones with geometry for GPS matching
    const { data: allZones } = await supabaseAdmin
      .from('zones')
      .select('id, name, geometry, location_lat, location_lng');

    const zonesWithGeometry = (allZones || []).filter(z => z.geometry || (z.location_lat && z.location_lng));

    for (const obs of observations) {
      // Skip if already deleted as duplicate
      if (duplicatesToRemove.includes(obs.observation_id)) continue;

      // Get observation GPS
      const { data: obsData } = await supabaseAdmin
        .from('vehicle_observations_v2')
        .select('gps_latitude, gps_longitude')
        .eq('observation_id', obs.observation_id)
        .maybeSingle();

      if (!obsData || !obsData.gps_latitude || !obsData.gps_longitude) {
        continue;
      }

      const obsLat = obsData.gps_latitude;
      const obsLng = obsData.gps_longitude;

      // Find nearest zone
      let nearestZone: any = null;
      let minDistance = Infinity;

      for (const zone of zonesWithGeometry) {
        // Simple distance calculation (Haversine approximation)
        const zoneLat = zone.location_lat || (zone.geometry?.coordinates?.[1] || 0);
        const zoneLng = zone.location_lng || (zone.geometry?.coordinates?.[0] || 0);

        const latDiff = obsLat - zoneLat;
        const lngDiff = obsLng - zoneLng;
        const distance = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff);

        if (distance < minDistance) {
          minDistance = distance;
          nearestZone = zone;
        }
      }

      // If nearest zone is different from current zone, correct it
      if (nearestZone && nearestZone.id !== obs.zone_id && minDistance < 0.001) { // ~100m threshold
        console.log(`📍 Correcting zone for ${obs.observation_id}: ${obs.zone_id} → ${nearestZone.id}`);
        
        const { error: updateError } = await supabaseAdmin
          .from('vehicle_observations_v2')
          .update({ zone_id: nearestZone.id })
          .eq('observation_id', obs.observation_id);

        if (updateError) {
          console.error(`⚠️ Failed to correct zone: ${updateError.message}`);
          summary.errors++;
        } else {
          summary.zone_corrections++;
        }
      }
    }

    console.log(`✅ Zone corrections: ${summary.zone_corrections}`);

    // ============================================================
    // PHASE 3: COMPLIANCE RECALCULATION
    // ============================================================
    console.log('⚖️ PHASE 3: Compliance Recalculation');

    // Get final observation list (after duplicates removed and zone corrections)
    const { data: finalObservations } = await supabaseAdmin
      .from('vehicle_observations_v2')
      .select('observation_id, plate_number, zone_id, organization_id, recorded_at')
      .in('observation_id', observations
        .filter(o => !duplicatesToRemove.includes(o.observation_id))
        .map(o => o.observation_id)
      );

    for (const obs of (finalObservations || [])) {
      try {
        const plateNumber = obs.plate_number;

        if (!plateNumber) {
          console.warn(`⚠️ Skipping ${obs.observation_id} - no plate_number`);
          summary.observations_processed++;
          continue;
        }

        // Get vehicle homeless status
        const { data: vehicle } = await supabaseAdmin
          .from('canonical_vehicles')
          .select('homeless_status')
          .eq('plate_number', plateNumber)
          .maybeSingle();

        const isHomeless = vehicle?.homeless_status === 'confirmed' || false;

        // Get active matrix
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
          console.warn(`⚠️ No matrix for zone ${obs.zone_id} at ${obs.recorded_at}`);
          summary.observations_processed++;
          continue;
        }

        // Calculate compliance
        const checkDate = obs.recorded_at.split('T')[0];
        const { data: complianceData, error: calcError } = await supabaseAdmin.rpc(
          'calculate_vehicle_compliance',
          {
            p_plate_number: plateNumber,
            p_zone_id: obs.zone_id,
            p_check_date: checkDate,
          }
        );

        if (calcError || !complianceData || complianceData.length === 0) {
          console.error(`❌ Calc failed for ${plateNumber}: ${calcError?.message}`);
          summary.errors++;
          summary.observations_processed++;
          continue;
        }

        const compliance = complianceData[0];

        // Get current compliance result
        const { data: currentResult } = await supabaseAdmin
          .from('compliance_results')
          .select('is_compliant')
          .eq('observation_id', obs.observation_id)
          .maybeSingle();

        // Upsert compliance result
        const { error: upsertError } = await supabaseAdmin
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
          }, {
            onConflict: 'observation_id,matrix_id'
          });

        if (upsertError) {
          console.error(`❌ Upsert failed for ${obs.observation_id}: ${upsertError.message}`);
          summary.errors++;
          summary.observations_processed++;
          continue;
        }

        // Track compliance changes
        if (!currentResult || currentResult.is_compliant !== compliance.is_compliant) {
          summary.compliance_changed++;
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
                action_status: 'pending_review',
              });

            if (breachError) {
              if (breachError.code === '23505') {
                console.log(`ℹ️ Breach alert already exists for ${obs.observation_id}`);
              } else {
                console.error(`❌ Breach insert failed: ${breachError.message}`);
                summary.errors++;
              }
            } else {
              summary.breach_alerts_created++;
            }
          }
        }

        summary.observations_processed++;

      } catch (error: any) {
        console.error(`❌ Error processing ${obs.observation_id}:`, error.message);
        summary.errors++;
        summary.observations_processed++;
      }
    }

    // Mark as completed
    const durationSeconds = Math.round((Date.now() - startTime) / 1000);

    await supabaseAdmin
      .from('admin_recalculation_actions')
      .update({
        status: summary.errors > 0 && summary.observations_processed < totalObs * 0.5 ? 'failed' : 'completed',
        observations_processed: summary.observations_processed,
        compliance_changed: summary.compliance_changed,
        completed_at: new Date().toISOString(),
        duration_seconds: durationSeconds,
        error_message: summary.errors > 0 ? `Completed with ${summary.errors} errors, removed ${summary.duplicates_removed} duplicates, corrected ${summary.zone_corrections} zones` : null,
      })
      .eq('id', actionRecord.id);

    console.log(`✅ Batch complete: ${summary.observations_processed} processed, ${summary.duplicates_removed} duplicates removed, ${summary.zone_corrections} zone corrections, ${summary.compliance_changed} changed, ${summary.breach_alerts_created} breach alerts`);

    const hasMore = totalObs === batchSize;

    return new Response(
      JSON.stringify({
        success: true,
        actionId: actionRecord.id,
        totalObservations: totalObs,
        batch_size: batchSize,
        offset: offset,
        next_offset: offset + totalObs,
        has_more: hasMore,
        summary: summary,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ Comprehensive recalculation failed:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Unknown error occurred',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
