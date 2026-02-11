import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

/**
 * Bulk Compliance Recalculation Edge Function
 * Recalculates compliance for multiple zones with drift detection
 * - Removes auto-added followup flags (preserves manual ones)
 * - Creates breach alerts and enforcement actions for non-compliant vehicles
 */

interface RecalculationRequest {
  scope_type: 'ZONE' | 'ORG' | 'BUILD';
  zone_ids?: string[];
  organization_ids?: string[];
  date_range_start?: string;
  date_range_end?: string;
}

interface RecalculationResult {
  action_id: string;
  observations_processed: number;
  compliance_changed: number;
  drift_events_created: number;
  duration_seconds: number;
  status: 'completed' | 'failed';
  error_message?: string;
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get user info from JWT
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader! } } }
    );

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify admin/master permissions
    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('role, organization_id')
      .eq('id', user.id)
      .single();

    if (!profile || !['admin', 'master'].includes(profile.role)) {
      return new Response(
        JSON.stringify({ error: 'Insufficient permissions' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const request = await req.json() as RecalculationRequest;

    // Validate request
    if (!request.scope_type) {
      return new Response(
        JSON.stringify({ error: 'scope_type is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const startTime = Date.now();

    // Create audit record
    const { data: action, error: actionError } = await supabaseAdmin
      .from('admin_recalculation_actions')
      .insert({
        scope_type: request.scope_type,
        target_zone_ids: request.zone_ids || [],
        target_org_ids: request.organization_ids || [],
        date_range_start: request.date_range_start,
        date_range_end: request.date_range_end,
        performed_by: user.id,
        status: 'running',
      })
      .select()
      .single();

    if (actionError) throw actionError;

    try {
      // Determine zones to recalculate
      let zoneIds: string[] = [];

      if (request.scope_type === 'ZONE') {
        zoneIds = request.zone_ids || [];
      } else if (request.scope_type === 'ORG') {
        const { data: zones } = await supabaseAdmin
          .from('zones')
          .select('id')
          .in('organization_id', request.organization_ids || []);
        
        zoneIds = zones?.map(z => z.id) || [];
      } else if (request.scope_type === 'BUILD') {
        const { data: zones } = await supabaseAdmin
          .from('zones')
          .select('id');
        
        zoneIds = zones?.map(z => z.id) || [];
      }

      if (zoneIds.length === 0) {
        throw new Error('No zones found for recalculation');
      }

      console.log(`Recalculating compliance for ${zoneIds.length} zones...`);

      // CLEANUP - Delete orphaned compliance results from zone corrections
      console.log('🧹 Cleaning up orphaned compliance results from zone corrections...');
      
      const { data: orphanedResults, error: orphanedError } = await supabaseAdmin
        .from('compliance_results')
        .select(`
          id,
          observation_id,
          zone_id,
          vehicle_observations!inner(zone_id)
        `);
      
      if (!orphanedError && orphanedResults) {
        const orphanedIds = orphanedResults
          .filter(cr => cr.zone_id !== (cr.vehicle_observations as any).zone_id)
          .map(cr => cr.id);
        
        if (orphanedIds.length > 0) {
          console.log(`🗑️ Deleting ${orphanedIds.length} orphaned compliance results...`);
          
          const { error: deleteError } = await supabaseAdmin
            .from('compliance_results')
            .delete()
            .in('id', orphanedIds);
          
          if (deleteError) {
            console.warn('⚠️ Failed to delete some orphaned results:', deleteError.message);
          } else {
            console.log(`✅ Cleaned up ${orphanedIds.length} orphaned compliance results`);
          }
        } else {
          console.log('✅ No orphaned compliance results found');
        }
      }

      let observationsProcessed = 0;
      let complianceChanged = 0;
      let driftEventsCreated = 0;

      // Process each zone
      for (const zoneId of zoneIds) {
        console.log(`Processing zone ${zoneId}...`);

        // Get current active matrix
        const { data: currentMatrix } = await supabaseAdmin
          .rpc('get_active_matrix', { p_zone_id: zoneId });

        if (!currentMatrix) {
          console.log(`No active matrix for zone ${zoneId}, skipping`);
          continue;
        }

        // Get observations for this zone
        let query = supabaseAdmin
          .from('vehicle_observations')
          .select('observation_id, vehicle_id, organization_id, zone_id, recorded_at')
          .eq('zone_id', zoneId);

        if (request.date_range_start) {
          query = query.gte('recorded_at', request.date_range_start);
        }
        if (request.date_range_end) {
          query = query.lte('recorded_at', request.date_range_end);
        }

        const { data: observations } = await query;

        if (!observations || observations.length === 0) {
          console.log(`No observations for zone ${zoneId}`);
          continue;
        }

        console.log(`Found ${observations.length} observations for zone ${zoneId}`);

        // Recalculate compliance for each observation
        for (const obs of observations) {
          try {
            // Get matrix active at observation time
            const { data: matrixAtTime } = await supabaseAdmin
              .rpc('get_active_matrix', {
                p_zone_id: obs.zone_id,
                p_timestamp: obs.recorded_at
              });

            if (!matrixAtTime) {
              console.log(`No matrix for observation ${obs.observation_id} at ${obs.recorded_at}`);
              continue;
            }

            // Calculate compliance using matrix
            const { data: complianceResult } = await supabaseAdmin
              .rpc('calculate_vehicle_compliance', {
                p_vehicle_id: obs.vehicle_id,
                p_zone_id: obs.zone_id,
                p_check_date: obs.recorded_at
              });

            // Get old compliance result if exists
            const { data: oldResult } = await supabaseAdmin
              .from('compliance_results')
              .select('is_compliant')
              .eq('observation_id', obs.observation_id)
              .single();

            // Create/update compliance result with matrix reference
            const { error: upsertError } = await supabaseAdmin
              .from('compliance_results')
              .upsert({
                observation_id: obs.observation_id,
                vehicle_id: obs.vehicle_id,
                zone_id: obs.zone_id,
                organization_id: obs.organization_id,
                matrix_id: matrixAtTime.id,
                matrix_version: matrixAtTime.version,
                is_compliant: complianceResult?.is_compliant ?? true,
                violation_reasons: complianceResult?.violations || [],
                metrics_json: complianceResult || {},
                matrix_snapshot: {
                  matrix_id: matrixAtTime.id,
                  version: matrixAtTime.version,
                  effective_from: matrixAtTime.effective_from,
                  effective_to: matrixAtTime.effective_to,
                  self_contained_required: matrixAtTime.self_contained_required,
                  nights_per_month: matrixAtTime.nights_per_month,
                  max_consecutive_nights: matrixAtTime.max_consecutive_nights,
                  day_visit_only: matrixAtTime.day_visit_only,
                  allowed_days: matrixAtTime.allowed_days,
                  homeless_exemption: matrixAtTime.homeless_exemption,
                },
                evaluated_at: new Date().toISOString(),
              }, {
                onConflict: 'observation_id,matrix_id'
              });

            if (upsertError) {
              console.error(`Failed to upsert compliance for ${obs.observation_id}:`, upsertError);
              continue;
            }

            observationsProcessed++;

            // Detect drift
            if (oldResult && oldResult.is_compliant !== complianceResult?.is_compliant) {
              complianceChanged++;
            }
            
            // AUTO-CREATE BREACH AND ENFORCEMENT ACTION IF NON-COMPLIANT
            const isCompliant = complianceResult?.is_compliant ?? true;
            const violations = complianceResult?.violations || [];
            
            if (!isCompliant && violations.length > 0) {
              // Check if vehicle is homeless
              const { data: canonicalVehicle } = await supabaseAdmin
                .from('canonical_vehicles')
                .select('plate_number, homeless_confirmed')
                .eq('vehicle_id', obs.vehicle_id)
                .single();
              
              const isHomeless = canonicalVehicle?.homeless_confirmed || false;
              
              // Get vehicle_record_id from this observation
              const { data: vehicleRecord } = await supabaseAdmin
                .from('vehicle_records')
                .select('id, requires_followup, followup_reason')
                .eq('organization_id', obs.organization_id)
                .eq('zone_id', obs.zone_id)
                .eq('plate_number', canonicalVehicle?.plate_number)
                .order('recorded_at', { ascending: false })
                .limit(1)
                .single();
              
              // Remove auto-added followup flags (keep manual ones)
              if (vehicleRecord?.requires_followup && 
                  vehicleRecord?.followup_reason && 
                  vehicleRecord.followup_reason.includes('Auto-created')) {
                await supabaseAdmin
                  .from('vehicle_records')
                  .update({
                    requires_followup: false,
                    followup_reason: null,
                    followup_priority: null,
                  })
                  .eq('id', vehicleRecord.id);
                
                console.log(`Removed auto-added followup flag from vehicle record ${vehicleRecord.id}`);
              }
              
              // Check if breach alert already exists for THIS SPECIFIC OBSERVATION
              // Each observation should have its own breach alert if non-compliant
              const { data: existingBreaches } = await supabaseAdmin
                .from('breach_alerts')
                .select('id, breach_details')
                .eq('organization_id', obs.organization_id)
                .eq('zone_id', obs.zone_id)
                .eq('vehicle_record_id', vehicleRecord?.id);
              
              // Check if any existing breach matches this observation_id in breach_details
              const existingBreach = existingBreaches?.find(breach => 
                breach.breach_details?.observation_id === obs.observation_id
              );
              
              // Create breach alert if doesn't exist for THIS OBSERVATION
              // This ensures each non-compliant observation gets its own breach record
              if (!existingBreach && vehicleRecord?.id) {
                console.log(`Creating breach alert for observation ${obs.observation_id}...`);
                const { data: newBreach, error: breachError } = await supabaseAdmin
                  .from('breach_alerts')
                  .insert({
                    organization_id: obs.organization_id,
                    zone_id: obs.zone_id,
                    vehicle_record_id: vehicleRecord.id,
                    breach_type: violations[0] || 'compliance_violation',
                    breach_details: {
                      violations: violations,
                      observation_id: obs.observation_id,
                      detected_at: obs.recorded_at,
                      is_homeless: isHomeless,
                      auto_created_by_recalculation: true,
                    },
                    status: 'pending',
                  })
                  .select()
                  .single();
                
                if (breachError) {
                  console.error(`Failed to create breach alert:`, breachError.message);
                } else {
                  // Create enforcement action with "no action taken"
                  const enforcementReason = isHomeless 
                    ? 'This is under the Freedom Camping Act' 
                    : 'Education phase';
                  
                  await supabaseAdmin
                    .from('enforcement_actions')
                    .insert({
                      organization_id: obs.organization_id,
                      user_id: user.id,
                      vehicle_record_id: vehicleRecord.id,
                      zone_id: obs.zone_id,
                      action_type: 'no_action',
                      delivery_method: 'none',
                      notes: enforcementReason,
                      status: 'completed',
                      recorded_at: new Date().toISOString(),
                    });
                  
                  console.log(`Created breach alert and enforcement action (${enforcementReason}) for observation ${obs.observation_id}`);
                }
              }
            }

          } catch (obsError: any) {
            console.error(`Error processing observation ${obs.observation_id}:`, obsError);
          }
        }

        // Check for drift in this zone
        const { data: matrixHistory } = await supabaseAdmin
          .from('zone_compliance_matrix')
          .select('*')
          .eq('zone_id', zoneId)
          .order('version', { ascending: false })
          .limit(2);

        if (matrixHistory && matrixHistory.length >= 2) {
          const latestMatrix = matrixHistory[0];
          const previousMatrix = matrixHistory[1];

          // Detect criteria changes
          const criteriaChanged: any = {};
          const fields = ['self_contained_required', 'nights_per_month', 'max_consecutive_nights', 'day_visit_only', 'allowed_days', 'homeless_exemption'];
          
          for (const field of fields) {
            if (JSON.stringify(latestMatrix[field]) !== JSON.stringify(previousMatrix[field])) {
              criteriaChanged[field] = {
                from: previousMatrix[field],
                to: latestMatrix[field],
              };
            }
          }

          // Create drift event if changes detected
          if (Object.keys(criteriaChanged).length > 0) {
            const { error: driftError } = await supabaseAdmin
              .from('drift_events')
              .insert({
                zone_id: zoneId,
                organization_id: latestMatrix.organization_id,
                matrix_version_from: previousMatrix.version,
                matrix_version_to: latestMatrix.version,
                matrix_id_from: previousMatrix.id,
                matrix_id_to: latestMatrix.id,
                observations_affected: observationsProcessed,
                compliance_changed: complianceChanged,
                criteria_changed: criteriaChanged,
                detected_by: user.id,
                status: 'pending',
              });

            if (!driftError) {
              driftEventsCreated++;
            }
          }
        }
      }

      const duration = Math.round((Date.now() - startTime) / 1000);

      // Update action record
      await supabaseAdmin
        .from('admin_recalculation_actions')
        .update({
          observations_processed: observationsProcessed,
          compliance_changed: complianceChanged,
          drift_events_created: driftEventsCreated,
          status: 'completed',
          completed_at: new Date().toISOString(),
          duration_seconds: duration,
        })
        .eq('id', action.id);

      const result: RecalculationResult = {
        action_id: action.id,
        observations_processed: observationsProcessed,
        compliance_changed: complianceChanged,
        drift_events_created: driftEventsCreated,
        duration_seconds: duration,
        status: 'completed',
      };

      return new Response(
        JSON.stringify(result),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } catch (error: any) {
      const duration = Math.round((Date.now() - startTime) / 1000);

      // Update action record with error
      await supabaseAdmin
        .from('admin_recalculation_actions')
        .update({
          status: 'failed',
          error_message: error.message,
          completed_at: new Date().toISOString(),
          duration_seconds: duration,
        })
        .eq('id', action.id);

      throw error;
    }

  } catch (error: any) {
    console.error('Recalculation error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Recalculation failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
