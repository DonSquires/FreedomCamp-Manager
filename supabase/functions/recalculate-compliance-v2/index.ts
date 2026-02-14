import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

/**
 * SIMPLE COMPLIANCE RECALCULATION
 * 
 * Query v2 → Filter by zones + dates → Process 80 at a time → Test against matrix
 */

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
    const { zoneIds, dateRangeStart, dateRangeEnd, get_total, offset = 0, batch_size = 80 } = params;

    console.log('📥 Request:', { zoneIds, dateRangeStart, dateRangeEnd, get_total, offset, batch_size });

    if (!zoneIds || zoneIds.length === 0) {
      throw new Error('zoneIds required');
    }

    // Build query on vehicle_observations_v2
    let query = supabaseAdmin
      .from('vehicle_observations_v2')
      .select('observation_id, plate_number, zone_id, organization_id, recorded_at', { count: 'exact' });

    // Filter by zones
    query = query.in('zone_id', zoneIds);

    // Filter by date range
    if (dateRangeStart) {
      query = query.gte('recorded_at', `${dateRangeStart}T00:00:00Z`);
    }
    if (dateRangeEnd) {
      query = query.lte('recorded_at', `${dateRangeEnd}T23:59:59Z`);
    }

    // GET TOTAL MODE
    if (get_total) {
      const { count, error } = await query.select('*', { count: 'exact', head: true });
      if (error) throw error;

      console.log(`📊 Total observations: ${count}`);

      return new Response(
        JSON.stringify({ total: count || 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // PROCESS BATCH MODE
    const { data: observations, error: obsError } = await query
      .order('recorded_at', { ascending: true })
      .range(offset, offset + batch_size - 1);

    if (obsError) throw obsError;

    console.log(`📦 Processing ${observations?.length || 0} observations`);

    if (!observations || observations.length === 0) {
      return new Response(
        JSON.stringify({ processed: 0, complianceChanged: 0, breachesCreated: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let processed = 0;
    let complianceChanged = 0;
    let breachesCreated = 0;

    for (const obs of observations) {
      try {
        const plateNumber = obs.plate_number;
        if (!plateNumber) {
          processed++;
          continue;
        }

        // Get active matrix for this zone
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

        // Test against calculate_vehicle_compliance
        const checkDate = obs.recorded_at.split('T')[0];
        const { data: complianceResult, error: calcError } = await supabaseAdmin.rpc(
          'calculate_vehicle_compliance',
          {
            p_plate_number: plateNumber,
            p_zone_id: obs.zone_id,
            p_check_date: checkDate,
          }
        );

        if (calcError || !complianceResult || complianceResult.length === 0) {
          processed++;
          continue;
        }

        const compliance = complianceResult[0];

        // Check if compliance changed
        const { data: currentResult } = await supabaseAdmin
          .from('compliance_results')
          .select('is_compliant')
          .eq('observation_id', obs.observation_id)
          .maybeSingle();

        // Save compliance result
        await supabaseAdmin.from('compliance_results').upsert({
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
          },
          evaluated_at: new Date().toISOString(),
        }, { onConflict: 'observation_id,matrix_id' });

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
            await supabaseAdmin.from('breach_alerts').insert({
              organization_id: obs.organization_id,
              zone_id: obs.zone_id,
              observation_id: obs.observation_id,
              breach_type: compliance.violation_type || 'compliance_violation',
              breach_details: {
                violation_message: compliance.violation_message,
                consecutive_nights: compliance.consecutive_nights,
                month_nights: compliance.month_nights,
              },
              status: 'pending',
            });

            breachesCreated++;
          }
        }

        processed++;

      } catch (error: any) {
        console.error(`Error processing ${obs.observation_id}:`, error.message);
        processed++;
      }
    }

    console.log(`✅ Batch complete: ${processed} processed, ${complianceChanged} changed, ${breachesCreated} breaches`);

    return new Response(
      JSON.stringify({ processed, complianceChanged, breachesCreated }),
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
