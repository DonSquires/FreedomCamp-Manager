// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';
import { nzHour } from '../_shared/compliance.ts';

interface RequestBody {
  organization_id?: string;
  zone_id?: string;
  observation_id?: string;
  limit?: number;
  offset?: number;
  apply?: boolean;
  date_from?: string;
  date_to?: string;
}

interface MatrixRules {
  self_contained_required?: boolean | null;
  requires_csc?: boolean | null;
  nights_per_month?: number | null;
  max_consecutive_nights?: number | null;
  day_visit_only?: boolean | null;
  homeless_exemption?: boolean | null;
}

function evaluateCompliance(obs: any, matrix: MatrixRules, isHomeless: boolean) {
  let isCompliant = true;
  let breachType: string | null = null;
  let breachReason: string | null = null;

  if (matrix.day_visit_only) {
    const hour = nzHour(obs.recorded_at);
    if (hour >= 20 || hour < 8) {
      isCompliant = false;
      breachType = 'day_visit_violation';
      breachReason = `Night visit in day-only zone (observed at ${hour}:00 NZ time)`;
    }
  }

  if (isCompliant && matrix.nights_per_month != null) {
    if ((obs.nights_stayed_this_month ?? 0) > matrix.nights_per_month) {
      if (!(isHomeless && matrix.homeless_exemption !== false)) {
        isCompliant = false;
        breachType = 'monthly_limit';
        breachReason = `Exceeded monthly stay limit: ${obs.nights_stayed_this_month ?? 0} nights stayed, limit is ${matrix.nights_per_month}`;
      }
    }
  }

  if (isCompliant && matrix.max_consecutive_nights != null) {
    if ((obs.consecutive_nights ?? 0) > matrix.max_consecutive_nights) {
      if (!(isHomeless && matrix.homeless_exemption !== false)) {
        isCompliant = false;
        breachType = 'consecutive_nights';
        breachReason = `Exceeded consecutive nights limit: ${obs.consecutive_nights ?? 0} consecutive nights, limit is ${matrix.max_consecutive_nights}`;
      }
    }
  }

  if (isCompliant && (matrix.self_contained_required || matrix.requires_csc)) {
    if (!obs.self_contained) {
      if (!(isHomeless && matrix.homeless_exemption !== false)) {
        isCompliant = false;
        breachType = 'self_contained';
        breachReason = 'Zone requires a self-contained vehicle; no valid CSC on record';
      }
    }
  }

  return { isCompliant, breachType, breachReason };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
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

    const { data: callerProfile } = await supabaseAdmin
      .from('user_profiles')
      .select('role, organization_id')
      .eq('id', user.id)
      .single();

    if (!callerProfile || !['master', 'admin', 'admin_officer'].includes(callerProfile.role)) {
      return new Response(
        JSON.stringify({ error: 'Insufficient permissions' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = (await req.json().catch(() => ({}))) as RequestBody;
    const apply = body.apply ?? true;
    const limit = Math.min(Math.max(body.limit ?? 500, 1), 5000);
    const offset = Math.max(body.offset ?? 0, 0);

    const effectiveOrgId = callerProfile.role === 'master'
      ? body.organization_id
      : callerProfile.organization_id;

    let query = supabaseAdmin
      .from('observations')
      .select('id, observation_id, organization_id, zone_id, plate_number, recorded_at, self_contained, nights_stayed_this_month, consecutive_nights, is_compliant, breach_type, breach_reason')
      .order('recorded_at', { ascending: true })
      .range(offset, offset + limit - 1);

    if (effectiveOrgId) query = query.eq('organization_id', effectiveOrgId);
    if (body.zone_id) query = query.eq('zone_id', body.zone_id);
    if (body.observation_id) query = query.or(`id.eq.${body.observation_id},observation_id.eq.${body.observation_id}`);
    if (body.date_from) query = query.gte('recorded_at', `${body.date_from}T00:00:00Z`);
    if (body.date_to) query = query.lte('recorded_at', `${body.date_to}T23:59:59Z`);

    const { data: observations, error: obsError } = await query;
    if (obsError) {
      throw obsError;
    }

    const rows = observations || [];
    if (rows.length === 0) {
      return new Response(
        JSON.stringify({ inspected: 0, updated: 0, compliant: 0, non_compliant: 0, skipped_no_matrix: 0, apply }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const uniquePlates = [...new Set(rows.map((r: any) => r.plate_number).filter(Boolean))];
    const { data: homelessRows } = uniquePlates.length > 0
      ? await supabaseAdmin
          .from('canonical_vehicles')
          .select('plate_number, homeless_status')
          .in('plate_number', uniquePlates)
      : { data: [] as any[] };

    const homelessMap = new Map((homelessRows || []).map((r: any) => [r.plate_number, r.homeless_status]));

    const zoneFallbackCache = new Map<string, MatrixRules | null>();
    const matrixCache = new Map<string, MatrixRules | null>();

    const changes: any[] = [];
    let updated = 0;
    let compliant = 0;
    let nonCompliant = 0;
    let skippedNoMatrix = 0;

    for (const obs of rows) {
      const observationId = (obs as any).observation_id ?? (obs as any).id;
      const keyColumn = (obs as any).observation_id ? 'observation_id' : 'id';
      const matrixKey = `${obs.zone_id}:${obs.recorded_at}`;

      let matrix = matrixCache.get(matrixKey) ?? null;
      if (!matrixCache.has(matrixKey)) {
        const { data: foundMatrix } = await supabaseAdmin
          .from('zone_compliance_matrix')
          .select('self_contained_required, requires_csc, nights_per_month, max_consecutive_nights, day_visit_only, homeless_exemption')
          .eq('zone_id', obs.zone_id)
          .lte('effective_from', obs.recorded_at)
          .or(`effective_to.is.null,effective_to.gte.${obs.recorded_at}`)
          .order('version', { ascending: false })
          .limit(1)
          .maybeSingle();

        matrix = foundMatrix as MatrixRules | null;
        matrixCache.set(matrixKey, matrix);
      }

      if (!matrix) {
        if (!zoneFallbackCache.has(obs.zone_id)) {
          const { data: zoneRules } = await supabaseAdmin
            .from('zones')
            .select('self_contained_required, nights_per_month, max_consecutive_nights, day_visit_only')
            .eq('id', obs.zone_id)
            .maybeSingle();

          if (zoneRules) {
            zoneFallbackCache.set(obs.zone_id, {
              self_contained_required: zoneRules.self_contained_required,
              requires_csc: zoneRules.self_contained_required,
              nights_per_month: zoneRules.nights_per_month,
              max_consecutive_nights: zoneRules.max_consecutive_nights,
              day_visit_only: zoneRules.day_visit_only,
              homeless_exemption: true,
            });
          } else {
            zoneFallbackCache.set(obs.zone_id, null);
          }
        }

        matrix = zoneFallbackCache.get(obs.zone_id) ?? null;
      }

      if (!matrix) {
        skippedNoMatrix++;
        continue;
      }

      const isHomeless = homelessMap.get(obs.plate_number) === 'confirmed';
      const evaluated = evaluateCompliance(obs, matrix, isHomeless);

      if (evaluated.isCompliant) compliant++;
      else nonCompliant++;

      const changed =
        obs.is_compliant !== evaluated.isCompliant ||
        (obs.breach_type || null) !== (evaluated.breachType || null) ||
        (obs.breach_reason || null) !== (evaluated.breachReason || null);

      if (!changed) {
        continue;
      }

      changes.push({
        observation_id: observationId,
        previous: {
          is_compliant: obs.is_compliant,
          breach_type: obs.breach_type,
          breach_reason: obs.breach_reason,
        },
        next: {
          is_compliant: evaluated.isCompliant,
          breach_type: evaluated.breachType,
          breach_reason: evaluated.breachReason,
        },
      });

      if (apply) {
        const { error: updateError } = await supabaseAdmin
          .from('observations')
          .update({
            is_compliant: evaluated.isCompliant,
            breach_type: evaluated.breachType,
            breach_reason: evaluated.breachReason,
          })
          .eq(keyColumn, observationId);

        if (updateError) {
          throw updateError;
        }
      }

      updated++;
    }

    return new Response(
      JSON.stringify({
        inspected: rows.length,
        updated,
        compliant,
        non_compliant: nonCompliant,
        skipped_no_matrix: skippedNoMatrix,
        apply,
        changes_preview: changes.slice(0, 100),
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error?.message || 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
