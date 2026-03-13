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

type OvernightVerificationMode = 'two_photo_verification' | 'one_photo_per_day_inference';
const EMBEDDING_MATCH_THRESHOLD = 0.86;

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

function nzDateKey(value: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}

function dayDiffInNz(aIso: string, bIso: string): number {
  const a = new Date(`${nzDateKey(aIso)}T00:00:00Z`).getTime();
  const b = new Date(`${nzDateKey(bIso)}T00:00:00Z`).getTime();
  return Math.round((a - b) / (24 * 60 * 60 * 1000));
}

function calculateDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371e3;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dPhi = ((lat2 - lat1) * Math.PI) / 180;
  const dLambda = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dPhi / 2) * Math.sin(dPhi / 2)
    + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) * Math.sin(dLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function hasStableLocationEvidence(current: any, previous: any): boolean {
  const cLat = Number(current.gps_latitude);
  const cLng = Number(current.gps_longitude);
  const pLat = Number(previous.gps_latitude);
  const pLng = Number(previous.gps_longitude);

  // If GPS is missing for either row, keep zone/date photo-pair as sufficient evidence.
  if (![cLat, cLng, pLat, pLng].every(Number.isFinite)) return true;

  return calculateDistanceMeters(cLat, cLng, pLat, pLng) <= 50;
}

function readEmbeddingVector(row: any): number[] | null {
  const raw = row?.vehicle_embedding ?? row?.embedding;
  if (!raw) return null;

  let parsed = raw;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }

  if (!Array.isArray(parsed) || parsed.length === 0) return null;

  const nums = parsed.map((v: unknown) => Number(v));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  return nums;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA <= 0 || normB <= 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function toEpoch(value?: string | null): number | null {
  if (!value) return null;
  const ts = new Date(value).getTime();
  return Number.isNaN(ts) ? null : ts;
}

function normalizePlateKey(value?: string | null): string {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

function normalizeHomelessCategory(status?: string | null): 'confirmed' | 'claimed' | 'declined' | 'freedom_camper' {
  const s = String(status ?? '').toLowerCase();
  if (s === 'confirmed') return 'confirmed';
  if (s === 'claimed') return 'claimed';
  if (s === 'declined') return 'declined';
  return 'freedom_camper';
}

async function buildHomelessStatusMaps(
  supabaseAdmin: ReturnType<typeof createClient>,
  observations: any[],
): Promise<{ byOrgPlate: Map<string, string>; byPlate: Map<string, string> }> {
  const plateKeys = [...new Set(
    observations
      .map((o: any) => normalizePlateKey(o.plate_number))
      .filter(Boolean),
  )];
  const orgIds = [...new Set(observations.map((o: any) => o.organization_id).filter(Boolean))];

  const byOrgPlate = new Map<string, { status: string; ts: number }>();

  if (plateKeys.length > 0 && orgIds.length > 0) {
    const { data: homelessRows } = await (supabaseAdmin.from('homeless_records') as any)
      .select('organization_id, plate_number, status, last_reported_at, updated_at, created_at')
      .eq('is_active', true)
      .in('organization_id', orgIds)
      .in('plate_number', plateKeys);

    for (const row of homelessRows ?? []) {
      const key = `${row.organization_id}:${normalizePlateKey(row.plate_number)}`;
      const ts = new Date(
        row.last_reported_at ?? row.updated_at ?? row.created_at ?? '1970-01-01T00:00:00Z',
      ).getTime();
      const existing = byOrgPlate.get(key);
      if (!existing || ts >= existing.ts) {
        byOrgPlate.set(key, { status: String(row.status ?? ''), ts });
      }
    }
  }

  const byPlate = new Map<string, string>();
  if (plateKeys.length > 0) {
    const { data: canonicalRows } = await supabaseAdmin
      .from('canonical_vehicles')
      .select('plate_number, homeless_status')
      .in('plate_number', plateKeys);

    for (const row of canonicalRows ?? []) {
      byPlate.set(normalizePlateKey((row as any).plate_number), String((row as any).homeless_status ?? ''));
    }
  }

  return {
    byOrgPlate: new Map<string, string>(
      [...byOrgPlate.entries()].map(([key, value]) => [key, value.status]),
    ),
    byPlate,
  };
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
    const hasVehicleEmbeddingColumn = await detectObservationColumn(supabaseAdmin, 'vehicle_embedding');
    const hasEmbeddingColumn = await detectObservationColumn(supabaseAdmin, 'embedding');

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
      'gps_latitude',
      'gps_longitude',
      ...(hasVehicleEmbeddingColumn ? ['vehicle_embedding'] : []),
      ...(hasEmbeddingColumn ? ['embedding'] : []),
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

    const { byOrgPlate: homelessStatusByOrgPlate, byPlate: homelessStatusByPlate } =
      await buildHomelessStatusMaps(supabaseAdmin, observations as any[]);

    const orgIds = [...new Set(observations.map((o: any) => o.organization_id).filter(Boolean))];
    const { data: orgRows } = await supabaseAdmin
      .from('organizations')
      .select('id, overnight_verification_mode')
      .in('id', orgIds);

    const overnightModeByOrg = new Map<string, OvernightVerificationMode>(
      (orgRows ?? []).map((o: any) => [
        String(o.id),
        (o.overnight_verification_mode === 'one_photo_per_day_inference'
          ? 'one_photo_per_day_inference'
          : 'two_photo_verification') as OvernightVerificationMode,
      ]),
    );

    const observationsByPlateZone = new Map<string, any[]>();
    for (const row of observations) {
      const key = `${row.organization_id}:${row.zone_id}:${normalizePlateKey(row.plate_number)}`;
      const bucket = observationsByPlateZone.get(key) ?? [];
      bucket.push(row);
      observationsByPlateZone.set(key, bucket);
    }

    // ── Overnight evidence context window ───────────────────────────────────
    // When processing a paginated batch, the "previous day" observation needed
    // for overnight evidence detection may be in an earlier batch.  To fix
    // this we load up to 2 days of look-back observations (for the same zones)
    // and merge them into the evidence buckets before evaluating any
    // overnight-dependent rule.
    if (zoneIdList.length > 0) {
      const earliestTs = Math.min(
        ...(observations as any[]).map((o: any) => new Date(o.recorded_at).getTime()),
      );
      const contextWindowStart = new Date(earliestTs - 2 * 24 * 60 * 60 * 1000).toISOString();
      // Exclusive upper bound: stop just before the earliest observation in the
      // current batch to avoid including records that are already present.
      const contextWindowEnd = new Date(earliestTs).toISOString();

      const contextSelectFields = [
        keyCol,
        'zone_id',
        'organization_id',
        'plate_number',
        'recorded_at',
        'gps_latitude',
        'gps_longitude',
        ...(hasVehicleEmbeddingColumn ? ['vehicle_embedding'] : []),
        ...(hasEmbeddingColumn ? ['embedding'] : []),
      ].join(', ');

      let ctxQuery = supabaseAdmin
        .from('observations')
        .select(contextSelectFields)
        .gte('recorded_at', contextWindowStart)
        .lt('recorded_at', contextWindowEnd)
        .not('plate_number', 'is', null)
        .in('zone_id', zoneIdList);

      if (scopedOrgId) ctxQuery = ctxQuery.eq('organization_id', scopedOrgId);

      const { data: contextObs } = await ctxQuery
        .order('recorded_at', { ascending: true })
        .limit(2000);

      // Build a set of observation IDs already in the batch to avoid duplicates
      const batchIds = new Set(
        (observations as any[]).map((o: any) => String((o as any)[keyCol])),
      );

      for (const row of contextObs ?? []) {
        const key = `${row.organization_id}:${row.zone_id}:${normalizePlateKey(row.plate_number)}`;
        if (!observationsByPlateZone.has(key)) continue; // Only need context for plates in batch
        if (batchIds.has(String((row as any)[keyCol]))) continue; // Skip if already in batch
        const bucket = observationsByPlateZone.get(key) ?? [];
        bucket.push(row);
        observationsByPlateZone.set(key, bucket);
      }
    }

    for (const [, bucket] of observationsByPlateZone) {
      bucket.sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());
    }

    const hasTwoPhotoOvernightEvidence = (obs: any): boolean => {
      const key = `${obs.organization_id}:${obs.zone_id}:${normalizePlateKey(obs.plate_number)}`;
      const bucket = observationsByPlateZone.get(key) ?? [];
      const currentTs = new Date(obs.recorded_at).getTime();

      for (const previous of bucket) {
        const prevTs = new Date(previous.recorded_at).getTime();
        if (!(prevTs < currentTs)) continue;
        if (dayDiffInNz(obs.recorded_at, previous.recorded_at) !== 1) continue;
        if (hasStableLocationEvidence(obs, previous)) return true;
      }

      return false;
    };

    const hasInferenceOvernightEvidence = (obs: any): boolean => {
      const key = `${obs.organization_id}:${obs.zone_id}:${normalizePlateKey(obs.plate_number)}`;
      const bucket = observationsByPlateZone.get(key) ?? [];
      const currentTs = new Date(obs.recorded_at).getTime();
      const currentEmbedding = readEmbeddingVector(obs);
      if (!currentEmbedding) return false;

      for (const previous of bucket) {
        const prevTs = new Date(previous.recorded_at).getTime();
        if (!(prevTs < currentTs)) continue;
        if (dayDiffInNz(obs.recorded_at, previous.recorded_at) !== 1) continue;
        if (!hasStableLocationEvidence(obs, previous)) continue;

        const previousEmbedding = readEmbeddingVector(previous);
        if (!previousEmbedding || previousEmbedding.length !== currentEmbedding.length) continue;

        if (cosineSimilarity(currentEmbedding, previousEmbedding) >= EMBEDDING_MATCH_THRESHOLD) {
          return true;
        }
      }

      return false;
    };

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
    let breachesDismissed = 0;
    let skippedNoRules = 0;

    for (const obs of observations) {
      const rules = getRulesForObservation(obs);
      if (!rules) {
        skippedNoRules++;
        processed++;
        continue;
      }

      const plateKey = normalizePlateKey(obs.plate_number);
      const homelessCategory = normalizeHomelessCategory(
        homelessStatusByOrgPlate.get(`${obs.organization_id}:${plateKey}`)
          ?? homelessStatusByPlate.get(plateKey),
      );
      // Four-category model: confirmed / claimed / declined / freedom_camper.
      // confirmed + claimed are exempt-eligible. declined and freedom_camper are non-exempt.
      const isHomelessExempt = homelessCategory === 'confirmed' || homelessCategory === 'claimed';
      const overnightMode = overnightModeByOrg.get(String(obs.organization_id)) ?? 'two_photo_verification';

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
          const overnightEvidenceOk = overnightMode === 'two_photo_verification'
            ? hasTwoPhotoOvernightEvidence(obs)
            : hasInferenceOvernightEvidence(obs);

          if (!overnightEvidenceOk) {
            isCompliant = true;
            breachType = null;
            breachReason = null;
          } else {
            isCompliant = false;
            breachType = 'monthly_limit';
            breachReason = `Exceeded monthly stay limit: ${nightsStayed} > ${rules.nights_per_month}`;
          }
        }
      }

      if (isCompliant && rules.max_consecutive_nights != null) {
        const consecutive = hasConsecutiveNightsColumn ? (obs.consecutive_nights ?? 0) : 0;
        const exempt = isHomelessExempt && rules.homeless_exemption !== false;
        if (consecutive > rules.max_consecutive_nights && !exempt) {
          const overnightEvidenceOk = overnightMode === 'two_photo_verification'
            ? hasTwoPhotoOvernightEvidence(obs)
            : hasInferenceOvernightEvidence(obs);

          if (!overnightEvidenceOk) {
            isCompliant = true;
            breachType = null;
            breachReason = null;
          } else {
            isCompliant = false;
            breachType = 'consecutive_nights';
            breachReason = `Exceeded consecutive nights limit: ${consecutive} > ${rules.max_consecutive_nights}`;
          }
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

        // Keep compliance_results in sync: update the pre-existing row if it
        // exists (do not create a new one here — that is the trigger's job).
        const { error: crError } = await supabaseAdmin
          .from('compliance_results')
          .update({
            is_compliant: isCompliant,
            violation_type: breachType,
            violation_reasons: isCompliant ? [] : (breachType ? [breachType] : []),
            evaluated_at: new Date().toISOString(),
          })
          .eq('observation_id', (obs as any)[keyCol]);
        // A missing row or schema mismatch is non-critical; log only to aid
        // debugging without surfacing an error to the caller.
        if (crError) {
          console.warn(`compliance_results sync skipped for ${(obs as any)[keyCol]}:`, crError.message);
        }
      }

      if (changed) complianceChanged++;

      // When an observation becomes compliant, dismiss any pending/acknowledged breach alerts for it.
      if (apply && isCompliant && (obs.is_compliant === false || obs.is_compliant === null)) {
        const observationId = (obs as any)[keyCol];
        const { data: openAlerts } = await supabaseAdmin
          .from('breach_alerts')
          .select('id')
          .eq('organization_id', obs.organization_id)
          .eq('zone_id', obs.zone_id)
          .in('status', ['pending', 'acknowledged'])
          .or(`observation_id.eq.${observationId},breach_details->>observation_id.eq.${observationId}`);

        if (openAlerts && openAlerts.length > 0) {
          const alertIds = openAlerts.map((a: any) => a.id);
          const { error: dismissError } = await supabaseAdmin
            .from('breach_alerts')
            .update({
              status: 'dismissed',
              resolved_at: new Date().toISOString(),
              resolution_notes: 'Auto-dismissed: observation recalculated as compliant',
            })
            .in('id', alertIds);

          if (!dismissError) breachesDismissed += alertIds.length;
        }
      }

      if (apply && !isCompliant && breachType) {
        const observationId = (obs as any)[keyCol];
        const { data: existingBreach } = await supabaseAdmin
          .from('breach_alerts')
          .select('id')
          .eq('organization_id', obs.organization_id)
          .eq('zone_id', obs.zone_id)
          .in('status', ['pending', 'acknowledged'])
          .or(`observation_id.eq.${observationId},breach_details->>observation_id.eq.${observationId}`)
          .maybeSingle();

        if (!existingBreach) {
          const validBreachType = toValidBreachType(breachType);
          const { error: breachError } = await supabaseAdmin
            .from('breach_alerts')
            .insert({
              organization_id: obs.organization_id,
              zone_id: obs.zone_id,
              plate_number: obs.plate_number,
              observation_id: observationId,
              breach_type: validBreachType,
              breach_details: {
                observation_id: observationId,
                breach_reason: breachReason,
              },
              created_at: obs.recorded_at,
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
      breaches_dismissed: breachesDismissed,
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
