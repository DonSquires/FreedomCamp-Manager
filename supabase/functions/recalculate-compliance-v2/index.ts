import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

/**
 * STRICT ZONE-BASED COMPLIANCE RECALCULATION
 * 
 * ✅ ONLY uses zone-specific compliance matrix (ignores organization)
 * ✅ FAILS if zone missing matrix (doesn't silently skip)
 * ✅ Logs matrix details for transparency
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
    const { zoneIds, dateRangeStart, dateRangeEnd, get_total, offset = 0, batch_size = 50 } = params;

    console.log('📥 Request:', { zoneIds, dateRangeStart, dateRangeEnd, get_total, offset, batch_size });

    if (!zoneIds || zoneIds.length === 0) {
      throw new Error('zoneIds required');
    }

    // Build query on observations table
    let query = supabaseAdmin
      .from('observations')
      .select('id, plate_number, zone_id, organization_id, recorded_at', { count: 'exact' });

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

      // PRE-CHECK: Verify all selected zones have compliance matrices
      const { data: zonesWithoutMatrix } = await supabaseAdmin
        .from('zones')
        .select('id, name')
        .in('id', zoneIds)
        .not('id', 'in', `(SELECT DISTINCT zone_id FROM zone_compliance_matrix WHERE zone_id = ANY($1))`, [zoneIds]);

      if (zonesWithoutMatrix && zonesWithoutMatrix.length > 0) {
        const zoneNames = zonesWithoutMatrix.map(z => z.name).join(', ');
        console.warn(`⚠️ WARNING: ${zonesWithoutMatrix.length} zone(s) missing compliance matrix: ${zoneNames}`);
        
        return new Response(
          JSON.stringify({ 
            total: count || 0,
            warning: `${zonesWithoutMatrix.length} zone(s) missing compliance matrix: ${zoneNames}. These observations will be skipped.`
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

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
        JSON.stringify({ processed: 0, complianceChanged: 0, breachesCreated: 0, skippedNoMatrix: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Track zone matrices (cache to avoid re-querying)
    const zoneMatrices = new Map<string, any>();
    const zonesWithoutMatrix = new Set<string>();

    let processed = 0;
    let complianceChanged = 0;
    let breachesCreated = 0;
    let skippedNoMatrix = 0;

    for (const obs of observations) {
      try {
        const plateNumber = obs.plate_number;
        const observationId = obs.id; // Use 'id' as primary key
        if (!plateNumber) {
          processed++;
          continue;
        }

        // Get or retrieve cached matrix for this zone
        let matrix = zoneMatrices.get(obs.zone_id);

        if (!matrix && !zonesWithoutMatrix.has(obs.zone_id)) {
          const { data: foundMatrix } = await supabaseAdmin
            .from('zone_compliance_matrix')
            .select('*')
            .eq('zone_id', obs.zone_id)
            .lte('effective_from', obs.recorded_at)
            .or(`effective_to.is.null,effective_to.gte.${obs.recorded_at}`)
            .order('version', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (foundMatrix) {
            zoneMatrices.set(obs.zone_id, foundMatrix);
            matrix = foundMatrix;
            
            // Log matrix details on first encounter
            console.log(`📋 Zone ${obs.zone_id}: Using matrix v${foundMatrix.version} - SC:${foundMatrix.self_contained_required}, Max:${foundMatrix.max_consecutive_nights}n, Month:${foundMatrix.nights_per_month}n`);
          } else {
            zonesWithoutMatrix.add(obs.zone_id);
            
            // Get zone name for better error message
            const { data: zoneData } = await supabaseAdmin
              .from('zones')
              .select('name')
              .eq('id', obs.zone_id)
              .single();
            
            console.warn(`⚠️ Zone "${zoneData?.name || obs.zone_id}" has NO compliance matrix - skipping observations`);
          }
        }

        if (!matrix) {
          skippedNoMatrix++;
          processed++;
          continue;
        }

        // Test against calculate_vehicle_compliance (ZONE-SPECIFIC ONLY)
        const checkDate = obs.recorded_at.split('T')[0];
        const { data: complianceResult, error: calcError } = await supabaseAdmin.rpc(
          'calculate_vehicle_compliance',
          {
            p_plate_number: plateNumber,
            p_zone_id: obs.zone_id,  // ✅ ZONE-SPECIFIC
            p_check_date: checkDate,
          }
        );

        if (calcError) {
          console.error(`❌ Compliance calc error for ${plateNumber}:`, calcError.message);
          processed++;
          continue;
        }

        if (!complianceResult || complianceResult.length === 0) {
          console.warn(`⚠️ No compliance result for ${plateNumber} in zone ${obs.zone_id}`);
          processed++;
          continue;
        }

        const compliance = complianceResult[0];

        // Check if compliance changed
        const { data: currentResult } = await supabaseAdmin
          .from('compliance_results')
          .select('is_compliant')
          .eq('observation_id', observationId)
          .maybeSingle();

        // Save compliance result
        await supabaseAdmin.from('compliance_results').upsert({
          observation_id: observationId,
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
            .eq('observation_id', observationId)
            .maybeSingle();

          if (!existingBreach) {
            await supabaseAdmin.from('breach_alerts').insert({
              organization_id: obs.organization_id,
              zone_id: obs.zone_id,
              observation_id: observationId,
              breach_type: compliance.violation_type || 'compliance_violation',
              breach_details: {
                violation_message: compliance.violation_message,
                consecutive_nights: compliance.consecutive_nights,
                month_nights: compliance.month_nights,
              },
              status: 'pending',
            });

            breachesCreated++;
            console.log(`🚨 BREACH: ${plateNumber} - ${compliance.violation_message}`);
          }
        }

        processed++;

      } catch (error: any) {
        console.error(`❌ Error processing observation ${obs.id}:`, error.message);
        processed++;
      }
    }

    console.log(`✅ Batch complete: ${processed} processed, ${complianceChanged} changed, ${breachesCreated} breaches, ${skippedNoMatrix} skipped (no matrix)`);

    return new Response(
      JSON.stringify({ 
        processed, 
        complianceChanged, 
        breachesCreated, 
        skippedNoMatrix,
        zonesWithoutMatrix: Array.from(zonesWithoutMatrix)
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
