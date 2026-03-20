/**
 * COMPREHENSIVE CLEANUP AND RECALCULATION - BATCH PROCESSOR
 * 
 * Performs four operations in sequence on batches of observations:
 * 1. Zone Correction (GPS-based)
 * 2. Duplicate Detection (same zone, NZ patrol windows, <=50m GPS)
 * 3. Vehicle Details Refresh (sync make/model/year/colour/SCV from canonical_vehicles)
 * 4. Compliance Recalculation (current rules, uses refreshed vehicle data)
 * 
 * Frontend handles pagination and progress tracking
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';
import { nzHour, toValidBreachType } from '../_shared/compliance.ts';

type OvernightVerificationMode = 'two_photo_verification' | 'one_photo_per_day_inference';
type CleanupPhase = 'all' | 'zone' | 'dedup' | 'compliance';
const EMBEDDING_MATCH_THRESHOLD = 0.86;
const RECHECK_NZSCV_ON_FALSE_OR_EXPIRED = (Deno.env.get('RECHECK_NZSCV_ON_FALSE_OR_EXPIRED') ?? '1') !== '0';
const NZSCV_PROXY_URL = Deno.env.get('NZSCV_PROXY_URL') ?? '';
const NZSCV_PROXY_SECRET = Deno.env.get('NZSCV_PROXY_SECRET') ?? '';
const NZSCV_RECHECK_TIMEOUT_MS = Number(Deno.env.get('NZSCV_RECHECK_TIMEOUT_MS') ?? '3000');

const DUPLICATE_DISTANCE_METERS = 50;

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function extractBearerToken(req: Request): string | null {
  const candidates = [
    req.headers.get('Authorization'),
    req.headers.get('authorization'),
    req.headers.get('x-authorization'),
    req.headers.get('x-forwarded-authorization'),
    req.headers.get('x-supabase-authorization'),
  ];

  for (const value of candidates) {
    if (!value) continue;
    const match = value.match(/^Bearer\s+(.+)$/i);
    if (match?.[1]) return match[1].trim();
  }

  return null;
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

function hasStableLocationEvidence(current: any, previous: any): boolean {
  const lat1 = Number(current.gps_latitude);
  const lng1 = Number(current.gps_longitude);
  const lat2 = Number(previous.gps_latitude);
  const lng2 = Number(previous.gps_longitude);

  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return true;
  return calculateDistance(lat1, lng1, lat2, lng2) <= DUPLICATE_DISTANCE_METERS;
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

function duplicateWindow(value: string): 'evening' | 'morning' | null {
  const h = nzHour(value);
  if (h >= 16 && h < 24) return 'evening';
  if (h >= 0 && h < 10) return 'morning';
  return null;
}

function isDuplicateByRule(current: any, previous: any): boolean {
  if (current.zone_id !== previous.zone_id) return false;

  const currentWindow = duplicateWindow(current.recorded_at);
  const previousWindow = duplicateWindow(previous.recorded_at);
  if (!currentWindow || currentWindow !== previousWindow) return false;
  if (nzDateKey(current.recorded_at) !== nzDateKey(previous.recorded_at)) return false;

  const lat1 = Number(current.gps_latitude);
  const lng1 = Number(current.gps_longitude);
  const lat2 = Number(previous.gps_latitude);
  const lng2 = Number(previous.gps_longitude);
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return false;

  return calculateDistance(lat1, lng1, lat2, lng2) <= DUPLICATE_DISTANCE_METERS;
}

function normalizePlateKey(value?: string | null): string {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

function toEpoch(value?: string | null): number | null {
  if (!value) return null;
  const ts = new Date(value).getTime();
  return Number.isNaN(ts) ? null : ts;
}

function parseExpiryToEpoch(expiry?: string | null): number | null {
  if (!expiry) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(expiry)
    ? `${expiry}T23:59:59Z`
    : expiry;
  return toEpoch(normalized);
}

function isExpiredAt(expiry: string | null | undefined, referenceIso: string): boolean {
  const expiryTs = parseExpiryToEpoch(expiry);
  const refTs = toEpoch(referenceIso);
  if (expiryTs === null || refTs === null) return false;
  return expiryTs < refTs;
}

async function recheckNzscvSelfContained(
  plateNumber: string,
  supabaseAdmin?: ReturnType<typeof createClient>,
): Promise<{ isSelfContained: boolean; expiryDate: string | null } | null> {
  if (!RECHECK_NZSCV_ON_FALSE_OR_EXPIRED) return null;

  const normalizedPlate = String(plateNumber ?? '').trim().toUpperCase();

  // ── Check canonical_scv (authoritative SCV registry) ─────────────────
  if (supabaseAdmin) {
    try {
      const { data: scvRow } = await (supabaseAdmin.from('canonical_scv') as any)
        .select('is_self_contained, certificate_expiry')
        .eq('plate_number', normalizedPlate)
        .maybeSingle();

      if (scvRow && scvRow.is_self_contained === true) {
        const expiry = scvRow.certificate_expiry ?? null;
        const isExpired = expiry != null && isExpiredAt(expiry, new Date().toISOString());
        if (!isExpired) {
          console.log('✅ SCV recheck: canonical_scv says is_self_contained=true', { plate: normalizedPlate, expiry });
          return { isSelfContained: true, expiryDate: expiry };
        }
      }
    } catch (scvErr: any) {
      console.warn('⚠️ canonical_scv recheck failed:', scvErr?.message);
    }
  }

  // ── Fall back to NZSCV API ────────────────────────────────────────────
  // NOTE: NZSCV API may be on a test endpoint — results may be inaccurate.
  if (!NZSCV_PROXY_URL) return null;

  try {
    const response = await fetch(`${NZSCV_PROXY_URL}/api/nzscv/vehicle-info`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Proxy-Secret': NZSCV_PROXY_SECRET,
      },
      body: JSON.stringify({
        RegistrationNumber: normalizedPlate,
      }),
      signal: AbortSignal.timeout(NZSCV_RECHECK_TIMEOUT_MS),
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    const vr = payload?.VehicleRegistration;
    const status = vr?.CertificateStatus ?? null;
    const expiry = vr?.CertificateExpiryDate ?? null;

    const byStatus = status === 'Current' || status === 'Issued';
    const byExpiry = expiry != null && !isExpiredAt(expiry, new Date().toISOString());
    return {
      isSelfContained: Boolean(byStatus || (!status && byExpiry)),
      expiryDate: expiry,
    };
  } catch {
    return null;
  }
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
): Promise<{
  byOrgPlate: Map<string, string>;
  byPlate: Map<string, string>;
  selfContainedByPlate: Map<string, boolean | null>;
  selfContainedExpiryByPlate: Map<string, string | null>;
  vehicleMakeByPlate: Map<string, string | null>;
  vehicleModelByPlate: Map<string, string | null>;
  vehicleYearByPlate: Map<string, number | null>;
  vehicleColorByPlate: Map<string, string | null>;
}> {
  const plateKeys = [...new Set(
    observations
      .map((o: any) => normalizePlateKey(o.plate_number))
      .filter(Boolean),
  )];
  const orgIds = [...new Set(observations.map((o: any) => o.organization_id).filter(Boolean))];

  // ── Org-scoped homeless records (for per-org exemption checks) ──────────
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

  // ── Plate-level canonical data ──────────────────────────────────────────
  const byPlate = new Map<string, string>();
  const selfContainedByPlate = new Map<string, boolean | null>();
  const selfContainedExpiryByPlate = new Map<string, string | null>();
  const vehicleMakeByPlate = new Map<string, string | null>();
  const vehicleModelByPlate = new Map<string, string | null>();
  const vehicleYearByPlate = new Map<string, number | null>();
  const vehicleColorByPlate = new Map<string, string | null>();

  if (plateKeys.length > 0) {
    // Load vehicle attributes (make/model/year/colour) from canonical_vehicles
    const { data: canonicalRows } = await supabaseAdmin
      .from('canonical_vehicles')
      .select('plate_number, vehicle_make, vehicle_model, vehicle_year, vehicle_color')
      .in('plate_number', plateKeys);

    for (const row of canonicalRows ?? []) {
      const plateKey = normalizePlateKey((row as any).plate_number);
      // Vehicle detail fields only — SCV and homeless come from dedicated tables
      vehicleMakeByPlate.set(plateKey, (row as any).vehicle_make ?? null);
      vehicleModelByPlate.set(plateKey, (row as any).vehicle_model ?? null);
      const rawYear = (row as any).vehicle_year;
      vehicleYearByPlate.set(plateKey, rawYear != null ? Number(rawYear) : null);
      vehicleColorByPlate.set(plateKey, (row as any).vehicle_color ?? null);
    }

    // ── SCV status exclusively from canonical_scv ─────────────────────────
    try {
      const { data: scvRows } = await (supabaseAdmin.from('canonical_scv') as any)
        .select('plate_number, is_self_contained, certificate_expiry')
        .in('plate_number', plateKeys);

      for (const row of scvRows ?? []) {
        const plateKey = normalizePlateKey(row.plate_number);
        selfContainedByPlate.set(plateKey, row.is_self_contained ?? null);
        if (row.certificate_expiry != null) {
          selfContainedExpiryByPlate.set(plateKey, row.certificate_expiry);
        }
      }
    } catch (scvErr: any) {
      console.warn('⚠️ canonical_scv query failed:', scvErr?.message);
    }

    // ── Homeless status exclusively from canonical_homeless ───────────────
    try {
      const { data: homelessCanonRows } = await (supabaseAdmin.from('canonical_homeless') as any)
        .select('plate_number, status')
        .in('plate_number', plateKeys);

      for (const row of homelessCanonRows ?? []) {
        const plateKey = normalizePlateKey(row.plate_number);
        if (row.status && row.status !== 'none') {
          byPlate.set(plateKey, row.status);
        }
      }
    } catch (homelessErr: any) {
      console.warn('⚠️ canonical_homeless query failed:', homelessErr?.message);
    }
  }

  return {
    byOrgPlate: new Map<string, string>(
      [...byOrgPlate.entries()].map(([key, value]) => [key, value.status]),
    ),
    byPlate,
    selfContainedByPlate,
    selfContainedExpiryByPlate,
    vehicleMakeByPlate,
    vehicleModelByPlate,
    vehicleYearByPlate,
    vehicleColorByPlate,
  };
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  try {
    // Auth guard (manual because verify_jwt is disabled for this function to
    // avoid gateway false-401 before execution).
    const jwt = extractBearerToken(req);
    if (!jwt) {
      return new Response(
        JSON.stringify({ error: 'Missing Authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let authUserId: string | null = null;
    const jwtPayload = decodeJwtPayload(jwt);
    if (typeof jwtPayload?.sub === 'string' && jwtPayload.sub.length > 0) {
      authUserId = jwtPayload.sub;
    }

    if (!authUserId) {
      const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(jwt);
      if (!authError && authData?.user?.id) {
        authUserId = authData.user.id;
      }
    }

    if (!authUserId) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('role')
      .eq('id', authUserId)
      .single();

    if (profileError || !profile || !['admin', 'master'].includes(String((profile as any).role))) {
      return new Response(
        JSON.stringify({ error: 'Admin or master role required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const {
      zoneIds,
      zone_ids,
      dateRangeStart,
      date_range_start,
      dateRangeEnd,
      date_range_end,
      offset = 0,
      batch_size = 50,
      get_total = false,
      phase = 'all',
    } = await req.json();

    const normalizedZoneIds = Array.isArray(zoneIds)
      ? zoneIds
      : Array.isArray(zone_ids)
      ? zone_ids
      : [];
    const normalizedDateStart = dateRangeStart ?? date_range_start ?? null;
    const normalizedDateEnd = dateRangeEnd ?? date_range_end ?? null;
    const normalizedPhase: CleanupPhase =
      phase === 'zone' || phase === 'dedup' || phase === 'compliance' || phase === 'all'
        ? phase
        : 'all';

    console.log('🔧 Cleanup Request:', {
      zoneIds: normalizedZoneIds,
      dateRangeStart: normalizedDateStart,
      dateRangeEnd: normalizedDateEnd,
      phase: normalizedPhase,
      offset,
      batch_size,
      get_total,
    });

    // Build base query
    let query = supabaseAdmin
      .from('observations')
      .select('*', { count: 'exact' });

    // Apply filters
    if (normalizedZoneIds && normalizedZoneIds.length > 0) {
      query = query.in('zone_id', normalizedZoneIds);
    }
    if (normalizedDateStart) {
      query = query.gte('recorded_at', normalizedDateStart);
    }
    if (normalizedDateEnd) {
      query = query.lte('recorded_at', normalizedDateEnd);
    }

    // If just getting total, return count
    if (get_total) {
      const { count, error: countError } = await query;
      if (countError) throw countError;
      
      console.log(`📊 Total observations: ${count}`);
      return new Response(
        JSON.stringify({ total: count || 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get batch
    query = query.range(offset, offset + batch_size - 1);

    if (normalizedPhase === 'dedup') {
      // Dedup works best when like plates are adjacent.
      query = query
        .order('plate_number', { ascending: true })
        .order('recorded_at', { ascending: true });
    } else {
      query = query.order('recorded_at', { ascending: false });
    }
    
    const { data: observations, error: obsError } = await query;
    if (obsError) throw obsError;

    if (!observations || observations.length === 0) {
      console.log('⚠️ No observations in this batch');
      return new Response(
        JSON.stringify({ 
          processed: 0, 
          zonesCorrected: 0, 
          duplicatesRemoved: 0,
          vehicleDetailsRefreshed: 0,
          complianceChanged: 0,
          breachesCreated: 0,
          skippedNoMatrix: 0
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`📦 Processing ${observations.length} observations...`);

    // PHASE 1: ZONE CORRECTION
    let zonesCorrected = 0;

    let zones: any[] = [];
    if (normalizedPhase === 'all' || normalizedPhase === 'zone') {
      // Load all zones for GPS matching (include parent_zone_id & zone_type for child-zone prioritisation)
      const { data: zonesData, error: zoneError } = await supabaseAdmin
        .from('zones')
        .select('id, name, organization_id, geometry, location_lat, location_lng, parent_zone_id, zone_type, radius_meters')
        .eq('is_active', true);

      if (zoneError) throw zoneError;
      zones = zonesData || [];
      console.log(`📍 Loaded ${zones.length || 0} active zones for GPS matching`);
    }

    let observationKeyColumn: 'id' | 'observation_id' = observations.some((obs: any) => obs.observation_id != null)
      ? 'observation_id'
      : 'id';

    if (normalizedPhase === 'all' || normalizedPhase === 'zone') {
      for (const obs of observations) {
        const obsId = (obs as any).observation_id ?? (obs as any).id;
        if ((obs as any).observation_id) observationKeyColumn = 'observation_id';
        if (obs.gps_latitude && obs.gps_longitude && obs.gps_accuracy < 100) {
          const correctZone = findZoneByGPS(
            obs.gps_latitude,
            obs.gps_longitude,
            zones,
            obs.organization_id
          );

          if (correctZone && correctZone.id !== obs.zone_id) {
            const { error: updateError } = await supabaseAdmin
              .from('observations')
              .update({ zone_id: correctZone.id })
              .eq(observationKeyColumn, obsId);

            if (!updateError) {
              // Keep in-memory record aligned for subsequent phases in this same invocation.
              obs.zone_id = correctZone.id;
              zonesCorrected++;
              console.log(`✅ Zone corrected: ${obs.plate_number} → ${correctZone.name}`);
            }
          }
        }
      }
    }

    // PHASE 2: DUPLICATE DETECTION
    let duplicatesRemoved = 0;
    const duplicatesToDelete: string[] = [];
    if (normalizedPhase === 'all' || normalizedPhase === 'dedup') {
      const plateGroups = new Map<string, typeof observations>();
      for (const obs of observations) {
        const existing = plateGroups.get(obs.plate_number) || [];
        existing.push(obs);
        plateGroups.set(obs.plate_number, existing);
      }

      for (const [plateNumber, plateObs] of plateGroups.entries()) {
        if (plateObs.length <= 1) continue;

        // Sort by recorded_at ascending (oldest first)
        plateObs.sort((a, b) => 
          new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
        );

        // Keep first (oldest), check others
        for (let i = 1; i < plateObs.length; i++) {
          const current = plateObs[i];
          
          for (let j = 0; j < i; j++) {
            const previous = plateObs[j];
            
            if (isDuplicateByRule(current, previous)) {
              const currentId = (current as any).observation_id ?? (current as any).id;
              if (!duplicatesToDelete.includes(currentId)) {
                duplicatesToDelete.push(currentId);
                console.log(`🗑️ Duplicate: ${plateNumber} (same zone window + <=${DUPLICATE_DISTANCE_METERS}m)`);
              }
              break;
            }
          }
        }
      }

      if (duplicatesToDelete.length > 0) {
        const { error: deleteError } = await supabaseAdmin
          .from('observations')
          .delete()
          .in(observationKeyColumn, duplicatesToDelete);

        if (!deleteError) {
          duplicatesRemoved = duplicatesToDelete.length;
        }
      }
    }

    // PHASE 2b: BREACH ALERT DEDUPLICATION
    // Remove duplicate breach_alerts for the same observation_id, keeping only the
    // most recently created alert per observation. This prevents inflated breach counts.
    let breachDuplicatesRemoved = 0;
    if (normalizedPhase === 'all' || normalizedPhase === 'dedup') {
      const activeObsIds = observations
        .filter(obs => !duplicatesToDelete.includes((obs as any).observation_id ?? (obs as any).id))
        .map((obs: any) => obs.observation_id ?? obs.id)
        .filter(Boolean);

      if (activeObsIds.length > 0) {
        // Fetch all active breach alerts for observations in this batch
        const { data: breachRows } = await supabaseAdmin
          .from('breach_alerts')
          .select('id, observation_id, created_at')
          .in('observation_id', activeObsIds)
          .in('status', ['pending', 'acknowledged', 'enforcement_started'])
          .order('created_at', { ascending: false });

        if (breachRows && breachRows.length > 0) {
          // Group by observation_id, keep the newest, mark older ones for deletion
          const seenObsIds = new Set<string>();
          const dupBreachIds: string[] = [];

          for (const row of breachRows as any[]) {
            if (!row.observation_id) continue;
            if (seenObsIds.has(row.observation_id)) {
              dupBreachIds.push(row.id);
            } else {
              seenObsIds.add(row.observation_id);
            }
          }

          if (dupBreachIds.length > 0) {
            const { error: breachDelError } = await supabaseAdmin
              .from('breach_alerts')
              .delete()
              .in('id', dupBreachIds);

            if (!breachDelError) {
              breachDuplicatesRemoved = dupBreachIds.length;
              console.log(`🗑️ Removed ${dupBreachIds.length} duplicate breach alerts`);
            } else {
              console.warn('⚠️ Failed to remove duplicate breach alerts:', breachDelError.message);
            }
          }
        }
      }
    }

    // PHASE 3: COMPLIANCE RECALCULATION
    // compliance_results and vehicle_monthly_stays are no longer part of the pipeline
    // (dropped in 20260221_rebuild_observations_clean.sql).
    // Compliance state lives directly on observations: is_compliant, breach_type, breach_reason.
    let complianceChanged = 0;
    let breachesCreated = 0;
    let skippedNoMatrix = 0;

    if (normalizedPhase !== 'all' && normalizedPhase !== 'compliance') {
      return new Response(
        JSON.stringify({
          processed: observations.length,
          zonesCorrected,
          duplicatesRemoved,
          breachDuplicatesRemoved,
          vehicleDetailsRefreshed: 0,
          complianceChanged,
          breachesCreated,
          skippedNoMatrix,
          phase: normalizedPhase,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Filter out soft-deleted / duplicate observations
    const activeObservations = observations.filter(
      obs => !duplicatesToDelete.includes((obs as any).observation_id ?? (obs as any).id)
    );

    // Remove stale legacy compliance rows if table still exists in this DB.
    let hasComplianceResults = false;
    const { data: complianceTables, error: infoSchemaError } = await supabaseAdmin
      .schema('information_schema')
      .from('tables')
      .select('table_name')
      .eq('table_schema', 'public')
      .eq('table_name', 'compliance_results')
      .limit(1);
    if (!infoSchemaError && (complianceTables?.length ?? 0) > 0) {
      hasComplianceResults = true;
    }

    if (hasComplianceResults) {
      const activeObservationIds = activeObservations
        .map((obs: any) => obs.observation_id ?? obs.id)
        .filter(Boolean);

      if (activeObservationIds.length > 0) {
        const { error: legacyDeleteError } = await supabaseAdmin
          .from('compliance_results')
          .delete()
          .in('observation_id', activeObservationIds);

        if (legacyDeleteError) {
          console.warn('⚠️ Failed to remove stale compliance_results rows:', legacyDeleteError.message);
        }
      }
    }

    const orgIds = [...new Set(activeObservations.map((o: any) => o.organization_id).filter(Boolean))];
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
    for (const row of activeObservations) {
      const key = `${row.organization_id}:${row.zone_id}:${row.plate_number}`;
      const bucket = observationsByPlateZone.get(key) ?? [];
      bucket.push(row);
      observationsByPlateZone.set(key, bucket);
    }
    for (const [, bucket] of observationsByPlateZone) {
      bucket.sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());
    }

    console.log(`⚖️ Starting compliance recalculation for ${activeObservations.length} observations...`);

    // Pre-load zone matrices (cache to avoid per-row queries)
    const zoneMatrices = new Map<string, any>();
    const zonesWithoutMatrix = new Set<string>();

    const {
      byOrgPlate: homelessStatusByOrgPlate,
      byPlate: homelessStatusByPlate,
      selfContainedByPlate,
      selfContainedExpiryByPlate,
      vehicleMakeByPlate,
      vehicleModelByPlate,
      vehicleYearByPlate,
      vehicleColorByPlate,
    } =
      await buildHomelessStatusMaps(supabaseAdmin, activeObservations as any[]);

    // PHASE 3a: VEHICLE DETAILS REFRESH
    // Sync vehicle_make, vehicle_model, vehicle_year, vehicle_color, and self_contained
    // from canonical_vehicles onto each observation before compliance recalculation.
    // This ensures observation records reflect the latest canonical vehicle data.
    let vehicleDetailsRefreshed = 0;
    for (const obs of activeObservations) {
      try {
        const obsId = (obs as any).observation_id ?? (obs as any).id;
        const plateKey = normalizePlateKey(obs.plate_number);
        if (!plateKey) continue;

        const canonicalMake = vehicleMakeByPlate.get(plateKey);
        const canonicalModel = vehicleModelByPlate.get(plateKey);
        const canonicalYear = vehicleYearByPlate.get(plateKey);
        const canonicalColor = vehicleColorByPlate.get(plateKey);
        const canonicalSC = selfContainedByPlate.get(plateKey);

        // Only include fields where canonical has a value and it differs from the observation
        const patch: Record<string, unknown> = {};
        if (canonicalMake != null && canonicalMake !== (obs.vehicle_make ?? null)) {
          patch.vehicle_make = canonicalMake;
        }
        if (canonicalModel != null && canonicalModel !== (obs.vehicle_model ?? null)) {
          patch.vehicle_model = canonicalModel;
        }
        if (canonicalYear != null && canonicalYear !== (obs.vehicle_year ?? null)) {
          patch.vehicle_year = canonicalYear;
        }
        if (canonicalColor != null && canonicalColor !== (obs.vehicle_color ?? null)) {
          patch.vehicle_color = canonicalColor;
        }
        if (canonicalSC != null && Boolean(canonicalSC) !== Boolean(obs.self_contained)) {
          patch.self_contained = canonicalSC;
        }

        if (Object.keys(patch).length > 0) {
          const { error: patchError } = await supabaseAdmin
            .from('observations')
            .update(patch)
            .eq(observationKeyColumn, obsId);

          if (!patchError) {
            // Keep in-memory record aligned for subsequent compliance evaluation
            Object.assign(obs, patch);
            vehicleDetailsRefreshed++;
          } else {
            console.warn(`⚠️ Failed to refresh vehicle details for ${obsId}:`, patchError.message);
          }
        }
      } catch (err: any) {
        console.error(`❌ Vehicle details refresh error for ${(obs as any).observation_id ?? (obs as any).id}:`, err.message);
      }
    }

    if (vehicleDetailsRefreshed > 0) {
      console.log(`🚗 Refreshed vehicle details on ${vehicleDetailsRefreshed} observations from canonical_vehicles`);
    }

    const nzscvRecheckCache = new Map<string, { isSelfContained: boolean; expiryDate: string | null } | null>();

    for (const obs of activeObservations) {
      try {
        const obsId = (obs as any).observation_id ?? (obs as any).id;
        if ((obs as any).observation_id) observationKeyColumn = 'observation_id';
        // Get or cache matrix for this zone
        let matrix = zoneMatrices.get(obs.zone_id);
        if (!matrix && !zonesWithoutMatrix.has(obs.zone_id)) {
          const { data: found } = await supabaseAdmin
            .from('zone_compliance_matrix')
            .select('*')
            .eq('zone_id', obs.zone_id)
            .is('effective_to', null)
            .order('version', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (found) {
            zoneMatrices.set(obs.zone_id, found);
            matrix = found;
          } else {
            // Fallback: zone table
            const { data: zone } = await supabaseAdmin
              .from('zones')
              .select('self_contained_required, nights_per_month, max_consecutive_nights, day_visit_only, homeless_exemption')
              .eq('id', obs.zone_id)
              .maybeSingle();
            if (zone) {
              const fallback = { ...zone, requires_csc: zone.self_contained_required };
              zoneMatrices.set(obs.zone_id, fallback);
              matrix = fallback;
            } else {
              zonesWithoutMatrix.add(obs.zone_id);
            }
          }
        }

        if (!matrix) {
          skippedNoMatrix++;
          continue;
        }

        const plateKey = normalizePlateKey(obs.plate_number);
        const homelessCategory = normalizeHomelessCategory(
          homelessStatusByOrgPlate.get(`${obs.organization_id}:${plateKey}`)
            ?? homelessStatusByPlate.get(plateKey),
        );
        const isHomelessExempt = homelessCategory === 'confirmed' || homelessCategory === 'claimed';
        const overnightMode = overnightModeByOrg.get(String(obs.organization_id)) ?? 'two_photo_verification';
        const wasCompliant = obs.is_compliant ?? true;

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

        let isCompliant = true;
        let breachType: string | null = null;
        let breachReason: string | null = null;

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
            if (!isHomelessExempt) {
              const overnightEvidenceOk = overnightMode === 'two_photo_verification'
                ? hasTwoPhotoOvernightEvidence
                : hasInferenceOvernightEvidence;

              if (!overnightEvidenceOk) {
                isCompliant = true;
              } else {
                isCompliant  = false;
                breachType   = 'monthly_limit';
                breachReason = `Exceeded monthly stay limit: ${obs.nights_stayed_this_month} nights, limit ${matrix.nights_per_month}`;
              }
            }
          }
        }
        // Consecutive nights
        if (isCompliant && matrix.max_consecutive_nights != null) {
          if ((obs.consecutive_nights ?? 0) > matrix.max_consecutive_nights) {
            if (!isHomelessExempt) {
              const overnightEvidenceOk = overnightMode === 'two_photo_verification'
                ? hasTwoPhotoOvernightEvidence
                : hasInferenceOvernightEvidence;

              if (!overnightEvidenceOk) {
                isCompliant = true;
              } else {
                isCompliant  = false;
                breachType   = 'consecutive_nights';
                breachReason = `Exceeded consecutive nights limit: ${obs.consecutive_nights} nights, limit ${matrix.max_consecutive_nights}`;
              }
            }
          }
        }
        // Self-contained
        if (isCompliant && (matrix.self_contained_required || matrix.requires_csc)) {
          const hasCanonicalSelfContained = selfContainedByPlate.has(plateKey);
          const canonicalSelfContained = selfContainedByPlate.get(plateKey);
          const canonicalExpiry = selfContainedExpiryByPlate.get(plateKey) ?? null;

          let isSelfContained = hasCanonicalSelfContained && canonicalSelfContained !== null
            ? Boolean(canonicalSelfContained)
            : Boolean(obs.self_contained);

          const canonicalLooksStale = hasCanonicalSelfContained
            && (canonicalSelfContained === false || isExpiredAt(canonicalExpiry, obs.recorded_at));

          if (!isHomelessExempt && canonicalLooksStale && plateKey) {
            if (!nzscvRecheckCache.has(plateKey)) {
              nzscvRecheckCache.set(plateKey, await recheckNzscvSelfContained(obs.plate_number, supabaseAdmin));
            }

            const refreshed = nzscvRecheckCache.get(plateKey);
            if (refreshed?.isSelfContained) {
              isSelfContained = true;
              selfContainedByPlate.set(plateKey, true);
              if (refreshed.expiryDate) {
                selfContainedExpiryByPlate.set(plateKey, refreshed.expiryDate);
              }
            }
          }

          if (!isSelfContained) {
            if (!isHomelessExempt) {
              isCompliant  = false;
              breachType   = 'self_contained';
              breachReason = 'Zone requires a self-contained vehicle; no valid CSC on record';
            }
          }
        }

        const hasCanonicalSelfContained = selfContainedByPlate.has(plateKey);
        const canonicalSelfContained = selfContainedByPlate.get(plateKey);
        const shouldSyncSelfContained = hasCanonicalSelfContained
          && canonicalSelfContained !== null
          && Boolean(obs.self_contained) !== Boolean(canonicalSelfContained);

        // Update observation
        await supabaseAdmin
          .from('observations')
          .update({
            is_compliant:  isCompliant,
            breach_type:   breachType,
            breach_reason: breachReason,
            ...(shouldSyncSelfContained
              ? { self_contained: Boolean(canonicalSelfContained) }
              : {}),
          })
          .eq(observationKeyColumn, obsId);

        if (wasCompliant !== isCompliant) complianceChanged++;

        if (!isCompliant && breachType) {
          const alertType = toValidBreachType(breachType);

          let existing: { id: string; status: string | null } | null = null;

          const { data: existingByObservation } = await supabaseAdmin
            .from('breach_alerts')
            .select('id, status')
            .eq('observation_id', obsId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (existingByObservation) {
            existing = existingByObservation as { id: string; status: string | null };
          } else {
            const { data: existingByDetails } = await supabaseAdmin
              .from('breach_alerts')
              .select('id, status')
              .eq('organization_id', obs.organization_id)
              .eq('zone_id', obs.zone_id)
              .contains('breach_details', { observation_id: obsId })
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();

            if (existingByDetails) {
              existing = existingByDetails as { id: string; status: string | null };
            }
          }

          if (existing) {
            const { error: amendError } = await supabaseAdmin
              .from('breach_alerts')
              .update({
                organization_id: obs.organization_id,
                zone_id: obs.zone_id,
                plate_number: obs.plate_number,
                observation_id: obsId,
                breach_type: alertType,
                breach_details: {
                  observation_id: obsId,
                  breach_reason: breachReason,
                  recalculated: true,
                },
                created_at: obs.recorded_at,
              })
              .eq('id', existing.id);

            if (amendError) {
              console.warn(`⚠️ Failed to amend breach ${existing.id}:`, amendError.message);
            }
          } else {
            await supabaseAdmin.from('breach_alerts').insert({
              organization_id: obs.organization_id,
              zone_id:         obs.zone_id,
              plate_number:    obs.plate_number,
              breach_type:     alertType,
              observation_id:  obsId,
              breach_details:  { observation_id: obsId, breach_reason: breachReason },
              created_at:      obs.recorded_at,
              status:          'pending',
            });
            breachesCreated++;
          }
        } else if (isCompliant) {
          // Observation is compliant after recalculation: dismiss unresolved alerts linked to it.
          const resolutionNote = 'Auto-dismissed by cleanup recalculation (observation now compliant).';
          const nowIso = new Date().toISOString();

          await supabaseAdmin
            .from('breach_alerts')
            .update({
              status: 'dismissed',
              resolved_at: nowIso,
              resolution_notes: resolutionNote,
            })
            .eq('observation_id', obsId)
            .in('status', ['pending', 'acknowledged', 'enforcement_started']);

          await supabaseAdmin
            .from('breach_alerts')
            .update({
              status: 'dismissed',
              resolved_at: nowIso,
              resolution_notes: resolutionNote,
            })
            .eq('organization_id', obs.organization_id)
            .eq('zone_id', obs.zone_id)
            .contains('breach_details', { observation_id: obsId })
            .in('status', ['pending', 'acknowledged', 'enforcement_started']);
        }

      } catch (err: any) {
        console.error(`❌ Error processing ${(obs as any).observation_id ?? (obs as any).id}:`, err.message);
      }
    }

    console.log(`✅ Batch complete: ${observations.length} processed, ${zonesCorrected} zones corrected, ${duplicatesRemoved} duplicates removed, ${breachDuplicatesRemoved} breach duplicates removed, ${vehicleDetailsRefreshed} vehicle details refreshed, ${complianceChanged} compliance changed, ${breachesCreated} breaches`);

    return new Response(
      JSON.stringify({
        processed: observations.length,
        zonesCorrected,
        duplicatesRemoved,
        breachDuplicatesRemoved,
        vehicleDetailsRefreshed,
        complianceChanged,
        breachesCreated,
        skippedNoMatrix,
        phase: normalizedPhase,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ Cleanup failed:', error);
    let msg: string = error?.message ?? '';
    // Detect HTML error pages or whitespace-only messages from gateway/proxy errors
    if (!msg || !msg.trim() || /^\s*<[!a-z]/i.test(msg.trim())) {
      msg = `Cleanup batch processing failed (${error?.name ?? 'Error'}). This may be a transient database or gateway error — please retry.`;
    }
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

/**
 * Find zone by GPS coordinates
 * When multiple zones match, the most specific zone wins:
 *   - Child zones (have parent_zone_id) before parent/jurisdiction zones
 *   - Non-general zone_type before general
 *   - Smaller radius before larger
 */
function findZoneByGPS(lat: number, lng: number, zones: any[], organizationId: string): any | null {
  const orgZones = zones.filter(z => z.organization_id === organizationId);

  // Collect ALL matching zones so we can pick the most specific one
  const matches: Array<{ zone: any; distance: number }> = [];
  const matchedIds = new Set<string>();

  for (const zone of orgZones) {
    if (zone.geometry && zone.geometry.type === 'Polygon' &&
        Array.isArray(zone.geometry.coordinates?.[0]) && zone.geometry.coordinates[0].length > 0) {
      const coordinates = zone.geometry.coordinates[0];
      if (isPointInPolygon(lat, lng, coordinates)) {
        const dist = (zone.location_lat && zone.location_lng)
          ? calculateDistance(lat, lng, zone.location_lat, zone.location_lng)
          : 0;
        matches.push({ zone, distance: dist });
        matchedIds.add(zone.id);
      }
    }
    
    if (zone.location_lat && zone.location_lng) {
      const distance = calculateDistance(lat, lng, zone.location_lat, zone.location_lng);
      if (distance <= 100 && !matchedIds.has(zone.id)) {
        matches.push({ zone, distance });
        matchedIds.add(zone.id);
      }
    }
  }

  if (matches.length === 0) return null;

  // Sort so the most *specific* zone appears first:
  //  1. Child zones (have parent_zone_id) before parent/jurisdiction zones
  //  2. Non-general zone_type before general
  //  3. Smaller radius before larger
  //  4. Closer distance to centre as tie-breaker
  matches.sort((a, b) => {
    const aIsChild = a.zone.parent_zone_id ? 0 : 1;
    const bIsChild = b.zone.parent_zone_id ? 0 : 1;
    if (aIsChild !== bIsChild) return aIsChild - bIsChild;

    const aIsGeneral = a.zone.zone_type === 'general' ? 1 : 0;
    const bIsGeneral = b.zone.zone_type === 'general' ? 1 : 0;
    if (aIsGeneral !== bIsGeneral) return aIsGeneral - bIsGeneral;

    const aRadius = a.zone.radius_meters || 500;
    const bRadius = b.zone.radius_meters || 500;
    if (aRadius !== bRadius) return aRadius - bRadius;

    return a.distance - b.distance;
  });

  return matches[0].zone;
}

function isPointInPolygon(lat: number, lng: number, polygon: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];
    
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    
    if (intersect) inside = !inside;
  }
  return inside;
}

function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}
