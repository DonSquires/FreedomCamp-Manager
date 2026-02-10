import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

/**
 * COMPLIANCE RECALCULATION V2 - Clean Architecture
 * 
 * Creates ONE breach alert per non-compliant observation
 * Parameters:
 * - scope: 'ZONE' | 'ORG' | 'BUILD'
 * - zoneIds: array of zone UUIDs (required if scope=ZONE)
 * - orgIds: array of org UUIDs (required if scope=ORG)
 * - dateRangeStart: ISO date string (optional)
 * - dateRangeEnd: ISO date string (optional)
 */

interface RecalculationParams {
  scope: 'ZONE' | 'ORG' | 'BUILD';
  zoneIds?: string[];
  orgIds?: string[];
  dateRangeStart?: string;
  dateRangeEnd?: string;
  get_organizations?: boolean;
  get_zones?: boolean;
  organization_id?: string;
  batch_size?: number;  // Number of observations to process per batch (default: 250)
  offset?: number;      // Starting offset for pagination
  get_total?: boolean;  // Get total count only (for pagination UI)
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
    console.log('📥 Recalculation request:', params);

    // GET ORGANIZATIONS MODE: Return list of orgs to process
    if (params.get_organizations) {
      let query = supabaseAdmin
        .from('organizations')
        .select('id, name, is_active')
        .eq('is_active', true)
        .order('name');

      // Apply scope filters
      if (params.scope === 'ORG' && params.orgIds && params.orgIds.length > 0) {
        query = query.in('id', params.orgIds);
      } else if (params.scope === 'ZONE' && params.zoneIds && params.zoneIds.length > 0) {
        // Get organizations that have the selected zones
        const { data: zones } = await supabaseAdmin
          .from('zones')
          .select('organization_id')
          .in('id', params.zoneIds);

        const orgIds = [...new Set(zones?.map(z => z.organization_id) || [])];
        if (orgIds.length > 0) {
          query = query.in('id', orgIds);
        }
      }
      // BUILD scope = all organizations (no filter)

      const { data: orgs, error: orgsError } = await query;

      if (orgsError) {
        throw new Error(`Failed to fetch organizations: ${orgsError.message}`);
      }

      return new Response(
        JSON.stringify({ organizations: orgs || [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // GET ZONES MODE: Return list of zones for an org
    if (params.get_zones && params.organization_id) {
      let query = supabaseAdmin
        .from('zones')
        .select('id, name, is_active')
        .eq('organization_id', params.organization_id)
        .eq('is_active', true)
        .order('name');

      // Apply zone filter if scope is ZONE
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

    // STEP 1: Create action record
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

    // STEP 2: Build query for observations (using vehicle_observations_v2)
    let query = supabaseAdmin
      .from('vehicle_observations_v2')
      .select(`
        observation_id,
        plate_number,
        zone_id,
        organization_id,
        recorded_at
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

    // GET TOTAL COUNT MODE: Return total observations count (for pagination UI)
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
    const batchSize = params.batch_size || 250;  // Default: 250 observations per batch
    const offset = params.offset || 0;

    console.log(`📦 Batch configuration: ${batchSize} records at offset ${offset}`);

    // Fetch observations (with pagination)
    const { data: observations, error: obsError } = await query
      .order('recorded_at', { ascending: true })
      .range(offset, offset + batchSize - 1);  // Fetch only this batch

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
          summary: { processed: 0, complianceChanged: 0, breachAlertsCreated: 0 },
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // STEP 3: Process observations
    let processed = 0;
    let complianceChanged = 0;
    let breachAlertsCreated = 0;
    let errors = 0;

    for (const obs of observations) {
      try {
        const plateNumber = (obs as any).plate_number;

        if (!plateNumber) {
          console.warn(`⚠️ Skipping ${obs.observation_id} - no plate_number`);
          processed++;
          continue;
        }

        // Get vehicle homeless status from canonical_vehicles
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
          processed++;
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
          errors++;
          processed++;
          continue;
        }

        const compliance = complianceData[0];

        // Get current compliance result to detect changes
        const { data: currentResult } = await supabaseAdmin
          .from('compliance_results')
          .select('is_compliant')
          .eq('observation_id', obs.observation_id)
          .maybeSingle();

        // Upsert compliance result (using plate_number instead of vehicle_id)
        const { error: upsertError } = await supabaseAdmin
          .from('compliance_results')
          .upsert({
            observation_id: obs.observation_id,
            vehicle_id: null, // Deprecated - using plate_number now
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
          errors++;
          processed++;
          continue;
        }

        // Track compliance changes
        if (!currentResult || currentResult.is_compliant !== compliance.is_compliant) {
          complianceChanged++;
        }

        // CREATE BREACH ALERT IF NON-COMPLIANT (ONE PER OBSERVATION)
        if (!compliance.is_compliant) {
          // Check if breach alert already exists for THIS observation
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
              // Check if it's a unique constraint violation (observation_id already has a breach)
              if (breachError.code === '23505') {
                console.log(`ℹ️ Breach alert already exists for ${obs.observation_id} (unique constraint)`);
              } else {
                console.error(`❌ Breach insert failed for ${obs.observation_id}: ${breachError.message}`);
                errors++;
              }
            } else {
              breachAlertsCreated++;
              console.log(`📝 Created breach alert for ${plateNumber} (${compliance.violation_type})`);
            }
          }
        }

        processed++;

        // Update progress every 50 observations
        if (processed % 50 === 0) {
          await supabaseAdmin
            .from('admin_recalculation_actions')
            .update({
              observations_processed: processed,
              compliance_changed: complianceChanged,
            })
            .eq('id', actionRecord.id);

          console.log(`📊 Progress: ${processed}/${totalObs} (${Math.round(processed/totalObs*100)}%)`);
        }

      } catch (error: any) {
        console.error(`❌ Error processing ${obs.observation_id}:`, error.message);
        errors++;
        processed++;
      }
    }

    // Mark as completed
    const durationSeconds = Math.round((Date.now() - startTime) / 1000);

    await supabaseAdmin
      .from('admin_recalculation_actions')
      .update({
        status: errors > 0 && processed < totalObs * 0.5 ? 'failed' : 'completed',
        observations_processed: processed,
        compliance_changed: complianceChanged,
        completed_at: new Date().toISOString(),
        duration_seconds: durationSeconds,
        error_message: errors > 0 ? `Completed with ${errors} errors` : null,
      })
      .eq('id', actionRecord.id);

    console.log(`✅ Batch complete: ${processed} processed, ${complianceChanged} changed, ${breachAlertsCreated} breach alerts created`);

    // Check if there are more records to process
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
        summary: {
          processed,
          complianceChanged,
          breachAlertsCreated,
          errors,
          durationSeconds,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ Recalculation failed:', error);
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
