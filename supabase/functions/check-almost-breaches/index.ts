/**
 * Check Almost Breaches Edge Function
 *
 * Real-time breach prediction: finds vehicles that WILL breach if they stay tonight.
 *
 * Logic:
 * - For each unique plate+zone with observations in the current month, derive the
 *   latest nights_stayed_this_month and consecutive_nights from the most recent
 *   observation (stored as a snapshot at scan time).
 * - Predict whether staying ONE MORE NIGHT would push either counter over the limit.
 * - Respects homeless exemptions from canonical_homeless.
 *
 * NOTE: vehicle_monthly_stays is no longer auto-updated by the new observations
 * pipeline. Compliance snapshots are now read directly from the observations table.
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
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');
    if (!token) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { organization_id, zone_id, threshold_nights = 2 } = await req.json();

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser(token);
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

    if (!profile || !['master', 'admin', 'admin_officer'].includes(profile.role)) {
      return new Response(
        JSON.stringify({ error: 'Insufficient permissions' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Non-master users are always restricted to their own organization.
    const effectiveOrganizationId = profile.role === 'master'
      ? organization_id
      : (profile.organization_id || organization_id);

    console.log('🔍 Checking for almost breaches...', {
      organization_id: effectiveOrganizationId,
      zone_id,
      threshold_nights,
      requested_by: user.id,
    });

    // ── Pre-load zone compliance rules ───────────────────────────────────────
    let zonesQuery = supabaseAdmin
      .from('zones')
      .select('id, name, max_consecutive_nights, nights_per_month, organization_id');
    if (effectiveOrganizationId) zonesQuery = zonesQuery.eq('organization_id', effectiveOrganizationId);
    if (zone_id)         zonesQuery = zonesQuery.eq('id', zone_id);
    const { data: zones } = await zonesQuery;
    const zoneMap = new Map((zones ?? []).map((z: any) => [z.id, z]));

    // Also check zone_compliance_matrix for active rules (overrides zone table)
    const { data: matrices } = await supabaseAdmin
      .from('zone_compliance_matrix')
      .select('zone_id, max_consecutive_nights, nights_per_month, homeless_exemption')
      .is('effective_to', null);
    const matrixByZone = new Map((matrices ?? []).map((m: any) => [m.zone_id, m]));

    // ── Load most recent observation per plate+zone in current calendar month ─
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    let obsQuery = supabaseAdmin
      .from('observations')
      .select('plate_number, zone_id, organization_id, nights_stayed_this_month, consecutive_nights, recorded_at, photo_url, gps_latitude, gps_longitude, gps_accuracy')
      
      .gte('recorded_at', monthStart)
      .order('recorded_at', { ascending: false });

    if (effectiveOrganizationId) obsQuery = obsQuery.eq('organization_id', effectiveOrganizationId);
    if (zone_id)         obsQuery = obsQuery.eq('zone_id', zone_id);

    const { data: observations, error: obsError } = await obsQuery;
    if (obsError) throw obsError;

    // Deduplicate: keep most recent snapshot per plate+zone
    const latestByPlateZone = new Map<string, any>();
    for (const obs of observations ?? []) {
      const key = `${obs.plate_number}:${obs.zone_id}`;
      if (!latestByPlateZone.has(key)) {
        latestByPlateZone.set(key, obs);
      }
    }

    console.log(`Found ${latestByPlateZone.size} unique plate+zone combinations`);

    // ── Pre-load homeless vehicle set ────────────────────────────────────────
    const uniquePlates = [...new Set([...latestByPlateZone.values()].map(o => o.plate_number))];
    const { data: homelessVehicles } = uniquePlates.length > 0
      ? await (supabaseAdmin.from('canonical_homeless') as any)
          .select('plate_number, status')
          .in('plate_number', uniquePlates)
      : { data: [] };

    const vehicleMap = new Map((homelessVehicles ?? []).map((v: any) => [v.plate_number, v]));

    // ── Evaluate each plate+zone ─────────────────────────────────────────────
    const almostBreaches: AlmostBreachVehicle[] = [];

    for (const [_key, obs] of latestByPlateZone) {
      const rules = matrixByZone.get(obs.zone_id) ?? zoneMap.get(obs.zone_id);
      if (!rules) continue;

      const vehicle = vehicleMap.get(obs.plate_number);
      const consecutiveAllowed = rules.max_consecutive_nights ?? 3;
      const monthlyAllowed     = rules.nights_per_month ?? 28;
      const homelessExemption  = rules.homeless_exemption !== false;
      const isHomelessExempt   =
        (vehicle?.status === 'confirmed' || vehicle?.status === 'claimed') &&
        homelessExemption;

      if (isHomelessExempt) continue;

      const nightsStayed   = obs.nights_stayed_this_month ?? 0;
      const consecutiveN   = obs.consecutive_nights ?? 0;

      const willBreachConsecutive = (consecutiveN + 1) > consecutiveAllowed;
      const willBreachMonthly     = (nightsStayed + 1) > monthlyAllowed;

      const consecutiveUntilBreach = consecutiveAllowed - consecutiveN;
      const monthlyUntilBreach     = monthlyAllowed - nightsStayed;
      const approachingConsecutive = consecutiveUntilBreach > 0 && consecutiveUntilBreach <= threshold_nights;
      const approachingMonthly     = monthlyUntilBreach > 0 && monthlyUntilBreach <= threshold_nights;

      if (willBreachConsecutive || willBreachMonthly || approachingConsecutive || approachingMonthly) {
        const zoneMeta = zoneMap.get(obs.zone_id) as any;
        almostBreaches.push({
          plate_number:         obs.plate_number,
          zone_id:              obs.zone_id,
          zone_name:            zoneMeta?.name ?? obs.zone_id,
          organization_id:      obs.organization_id,
          nights_stayed:        nightsStayed,
          nights_allowed:       monthlyAllowed,
          consecutive_nights:   consecutiveN,
          consecutive_allowed:  consecutiveAllowed,
          nights_until_breach:  Math.min(consecutiveUntilBreach, monthlyUntilBreach),
          breach_type:
            (willBreachConsecutive || approachingConsecutive) && (willBreachMonthly || approachingMonthly)
              ? 'both'
              : (willBreachConsecutive || approachingConsecutive)
              ? 'consecutive'
              : 'monthly',
          last_observation_date: obs.recorded_at,
          photo_url:  obs.photo_url,
          gps_lat:    obs.gps_latitude,
          gps_lng:    obs.gps_longitude,
          gps_accuracy: obs.gps_accuracy,
        } as any);
      }
    }

    console.log(`✅ Found ${almostBreaches.length} vehicles approaching breach limits`);

    return new Response(
      JSON.stringify({
        success: true,
        count: almostBreaches.length,
        vehicles: almostBreaches,
        current_month: monthStart.split('T')[0],
        threshold_nights,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ Check almost breaches error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to check almost breaches', message: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
