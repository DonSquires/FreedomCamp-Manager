import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { nzHour, toValidBreachType } from '../_shared/compliance.ts';

type RecalcRequest = {
  zone_id?: string;
  zone_ids?: string[];
  organization_id?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
  offset?: number;
  apply?: boolean;
  get_total?: boolean;
  strict_matrix?: boolean;
};

type RuleSet = {
  self_contained_required?: boolean | null;
  requires_csc?: boolean | null;
  nights_per_month?: number | null;
  max_consecutive_nights?: number | null;
  day_visit_only?: boolean | null;
  allowed_days?: string[] | null;
  homeless_exemption?: boolean | null;
};

type MatrixRuleSet = RuleSet & {
  effective_from?: string | null;
  effective_to?: string | null;
  version?: number | null;
};

function parseJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '='));
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function normalizeDateStart(raw?: string): string | null {
  if (!raw) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00Z` : raw;
}

function normalizeDateEnd(raw?: string): string | null {
  if (!raw) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T23:59:59Z` : raw;
}

function normalizeDayName(dateIso: string): string {
  const day = new Intl.DateTimeFormat('en-NZ', {
    timeZone: 'Pacific/Auckland',
    weekday: 'long',
  }).format(new Date(dateIso));
  return day.toLowerCase();
}

function toEpoch(value?: string | null): number | null {
  if (!value) return null;
  const ts = new Date(value).getTime();
  return Number.isNaN(ts) ? null : ts;
}

function normalizeHomelessCategory(status?: string | null): 'confirmed' | 'claimed' | 'declined' | 'freedom_camper' {
  const s = String(status ?? '').toLowerCase();
  if (s === 'confirmed') return 'confirmed';
  if (s === 'claimed') return 'claimed';
  if (s === 'declined') return 'declined';
  return 'freedom_camper';
}

async function detectObservationKeyColumn(
  supabaseAdmin: ReturnType<typeof createClient>,
): Promise<'observation_id' | 'id'> {
  const obsIdProbe = await supabaseAdmin.from('observations').select('observation_id').limit(1);
  if (!obsIdProbe.error) return 'observation_id';

  const idProbe = await supabaseAdmin.from('observations').select('id').limit(1);
  if (!idProbe.error) return 'id';

  throw new Error('observations key column not found (expected observation_id or id)');
}

async function detectObservationBreachReasonColumn(
  supabaseAdmin: ReturnType<typeof createClient>,
): Promise<boolean> {
  const probe = await supabaseAdmin.from('observations').select('breach_reason').limit(1);
  return !probe.error;
}

async function detectObservationColumn(
  supabaseAdmin: ReturnType<typeof createClient>,
  columnName: string,
): Promise<boolean> {
  const probe = await supabaseAdmin.from('observations').select(columnName).limit(1);
  return !probe.error;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json(401, { error: 'Missing authorization' });

    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) return json(401, { error: 'Missing bearer token' });

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    );

    const jwtPayload = parseJwtPayload(token);
    const isServiceRole = jwtPayload?.role === 'service_role';

    let profile: { role: string; organization_id?: string | null } | null = null;

    if (!isServiceRole) {
      const { data: userResp, error: userError } = await supabaseClient.auth.getUser(token);
      if (userError || !userResp?.user) {
        return json(401, { error: 'Unauthorized' });
      }

      const { data: userProfile, error: profileError } = await supabaseAdmin
        .from('user_profiles')
        .select('role, organization_id')
        .eq('id', userResp.user.id)
        .single();

      if (profileError || !userProfile) {
        return json(403, { error: 'Unable to resolve user role' });
      }

      if (!['admin', 'master', 'admin_officer'].includes(userProfile.role)) {
        return json(403, { error: 'Insufficient permissions' });
      }

      profile = userProfile;
    }

    const body = (await req.json()) as RecalcRequest;
    const apply = body.apply ?? true;
    const strictMatrix = body.strict_matrix ?? true;
    const limit = Math.max(1, Math.min(2000, body.limit ?? 200));
    const offset = Math.max(0, body.offset ?? 0);
    const keyCol = await detectObservationKeyColumn(supabaseAdmin);
    const hasBreachReasonColumn = await detectObservationBreachReasonColumn(supabaseAdmin);
    const hasNightsStayedColumn = await detectObservationColumn(supabaseAdmin, 'nights_stayed_this_month');
    const hasConsecutiveNightsColumn = await detectObservationColumn(supabaseAdmin, 'consecutive_nights');
    const hasSelfContainedColumn = await detectObservationColumn(supabaseAdmin, 'self_contained');

    const zoneIds = body.zone_ids?.length
      ? body.zone_ids
      : body.zone_id
        ? [body.zone_id]
        : [];

    const dateFrom = normalizeDateStart(body.date_from);
    const dateTo = normalizeDateEnd(body.date_to);

    const observationSelectFields = [
      keyCol,
      'zone_id',
      'organization_id',
      'plate_number',
      'recorded_at',
      'is_compliant',
      'breach_type',
      ...(hasBreachReasonColumn ? ['breach_reason'] : []),
      ...(hasNightsStayedColumn ? ['nights_stayed_this_month'] : []),
      ...(hasConsecutiveNightsColumn ? ['consecutive_nights'] : []),
      ...(hasSelfContainedColumn ? ['self_contained'] : []),
    ].join(', ');

    let query = supabaseAdmin
      .from('observations')
      .select(observationSelectFields, { count: 'exact' })
      .not('plate_number', 'is', null);

    if (zoneIds.length > 0) query = query.in('zone_id', zoneIds);

    const scopedOrgId = isServiceRole
      ? body.organization_id
      : profile?.role === 'master'
        ? body.organization_id
        : profile?.organization_id;

    if (scopedOrgId) query = query.eq('organization_id', scopedOrgId);
    if (dateFrom) query = query.gte('recorded_at', dateFrom);
    if (dateTo) query = query.lte('recorded_at', dateTo);

    if (body.get_total) {
      const { count, error } = await query.select(keyCol, { head: true, count: 'exact' });
      if (error) throw error;
      return json(200, { total: count ?? 0 });
    }

    const { data: observations, error: obsError } = await query
      .order('recorded_at', { ascending: true })
      .range(offset, offset + limit - 1);

    if (obsError) throw obsError;

    if (!observations || observations.length === 0) {
      return json(200, {
        processed: 0,
        compliance_changed: 0,
        breaches_created: 0,
        skipped_no_rules: 0,
        apply,
      });
    }

    const zoneIdList = [...new Set(observations.map((o: any) => o.zone_id).filter(Boolean))];

    const { data: matrices } = await supabaseAdmin
      .from('zone_compliance_matrix')
      .select('zone_id, version, self_contained_required, requires_csc, nights_per_month, max_consecutive_nights, day_visit_only, allowed_days, homeless_exemption, effective_from, effective_to')
      .in('zone_id', zoneIdList)
      .order('version', { ascending: false });

    const byZoneMatrices = new Map<string, MatrixRuleSet[]>();
    for (const m of matrices ?? []) {
      const current = byZoneMatrices.get(m.zone_id) ?? [];
      current.push(m);
      byZoneMatrices.set(m.zone_id, current);
    }

    const { data: zones } = await supabaseAdmin
      .from('zones')
      .select('id, self_contained_required, nights_per_month, max_consecutive_nights, day_visit_only, allowed_days')
      .in('id', zoneIdList);

    const fallbackZoneRules = new Map<string, RuleSet>();
    for (const z of zones ?? []) {
      fallbackZoneRules.set(z.id, {
        self_contained_required: z.self_contained_required,
        nights_per_month: z.nights_per_month,
        max_consecutive_nights: z.max_consecutive_nights,
        day_visit_only: z.day_visit_only,
        allowed_days: z.allowed_days,
        requires_csc: z.self_contained_required,
        homeless_exemption: true,
      });
    }

    const plates = [...new Set(observations.map((o: any) => o.plate_number).filter(Boolean))];
    const { data: homelessRows } = await supabaseAdmin
      .from('canonical_vehicles')
      .select('plate_number, homeless_status')
      .in('plate_number', plates);

    const homelessStatusByPlate = new Map<string, string>(
      (homelessRows ?? []).map((r: any) => [String(r.plate_number), String(r.homeless_status ?? '')]),
    );

    const getRulesForObservation = (obs: any): RuleSet | null => {
      const rules = byZoneMatrices.get(obs.zone_id) ?? [];
      const obsTs = toEpoch(obs.recorded_at);

      // Prefer matrix rows that are valid for the observation timestamp.
      const matched = rules
        .filter((candidate) => {
          if (obsTs === null) return false;
          const fromTs = toEpoch(candidate.effective_from);
          const toTs = toEpoch(candidate.effective_to);
          const afterStart = fromTs === null || obsTs >= fromTs;
          const beforeEnd = toTs === null || obsTs <= toTs;
          return afterStart && beforeEnd;
        })
        .sort((a, b) => {
          const aVer = a.version ?? 0;
          const bVer = b.version ?? 0;
          if (aVer !== bVer) return bVer - aVer;
          return (toEpoch(b.effective_from) ?? 0) - (toEpoch(a.effective_from) ?? 0);
        });

      if (matched.length > 0) return matched[0];

      // If strict mode is enabled, never silently fallback to zone defaults.
      if (strictMatrix) return null;

      return fallbackZoneRules.get(obs.zone_id) ?? null;
    };

    let processed = 0;
    let complianceChanged = 0;
    let breachesCreated = 0;
    let skippedNoRules = 0;

    for (const obs of observations) {
      const rules = getRulesForObservation(obs);
      if (!rules) {
        skippedNoRules++;
        processed++;
        continue;
      }

      const homelessCategory = normalizeHomelessCategory(homelessStatusByPlate.get(obs.plate_number));
      // Four-category model: confirmed / claimed / declined / freedom_camper.
      // confirmed + claimed are exempt-eligible. declined and freedom_camper are non-exempt.
      const isHomelessExempt = homelessCategory === 'confirmed' || homelessCategory === 'claimed';

      let isCompliant = true;
      let breachType: string | null = null;
      let breachReason: string | null = null;

      if (rules.day_visit_only) {
        const hour = nzHour(obs.recorded_at);
        if (hour >= 20 || hour < 8) {
          isCompliant = false;
          breachType = 'day_visit_violation';
          breachReason = `Night visit in day-only zone (observed at ${hour}:00 NZ time)`;
        }
      }

      if (isCompliant && rules.allowed_days && rules.allowed_days.length > 0) {
        const dayName = normalizeDayName(obs.recorded_at);
        const allowed = rules.allowed_days.map((d) => String(d).toLowerCase());
        if (!allowed.includes(dayName)) {
          isCompliant = false;
          breachType = 'allowed_days_violation';
          breachReason = `Visit occurred on ${dayName}, outside allowed days`;
        }
      }

      if (isCompliant && rules.nights_per_month != null) {
        const nightsStayed = hasNightsStayedColumn ? (obs.nights_stayed_this_month ?? 0) : 0;
        const exempt = isHomelessExempt && rules.homeless_exemption !== false;
        if (nightsStayed > rules.nights_per_month && !exempt) {
          isCompliant = false;
          breachType = 'monthly_limit';
          breachReason = `Exceeded monthly stay limit: ${nightsStayed} > ${rules.nights_per_month}`;
        }
      }

      if (isCompliant && rules.max_consecutive_nights != null) {
        const consecutive = hasConsecutiveNightsColumn ? (obs.consecutive_nights ?? 0) : 0;
        const exempt = isHomelessExempt && rules.homeless_exemption !== false;
        if (consecutive > rules.max_consecutive_nights && !exempt) {
          isCompliant = false;
          breachType = 'consecutive_nights';
          breachReason = `Exceeded consecutive nights limit: ${consecutive} > ${rules.max_consecutive_nights}`;
        }
      }

      if (isCompliant && (rules.self_contained_required || rules.requires_csc)) {
        const exempt = isHomelessExempt && rules.homeless_exemption !== false;
        const isSelfContained = hasSelfContainedColumn ? Boolean(obs.self_contained) : false;
        if (!isSelfContained && !exempt) {
          isCompliant = false;
          breachType = 'self_contained';
          breachReason = 'Zone requires self-contained certification';
        }
      }

      const previousReason = hasBreachReasonColumn ? (obs.breach_reason ?? null) : null;
      const changed = (obs.is_compliant ?? true) !== isCompliant
        || (obs.breach_type ?? null) !== breachType
        || (hasBreachReasonColumn && previousReason !== breachReason);

      if (apply && changed) {
        const updatePayload: Record<string, unknown> = {
          is_compliant: isCompliant,
          breach_type: breachType,
        };

        if (hasBreachReasonColumn) {
          updatePayload.breach_reason = breachReason;
        }

        const { error: updateError } = await supabaseAdmin
          .from('observations')
          .update(updatePayload)
          .eq(keyCol, (obs as any)[keyCol]);

        if (updateError) {
          console.error(`Failed to update observation ${(obs as any)[keyCol]}:`, updateError.message);
        }
      }

      if (changed) complianceChanged++;

      if (apply && !isCompliant && breachType) {
        const observationId = (obs as any)[keyCol];
        const { data: existingBreach } = await supabaseAdmin
          .from('breach_alerts')
          .select('id')
          .eq('organization_id', obs.organization_id)
          .eq('zone_id', obs.zone_id)
          .eq('status', 'pending')
          .contains('breach_details', { observation_id: observationId })
          .maybeSingle();

        if (!existingBreach) {
          const validBreachType = toValidBreachType(breachType);
          const { error: breachError } = await supabaseAdmin
            .from('breach_alerts')
            .insert({
              organization_id: obs.organization_id,
              zone_id: obs.zone_id,
              plate_number: obs.plate_number,
              breach_type: validBreachType,
              breach_details: {
                observation_id: observationId,
                breach_reason: breachReason,
              },
              status: 'pending',
            });

          if (!breachError) breachesCreated++;
        }
      }

      processed++;
    }

    return json(200, {
      processed,
      compliance_changed: complianceChanged,
      breaches_created: breachesCreated,
      skipped_no_rules: skippedNoRules,
      apply,
      strict_matrix: strictMatrix,
      key_column: keyCol,
    });
  } catch (error: any) {
    console.error('recalculate-compliance-v3 error:', error);
    return json(500, { error: error?.message ?? 'Unexpected error' });
  }
});
