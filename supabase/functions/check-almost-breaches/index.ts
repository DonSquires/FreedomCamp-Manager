/**
 * Check Almost Breaches Edge Function
 * 
 * Real-time breach prediction: Analyzes if vehicles WILL BREACH if they stay tonight
 * 
 * Logic:
 * - Check at 20:00 (8 PM): "Will this vehicle breach if it stays overnight?"
 * - Morning check at 07:00: "Is vehicle still here? → Enforcement required"
 * - Considers both consecutive nights and monthly limits
 * - Respects homeless exemptions
 * 
 * Called by:
 * - process-field-scan (after each observation)
 * - Frontend useOfficerNotifications hook (periodic check)
 * - Scheduled cron job (hourly during patrol hours 19:00-09:00)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

interface AlmostBreachVehicle {
  plate_number: string;
  zone_id: string;
  zone_name: string;
  organization_id: string;
  nights_stayed: number;
  nights_allowed: number;
  consecutive_nights: number;
  consecutive_allowed: number;
  nights_until_breach: number;
  breach_type: 'consecutive' | 'monthly' | 'both';
  last_observation_date: string;
  photo_url?: string;
  gps_lat?: number;
  gps_lng?: number;
  gps_accuracy?: number;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { organization_id, zone_id, threshold_nights = 2 } = await req.json();

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('🔍 Checking for almost breaches...', { organization_id, zone_id, threshold_nights });

    // Get current calendar month
    const now = new Date();
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];

    // Query: Find vehicles approaching limits
    let query = supabaseAdmin
      .from('vehicle_monthly_stays')
      .select(`
        plate_number,
        zone_id,
        organization_id,
        nights_stayed,
        consecutive_nights,
        last_observation_date,
        zones!inner (
          name,
          max_consecutive_nights,
          nights_per_month,
          homeless_exemption
        ),
        canonical_vehicles!inner (
          homeless_status,
          homeless_notes
        )
      `)
      .eq('calendar_month', currentMonth)
      .gte('nights_stayed', 1); // Only vehicles with at least 1 night

    if (organization_id) {
      query = query.eq('organization_id', organization_id);
    }

    if (zone_id) {
      query = query.eq('zone_id', zone_id);
    }

    const { data: stays, error: staysError } = await query;

    if (staysError) {
      console.error('Failed to query monthly stays:', staysError);
      throw staysError;
    }

    console.log(`Found ${stays?.length || 0} vehicles with nights stayed`);

    // Filter to vehicles approaching limits
    const almostBreaches: AlmostBreachVehicle[] = [];

    for (const stay of stays || []) {
      const zone = (stay.zones as any);
      const vehicle = (stay.canonical_vehicles as any);
      const consecutiveAllowed = zone.max_consecutive_nights || 3;
      const monthlyAllowed = zone.nights_per_month || 28;

      // CRITICAL: Check homeless exemption
      const isHomelessExempt = vehicle?.homeless_status === 'confirmed' || vehicle?.homeless_status === 'claimed';
      const zoneAllowsHomeless = zone.homeless_exemption !== false; // Default true if not specified
      
      // Skip if homeless and zone allows exemption
      if (isHomelessExempt && zoneAllowsHomeless) {
        console.log(`✅ Skipping ${stay.plate_number} - homeless exempt in ${zone.name}`);
        continue;
      }

      // CRITICAL LOGIC: Will this vehicle breach if it stays ONE MORE NIGHT?
      const willBreachConsecutive = (stay.consecutive_nights + 1) > consecutiveAllowed;
      const willBreachMonthly = (stay.nights_stayed + 1) > monthlyAllowed;
      
      // Also check traditional "approaching" logic (within threshold)
      const consecutiveUntilBreach = consecutiveAllowed - stay.consecutive_nights;
      const monthlyUntilBreach = monthlyAllowed - stay.nights_stayed;
      const approachingConsecutive = consecutiveUntilBreach > 0 && consecutiveUntilBreach <= threshold_nights;
      const approachingMonthly = monthlyUntilBreach > 0 && monthlyUntilBreach <= threshold_nights;

      // Alert if WILL BREACH or is approaching limits (and NOT homeless exempt)
      if (willBreachConsecutive || willBreachMonthly || approachingConsecutive || approachingMonthly) {
        // Get latest observation photo and GPS
        const { data: latestObs } = await supabaseAdmin
          .from('observations')
          .select('photo, gps_latitude, gps_longitude, gps_accuracy')
          .eq('plate_number', stay.plate_number)
          .eq('zone_id', stay.zone_id)
          .order('recorded_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        almostBreaches.push({
          plate_number: stay.plate_number,
          zone_id: stay.zone_id,
          zone_name: zone.name,
          organization_id: stay.organization_id,
          nights_stayed: stay.nights_stayed,
          nights_allowed: monthlyAllowed,
          consecutive_nights: stay.consecutive_nights,
          consecutive_allowed: consecutiveAllowed,
          nights_until_breach: Math.min(consecutiveUntilBreach, monthlyUntilBreach),
          breach_type: (willBreachConsecutive || approachingConsecutive) && (willBreachMonthly || approachingMonthly)
            ? 'both' 
            : (willBreachConsecutive || approachingConsecutive)
            ? 'consecutive' 
            : 'monthly',
          will_breach_if_stays_tonight: willBreachConsecutive || willBreachMonthly,
          breach_severity: willBreachConsecutive || willBreachMonthly ? 'critical' : 'warning',
          last_observation_date: stay.last_observation_date,
          photo_url: latestObs?.photo,
          gps_lat: latestObs?.gps_latitude,
          gps_lng: latestObs?.gps_longitude,
          gps_accuracy: latestObs?.gps_accuracy,
          homeless_status: vehicle?.homeless_status,
          homeless_notes: vehicle?.homeless_notes,
          is_homeless_exempt: false, // Already filtered out exempt vehicles above
        });
      }
    }

    console.log(`✅ Found ${almostBreaches.length} vehicles approaching breach limits`);

    return new Response(
      JSON.stringify({
        success: true,
        count: almostBreaches.length,
        vehicles: almostBreaches,
        current_month: currentMonth,
        threshold_nights,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ Check almost breaches error:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to check almost breaches',
        message: error.message,
        stack: error.stack,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
