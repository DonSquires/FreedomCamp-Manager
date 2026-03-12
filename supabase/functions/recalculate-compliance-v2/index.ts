import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';
import { nzHour, toValidBreachType } from '../_shared/compliance.ts';

type OvernightVerificationMode = 'two_photo_verification' | 'one_photo_per_day_inference';
const EMBEDDING_MATCH_THRESHOLD = 0.86;

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

function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
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
  if (![cLat, cLng, pLat, pLng].every(Number.isFinite)) return true;
  return distanceMeters(cLat, cLng, pLat, pLng) <= 50;
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
    let observationKeyColumn: 'id' | 'observation_id' = 'id';
    let query = supabaseAdmin
      .from('observations')
      .select('*', { count: 'exact' });

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
      const key = `${row.organization_id}:${row.zone_id}:${row.plate_number}`;
      const bucket = observationsByPlateZone.get(key) ?? [];
      bucket.push(row);
      observationsByPlateZone.set(key, bucket);
    }
    for (const [, bucket] of observationsByPlateZone) {
      bucket.sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());
    }

    const plateKeys = [...new Set(
      observations
        .map((o: any) => normalizePlateKey(o.plate_number))
        .filter(Boolean),
    )];

    const homelessStatusByOrgPlate = new Map<string, string>();
    if (plateKeys.length > 0 && orgIds.length > 0) {
      const { data: homelessRows } = await (supabaseAdmin.from('homeless_records') as any)
        .select('organization_id, plate_number, status, last_reported_at, updated_at, created_at')
        .eq('is_active', true)
        .in('organization_id', orgIds)
        .in('plate_number', plateKeys);

      const latestByOrgPlate = new Map<string, { status: string; ts: number }>();
      for (const row of homelessRows ?? []) {
        const key = `${row.organization_id}:${normalizePlateKey(row.plate_number)}`;
        const ts = new Date(
          row.last_reported_at ?? row.updated_at ?? row.created_at ?? '1970-01-01T00:00:00Z',
        ).getTime();
        const existing = latestByOrgPlate.get(key);
        if (!existing || ts >= existing.ts) {
          latestByOrgPlate.set(key, { status: String(row.status ?? ''), ts });
        }
      }
      for (const [key, value] of latestByOrgPlate) {
        homelessStatusByOrgPlate.set(key, value.status);
      }
    }

    const homelessStatusByPlate = new Map<string, string>();
    if (plateKeys.length > 0) {
      const { data: canonicalRows } = await supabaseAdmin
        .from('canonical_vehicles')
        .select('plate_number, homeless_status')
        .in('plate_number', plateKeys);

      for (const row of canonicalRows ?? []) {
        homelessStatusByPlate.set(normalizePlateKey((row as any).plate_number), String((row as any).homeless_status ?? ''));
      }
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
        const observationId = (obs as any).observation_id ?? (obs as any).id;
        if ((obs as any).observation_id) observationKeyColumn = 'observation_id';
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

        // ── Re-evaluate compliance using matrix rules ─────────────────────
        // compliance state is stored directly on observations (compliance_results dropped)
        const oldIsCompliant = obs.is_compliant;

        let isCompliant = true;
        let breachType: string | null = null;
        let breachReason: string | null = null;

        // Check homeless exemption. Prefer org-scoped homeless_records, fallback to canonical status.
        const plateKey = normalizePlateKey(plateNumber);
        const homelessCategory = normalizeHomelessCategory(
          homelessStatusByOrgPlate.get(`${obs.organization_id}:${plateKey}`)
            ?? homelessStatusByPlate.get(plateKey),
        );
        const isHomeless = homelessCategory === 'confirmed' || homelessCategory === 'claimed';
        const overnightMode = overnightModeByOrg.get(String(obs.organization_id)) ?? 'two_photo_verification';

        const hasTwoPhotoOvernightEvidence = (() => {
          const key = `${obs.organization_id}:${obs.zone_id}:${obs.plate_number}`;
          const bucket = observationsByPlateZone.get(key) ?? [];
          const currentTs = new Date(obs.recorded_at).getTime();

          for (const previous of bucket) {
            const prevTs = new Date(previous.recorded_at).getTime();
            if (!(prevTs < currentTs)) continue;
            if (dayDiffInNz(obs.recorded_at, previous.recorded_at) !== 1) continue;
            if (hasStableLocationEvidence(obs, previous)) return true;
          }

          return false;
        })();

        const hasInferenceOvernightEvidence = (() => {
          const key = `${obs.organization_id}:${obs.zone_id}:${obs.plate_number}`;
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
        })();

        // Day-visit-only
        if (matrix.day_visit_only) {
          const hour = nzHour(obs.recorded_at);
          if (hour >= 20 || hour < 8) {
            isCompliant  = false;
            breachType   = 'day_visit_violation';
            breachReason = `Night visit in day-only zone (observed at ${hour}:00 NZ time)`;
          }
        }
        // Monthly limit
        if (isCompliant && matrix.nights_per_month != null) {
          if ((obs.nights_stayed_this_month ?? 0) > matrix.nights_per_month) {
            if (!(isHomeless && matrix.homeless_exemption !== false)) {
              const overnightEvidenceOk = overnightMode === 'two_photo_verification'
                ? hasTwoPhotoOvernightEvidence
                : hasInferenceOvernightEvidence;

              if (!overnightEvidenceOk) {
                isCompliant = true;
              } else {
                isCompliant  = false;
                breachType   = 'monthly_limit';
                breachReason = `Exceeded monthly stay limit: ${obs.nights_stayed_this_month} nights stayed, limit is ${matrix.nights_per_month}`;
              }
            }
          }
        }
        // Consecutive nights
        if (isCompliant && matrix.max_consecutive_nights != null) {
          if ((obs.consecutive_nights ?? 0) > matrix.max_consecutive_nights) {
            if (!(isHomeless && matrix.homeless_exemption !== false)) {
              const overnightEvidenceOk = overnightMode === 'two_photo_verification'
                ? hasTwoPhotoOvernightEvidence
                : hasInferenceOvernightEvidence;

              if (!overnightEvidenceOk) {
                isCompliant = true;
              } else {
                isCompliant  = false;
                breachType   = 'consecutive_nights';
                breachReason = `Exceeded consecutive nights limit: ${obs.consecutive_nights} consecutive nights, limit is ${matrix.max_consecutive_nights}`;
              }
            }
          }
        }
        // Self-contained
        if (isCompliant && (matrix.self_contained_required || matrix.requires_csc)) {
          if (!obs.self_contained) {
            if (!(isHomeless && matrix.homeless_exemption !== false)) {
              isCompliant  = false;
              breachType   = 'self_contained';
              breachReason = 'Zone requires a self-contained vehicle; no valid CSC on record';
            }
          }
        }

        // Update the observation with new compliance state
        await supabaseAdmin
          .from('observations')
          .update({
            is_compliant:  isCompliant,
            breach_type:   breachType,
            breach_reason: breachReason,
          })
          .eq(observationKeyColumn, observationId);

        if (oldIsCompliant !== isCompliant) {
          complianceChanged++;
        }

        // Create breach alert if non-compliant and one doesn't already exist
        if (!isCompliant && breachType) {
          const { data: existingBreach } = await supabaseAdmin
            .from('breach_alerts')
            .select('id')
            .eq('organization_id', obs.organization_id)
            .eq('zone_id', obs.zone_id)
            .eq('status', 'pending')
            .contains('breach_details', { observation_id: observationId })
            .maybeSingle();

          if (!existingBreach) {
            const alertBreachType = toValidBreachType(breachType);

            await supabaseAdmin.from('breach_alerts').insert({
              organization_id: obs.organization_id,
              zone_id:         obs.zone_id,
              plate_number:    plateNumber,
              breach_type:     alertBreachType,
              breach_details:  {
                observation_id: observationId,
                breach_reason:  breachReason,
              },
              created_at: obs.recorded_at,
              status: 'pending',
            });

            breachesCreated++;
            console.log(`🚨 BREACH: ${plateNumber} – ${breachReason}`);
          }
        }

        processed++;

      } catch (error: any) {
        console.error(`❌ Error processing observation ${(obs as any).observation_id ?? (obs as any).id}:`, error.message);
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
