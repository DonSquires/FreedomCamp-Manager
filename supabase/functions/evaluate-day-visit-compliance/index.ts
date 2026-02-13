/**
 * Edge Function: evaluate-day-visit-compliance
 * 
 * Detects overnight stays in day-visit-only zones:
 * - First night observation (6pm-8am) → "At Risk" warning
 * - Morning observation at same GPS location → "Breach" (overnight stay confirmed)
 * 
 * Called by: process-field-scan after creating observation
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

interface EvaluationRequest {
  observation_id: string;
  plate_number: string;
  zone_id: string;
  organization_id: string;
  gps_latitude: number;
  gps_longitude: number;
  recorded_at: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('🌙 Day Visit Compliance Evaluation Started');

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { observation_id, plate_number, zone_id, organization_id, gps_latitude, gps_longitude, recorded_at }: EvaluationRequest = await req.json();

    // Get zone matrix to check if day_visit_only
    const { data: matrix, error: matrixError } = await supabaseAdmin
      .from('zone_compliance_matrix')
      .select('day_visit_only')
      .eq('zone_id', zone_id)
      .is('effective_to', null)
      .single();

    if (matrixError || !matrix) {
      console.log('⚠️ No matrix found or not day-visit zone');
      return new Response(
        JSON.stringify({ skipped: true, reason: 'Not a day-visit zone' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!matrix.day_visit_only) {
      console.log('✅ Zone allows overnight stays');
      return new Response(
        JSON.stringify({ skipped: true, reason: 'Zone allows overnight' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('🚫 Day-visit-only zone detected');

    // Get time of observation
    const obsTime = new Date(recorded_at);
    const hour = obsTime.getHours();
    const isNightTime = hour >= 20 || hour < 6; // 8pm-6am considered night

    if (isNightTime) {
      // NIGHT OBSERVATION (8pm-6am) → AT RISK
      console.log(`🌙 Night-time observation at ${hour}:00 → AT RISK`);

      // Update compliance result to "At Risk"
      await supabaseAdmin
        .from('compliance_results')
        .update({
          is_compliant: false,
          violation_reasons: ['Day visit only zone - vehicle present at night (at risk of overnight stay)'],
        })
        .eq('observation_id', observation_id);

      return new Response(
        JSON.stringify({
          status: 'at_risk',
          message: 'Vehicle present at night in day-visit zone',
          time: hour,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } else {
      // MORNING OBSERVATION (6am-8pm) → Check for previous night observation at same location
      console.log(`☀️ Day-time observation at ${hour}:00 → Checking for overnight stay...`);

      // Query for night observations in past 14 hours (from 8pm yesterday to 6am today)
      const fourteenHoursAgo = new Date(obsTime.getTime() - (14 * 60 * 60 * 1000)).toISOString();

      const { data: nightObs, error: nightObsError } = await supabaseAdmin
        .from('vehicle_observations_v2')
        .select('observation_id, gps_latitude, gps_longitude, recorded_at')
        .eq('plate_number', plate_number)
        .eq('zone_id', zone_id)
        .gte('recorded_at', fourteenHoursAgo)
        .lt('recorded_at', recorded_at)
        .order('recorded_at', { ascending: false });

      if (nightObsError) {
        console.error('❌ Failed to query night observations:', nightObsError);
        return new Response(
          JSON.stringify({ error: 'Failed to check previous observations' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!nightObs || nightObs.length === 0) {
        console.log('✅ No previous night observations → Compliant (day visit only)');
        return new Response(
          JSON.stringify({
            status: 'compliant',
            message: 'Day visit only, no overnight stay detected',
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Check if any night observation is within 15m GPS proximity
      const R = 6371e3; // Earth radius in meters
      for (const prevObs of nightObs) {
        if (!prevObs.gps_latitude || !prevObs.gps_longitude) continue;

        const φ1 = (prevObs.gps_latitude * Math.PI) / 180;
        const φ2 = (gps_latitude * Math.PI) / 180;
        const Δφ = ((gps_latitude - prevObs.gps_latitude) * Math.PI) / 180;
        const Δλ = ((gps_longitude - prevObs.gps_longitude) * Math.PI) / 180;

        const a =
          Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
          Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distance = R * c;

        console.log(`📍 Distance from previous night obs: ${distance.toFixed(1)}m`);

        if (distance <= 15) {
          // OVERNIGHT STAY DETECTED → BREACH
          console.log('🚨 OVERNIGHT STAY BREACH DETECTED');

          // Update compliance result to BREACH
          await supabaseAdmin
            .from('compliance_results')
            .update({
              is_compliant: false,
              violation_reasons: ['Day visit only zone - overnight stay detected (vehicle present at night and morning at same location)'],
              after_hours_violation: true,
            })
            .eq('observation_id', observation_id);

          // Create breach alert
          await supabaseAdmin
            .from('breach_alerts')
            .insert({
              organization_id,
              zone_id,
              plate_number,
              observation_id,
              breach_type: 'unauthorized_zone',
              breach_details: {
                reason: 'Day visit only zone - overnight stay detected',
                night_observation_id: prevObs.observation_id,
                night_observation_time: prevObs.recorded_at,
                morning_observation_time: recorded_at,
                distance_meters: distance.toFixed(1),
              },
              status: 'pending',
            });

          return new Response(
            JSON.stringify({
              status: 'breach',
              message: 'Overnight stay detected in day-visit zone',
              night_obs_time: prevObs.recorded_at,
              distance_meters: distance.toFixed(1),
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      console.log('✅ Previous night observations too far away → Compliant');
      return new Response(
        JSON.stringify({
          status: 'compliant',
          message: 'Day visit only, no overnight stay at this location',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

  } catch (error: any) {
    console.error('❌ Day visit evaluation failed:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
