// ============================================================================
// process-officer-scan — Background enrichment for officer vehicle scans
// ============================================================================
// Called fire-and-forget by FieldOfficerPortal after the initial fast save.
//
// Input (JSON):
//   { observation_id: UUID, photo_url: string, photo_hash?: string }
//
// Auth: Bearer JWT (officer / admin_officer / admin / master role)
//
// Pipeline:
//   1.  Validate auth + load observation (verify ownership)
//   2.  Download photo bytes from Supabase Storage
//   3.  Railway inference  → plate candidate + vehicle embedding
//   4.  ALPR backup (Plate Recognizer) if inference returns no plate
//   5.  NZSCV lookup  → self-contained certificate status + expiry date ONLY
//       (NZSCV does NOT return make/model/year — only plate + expiry date)
//   6.  Movement detection (cosine similarity vs prior observation embedding)
//   7.  Upsert canonical_vehicles with enriched data
//   8.  UPDATE observation: plate, embedding, SC status
//   9.  Inline compliance evaluation (zone-matrix rules)
//   10. UPDATE observation: is_compliant + breach fields
//   11. INSERT / UPDATE compliance_results row
//   12. INSERT breach_alert if non-compliant
//   13. Return enriched observation
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { corsHeaders } from '../_shared/cors.ts';
import { alprWithBytes } from '../_shared/alpr.ts';
import { nzHour, toValidBreachType } from '../_shared/compliance.ts';

// ─── Environment ────────────────────────────────────────────────────────────
const SUPABASE_URL             = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY        = Deno.env.get('SUPABASE_ANON_KEY')!;
const INFERENCE_SERVICE_URL    = Deno.env.get('INFERENCE_SERVICE_URL');
const INFERENCE_TIMEOUT_MS     = Number(Deno.env.get('INFERENCE_TIMEOUT_MS') ?? '7000');
const NZSCV_PROXY_URL          = Deno.env.get('NZSCV_PROXY_URL');
const NZSCV_PROXY_SECRET       = Deno.env.get('NZSCV_PROXY_SECRET') ?? '';

// Cosine similarity threshold below which we consider a vehicle to have moved.
// Embeddings from the same vehicle in the same parking spot score ~0.85–0.95.
// Embeddings from different vehicles, or a significantly repositioned vehicle,
// typically score below 0.70.  A similarity of exactly 0.70 or above means
// the vehicle has NOT moved; below 0.70 means it HAS moved (or is a different
// vehicle).  The 0.70–0.85 range is a grey zone where we conservatively treat
// the vehicle as stationary to avoid false-positive "moved" alerts.
const MOVEMENT_THRESHOLD = 0.70;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}

function normalizePlate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const n = String(raw).trim().toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9]/g, '');
  return n || null;
}

/** Cosine similarity between two equal-length vectors. Returns 0 on error. */
function cosineSimilarity(a: number[], b: number[]): number {
  if (!a?.length || a.length !== b?.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

/** Parse Supabase storage URL → { bucket, path } or null. */
function parseStorageLocation(raw: string): { bucket: string; path: string } | null {
  const input = String(raw || '').trim();
  if (!input) return null;
  if (/^https?:\/\//i.test(input)) {
    try {
      const url = new URL(input);
      const decoded = decodeURIComponent(url.pathname);
      const m = decoded.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/);
      if (!m) return null;
      return { bucket: m[1], path: m[2].replace(/^\/+/, '') };
    } catch { return null; }
  }
  const cleaned = input.replace(/^\/+/, '');
  const idx = cleaned.indexOf('/');
  if (idx <= 0) return null;
  return { bucket: cleaned.slice(0, idx), path: cleaned.slice(idx + 1) };
}

// ─── Step 2: Download photo ───────────────────────────────────────────────────
async function downloadPhoto(
  supabase: ReturnType<typeof createClient>,
  photoUrl: string,
): Promise<Uint8Array | null> {
  const loc = parseStorageLocation(photoUrl);
  if (loc) {
    const { data, error } = await supabase.storage.from(loc.bucket).download(loc.path);
    if (!error && data) return new Uint8Array(await data.arrayBuffer());
    console.warn('⚠️ Storage download failed, trying HTTP fetch:', error?.message);
  }
  try {
    const res = await fetch(photoUrl, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  } catch (err: any) {
    console.error('❌ Photo download failed:', err.message);
    return null;
  }
}

// ─── Step 3: Railway inference ───────────────────────────────────────────────
interface InferenceResult {
  plate: string | null;
  confidence: number | null;
  embedding: number[] | null;
  embeddingQuality: number | null;
  path: string;
}

async function callInference(imageBytes: Uint8Array): Promise<InferenceResult> {
  if (!INFERENCE_SERVICE_URL) {
    console.warn('⚠️ INFERENCE_SERVICE_URL not configured — skipping inference');
    return { plate: null, confidence: null, embedding: null, embeddingQuality: null, path: 'no_inference_url' };
  }
  try {
    const form = new FormData();
    form.append('photo', new Blob([imageBytes], { type: 'image/jpeg' }), 'photo.jpg');
    const res = await fetch(`${INFERENCE_SERVICE_URL}/infer`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(INFERENCE_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Inference ${res.status}`);
    const data = await res.json();
    const d = data?.data ?? data;
    return {
      plate: normalizePlate(d?.plate ?? null),
      confidence: d?.confidence ?? null,
      embedding: Array.isArray(d?.embedding) ? d.embedding : null,
      embeddingQuality: d?.embedding_quality ?? null,
      path: 'railway_inference',
    };
  } catch (err: any) {
    console.error('❌ Inference failed:', err.message);
    return { plate: null, confidence: null, embedding: null, embeddingQuality: null, path: 'inference_error' };
  }
}

// ─── Step 5: NZSCV lookup ────────────────────────────────────────────────────
// NZSCV (Self-Contained Vehicle Register) only returns:
//   - VehicleRegistration (plate number, echoed back)
//   - CertificateExpiryDate (when the SC certificate expires)
//   - CertificateStatus     (Current | Issued | Revoked | Expired) — may be absent
// It does NOT return make, model, year, colour, owner, VIN, or any other
// vehicle details. Those must come from Railway inference / AI or MotorWeb.
interface NZSCVResult {
  /** Whether the SC certificate is current (status = Current or Issued, or expiry is in the future) */
  isSelfContained: boolean;
  /** ISO date string of the SC certificate expiry, or null if not on register */
  selfContainedExpiry: string | null;
}

async function lookupNZSCV(plate: string): Promise<NZSCVResult | null> {
  if (!NZSCV_PROXY_URL) {
    console.warn('⚠️ NZSCV_PROXY_URL not configured — skipping NZSCV lookup');
    return null;
  }
  try {
    const res = await fetch(`${NZSCV_PROXY_URL}/api/nzscv/vehicle-info`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Proxy-Secret': NZSCV_PROXY_SECRET,
      },
      body: JSON.stringify({ RegistrationNumber: plate }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      // 404 = plate not on the NZSCV register → not self-contained
      if (res.status === 404) {
        return { isSelfContained: false, selfContainedExpiry: null };
      }
      console.warn(`⚠️ NZSCV returned ${res.status} for ${plate}`);
      return null;
    }
    const data = await res.json();

    // ── DEBUG: Log full raw NZSCV response to Supabase function logs ──────
    // This lets us see exactly what fields the API returns in production.
    // TODO: remove or gate behind DEBUG env var once field list is confirmed.
    console.log('🔍 NZSCV raw response (full):', JSON.stringify(data));
    if (data?.VehicleRegistration && typeof data.VehicleRegistration === 'object') {
      console.log('🔍 NZSCV VehicleRegistration keys:', Object.keys(data.VehicleRegistration));
    }

    // The raw NZSCV response nests the data under VehicleRegistration.
    // check-nzscv-status edge function wraps it under certification.
    // Handle both shapes defensively.
    const vr   = data?.VehicleRegistration ?? null;
    const cert = data?.certification ?? null;

    // Derive expiry: prefer direct NZSCV field, fall back to wrapped cert
    const expiry: string | null =
      vr?.CertificateExpiryDate ?? cert?.expiry_date ?? null;

    // Derive status: prefer direct NZSCV field, fall back to wrapped cert
    const status: string | null =
      vr?.CertificateStatus ?? cert?.status ?? null;

    // A vehicle is self-contained if:
    //  a) The register explicitly says Current or Issued, OR
    //  b) There is an expiry date and it is still in the future
    //     (some integrations only return expiry, not a status field)
    const isCurrentByStatus = status === 'Current' || status === 'Issued';
    const isCurrentByExpiry = expiry != null && new Date(expiry) > new Date();
    const isSelfContained = isCurrentByStatus || (!status && isCurrentByExpiry);

    return { isSelfContained, selfContainedExpiry: expiry };
  } catch (err: any) {
    console.error('❌ NZSCV lookup failed:', err.message);
    return null;
  }
}

// ─── Step 9: Inline compliance evaluation ────────────────────────────────────
interface ComplianceResult {
  isCompliant: boolean;
  breachType: string | null;
  breachReason: string | null;
  violationReasons: string[];
  nightsStayed: number;
  consecutiveNights: number;
}

async function evaluateCompliance(
  supabase: ReturnType<typeof createClient>,
  params: {
    zoneId: string;
    organizationId: string;
    plate: string;
    recordedAt: string;
    isSelfContained: boolean;
    isHomeless: boolean;
  },
): Promise<ComplianceResult> {
  const { zoneId, plate, recordedAt, isSelfContained, isHomeless } = params;

  // Load zone compliance matrix
  let matrix: any = null;
  try {
    const { data } = await supabase
      .from('zone_compliance_matrix')
      .select('*')
      .eq('zone_id', zoneId)
      .lte('effective_from', recordedAt)
      .or(`effective_to.is.null,effective_to.gt.${recordedAt}`)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    matrix = data;
  } catch { /* ignore */ }

  if (!matrix) {
    try {
      const { data } = await supabase
        .from('zones')
        .select('self_contained_required, nights_per_month, max_consecutive_nights, day_visit_only')
        .eq('id', zoneId)
        .maybeSingle();
      if (data) matrix = { ...data, homeless_exemption: true };
    } catch { /* ignore */ }
  }

  if (!matrix) {
    return { isCompliant: true, breachType: null, breachReason: null, violationReasons: [], nightsStayed: 0, consecutiveNights: 0 };
  }

  // Count nights for this vehicle in this zone
  let nightsStayed = 0;
  let consecutiveNights = 0;
  try {
    const monthStart = new Date(recordedAt);
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const { data: rows } = await supabase
      .from('observations')
      .select('recorded_at')
      .eq('plate_number', plate)
      .eq('zone_id', zoneId)
      .gte('recorded_at', monthStart.toISOString())
      .lt('recorded_at', recordedAt)
      .order('recorded_at', { ascending: false });

    if (rows?.length) {
      nightsStayed = rows.length;
      // Count consecutive days (simple: each observation = 1 unique calendar day)
      const days = new Set(rows.map((r: any) => r.recorded_at.slice(0, 10)));
      consecutiveNights = days.size;
    }
  } catch { /* ignore */ }

  const homelessExempt = isHomeless && (matrix.homeless_exemption !== false);
  const violations: string[] = [];
  let breachType: string | null = null;
  let breachReason: string | null = null;
  let isCompliant = true;

  // Rule 1: Day-visit-only zone
  if (matrix.day_visit_only) {
    const hour = nzHour(recordedAt);
    if (hour >= 20 || hour < 8) {
      isCompliant = false;
      breachType = 'day_visit_violation';
      breachReason = `Night visit in day-only zone (${hour}:00 NZ time)`;
      violations.push('day_visit_violation');
    }
  }

  // Rule 2: Monthly nights limit
  if (isCompliant && matrix.nights_per_month != null && !homelessExempt) {
    if (nightsStayed >= matrix.nights_per_month) {
      isCompliant = false;
      breachType = 'monthly_limit';
      breachReason = `Exceeded monthly stay: ${nightsStayed + 1} nights, limit ${matrix.nights_per_month}`;
      violations.push(`monthly_nights_exceeded_${nightsStayed + 1}_of_${matrix.nights_per_month}`);
    }
  }

  // Rule 3: Consecutive nights limit
  if (isCompliant && matrix.max_consecutive_nights != null && !homelessExempt) {
    if (consecutiveNights >= matrix.max_consecutive_nights) {
      isCompliant = false;
      breachType = 'consecutive_nights';
      breachReason = `Exceeded consecutive stay: ${consecutiveNights + 1} nights, limit ${matrix.max_consecutive_nights}`;
      violations.push(`consecutive_nights_exceeded_${consecutiveNights + 1}_of_${matrix.max_consecutive_nights}`);
    }
  }

  // Rule 4: Self-contained required
  if (isCompliant && matrix.self_contained_required && !isSelfContained && !homelessExempt) {
    isCompliant = false;
    breachType = 'self_contained';
    breachReason = 'Zone requires self-contained vehicle; no valid CSC on record';
    violations.push('not_self_contained');
  }

  return {
    isCompliant,
    breachType: breachType ? toValidBreachType(breachType) : null,
    breachReason,
    violationReasons: violations,
    nightsStayed,
    consecutiveNights,
  };
}

// ─── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    const jwt = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
    if (!jwt) return jsonResp({ error: 'Missing Authorization header' }, 401);

    const supabase    = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const authClient  = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: authData, error: authError } = await authClient.auth.getUser(jwt);
    if (authError || !authData?.user) return jsonResp({ error: 'Unauthorized' }, 401);

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('id, role, organization_id')
      .eq('id', authData.user.id)
      .maybeSingle();

    if (!profile) return jsonResp({ error: 'User profile not found' }, 403);

    // ── Parse input ─────────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const observationId: string | null = body.observation_id ?? null;
    const photoUrl:       string | null = body.photo_url ?? null;

    if (!observationId) return jsonResp({ error: 'observation_id is required' }, 400);
    if (!photoUrl)       return jsonResp({ error: 'photo_url is required' }, 400);

    console.log('🔍 process-officer-scan started', { observationId, officerId: profile.id });

    // ── Step 1: Load observation ────────────────────────────────────────────
    const { data: obs, error: obsLoadError } = await supabase
      .from('observations')
      .select('observation_id, organization_id, zone_id, recorded_at, recorded_by, plate_number, is_compliant')
      .eq('observation_id', observationId)
      .maybeSingle();

    if (obsLoadError || !obs) {
      console.error('❌ Observation not found:', obsLoadError?.message);
      return jsonResp({ error: 'Observation not found' }, 404);
    }

    // Verify officer owns this observation (master role can process any)
    if (profile.role !== 'master' && obs.recorded_by !== profile.id) {
      return jsonResp({ error: 'Forbidden: observation belongs to another officer' }, 403);
    }

    const zoneId         = obs.zone_id as string;
    const organizationId = obs.organization_id as string;
    const recordedAt     = obs.recorded_at as string;

    // ── Step 2: Download photo ─────────────────────────────────────────────
    const imageBytes = await downloadPhoto(supabase, photoUrl);
    if (!imageBytes) {
      console.error('❌ Could not download photo, aborting enrichment');
      return jsonResp({ error: 'Failed to download photo' }, 500);
    }
    console.log(`📸 Photo loaded (${imageBytes.length} bytes)`);

    // ── Step 3: Railway inference ─────────────────────────────────────────
    const inference = await callInference(imageBytes);
    console.log('🚂 Inference result:', {
      plate: inference.plate,
      confidence: inference.confidence,
      hasEmbedding: !!inference.embedding,
      path: inference.path,
    });

    // ── Step 4: ALPR backup ───────────────────────────────────────────────
    let finalPlate = inference.plate;
    let finalConfidence = inference.confidence;

    if (!finalPlate) {
      console.log('🔄 No plate from inference — running ALPR backup...');
      try {
        const alprResult = await alprWithBytes(imageBytes);
        if (alprResult.plate) {
          finalPlate = normalizePlate(alprResult.plate);
          finalConfidence = alprResult.confidence;
          console.log('✅ ALPR backup found plate:', finalPlate);
        } else {
          console.warn('⚠️ ALPR backup returned no plate');
        }
      } catch (alprErr: any) {
        console.warn('⚠️ ALPR backup failed:', alprErr.message);
      }
    }

    const plate = finalPlate ?? null;
    const requiresManualEntry = !plate;

    // ── Step 5: NZSCV lookup ──────────────────────────────────────────────
    // NZSCV only returns self-contained certificate status + expiry date.
    // It does NOT return make, model, year, or other vehicle details.
    let nzscv: NZSCVResult | null = null;
    if (plate) {
      console.log(`🔍 NZSCV lookup for plate: ${plate}`);
      nzscv = await lookupNZSCV(plate);
      if (nzscv) {
        console.log('✅ NZSCV result:', {
          isSelfContained: nzscv.isSelfContained,
          expiry:          nzscv.selfContainedExpiry,
        });
      } else {
        console.warn('⚠️ NZSCV returned no data for', plate);
      }
    }

    // ── Step 6: Movement detection ────────────────────────────────────────
    let vehicleMoved: boolean | null = null;
    let isNewVehicle = false;

    if (plate && inference.embedding) {
      try {
        const { data: priorObs } = await supabase
          .from('observations')
          .select('observation_id, vehicle_embedding, recorded_at')
          .eq('plate_number', plate)
          .eq('zone_id', zoneId)
          .not('vehicle_embedding', 'is', null)
          .neq('observation_id', observationId)
          .order('recorded_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (priorObs?.vehicle_embedding) {
          const prior = Array.isArray(priorObs.vehicle_embedding)
            ? priorObs.vehicle_embedding
            : Object.values(priorObs.vehicle_embedding as any);
          const sim = cosineSimilarity(inference.embedding, prior as number[]);
          vehicleMoved = sim < MOVEMENT_THRESHOLD;
          console.log(`📍 Movement check: similarity=${sim.toFixed(3)}, moved=${vehicleMoved}`);
        } else {
          // First time we've seen this plate in this zone
          isNewVehicle = true;
          console.log('🆕 New vehicle in zone:', plate);
        }
      } catch (mvErr: any) {
        console.warn('⚠️ Movement check failed:', mvErr.message);
      }
    }

    // ── Step 7: Upsert canonical_vehicles ─────────────────────────────────
    // NZSCV only provides SC status + expiry — NOT make/model/year.
    // Vehicle make/model/year come from Railway inference / ALPR, NOT NZSCV.
    if (plate) {
      try {
        const vehicleUpsertData: Record<string, unknown> = {
          plate_number: plate,
          last_seen_at: recordedAt,
        };
        // Only SC certification data comes from NZSCV
        if (nzscv !== null) {
          vehicleUpsertData.self_contained        = nzscv.isSelfContained;
          vehicleUpsertData.self_contained_expiry = nzscv.selfContainedExpiry;
        }

        const { data: existingVehicle } = await supabase
          .from('canonical_vehicles')
          .select('plate_number, total_observations')
          .eq('plate_number', plate)
          .maybeSingle();

        if (existingVehicle) {
          await supabase
            .from('canonical_vehicles')
            .update({
              ...vehicleUpsertData,
              total_observations: (existingVehicle.total_observations ?? 0) + 1,
            })
            .eq('plate_number', plate);
        } else {
          await supabase
            .from('canonical_vehicles')
            .insert({ ...vehicleUpsertData, first_seen_at: recordedAt, total_observations: 1 });
        }
        console.log('✅ canonical_vehicles upserted:', plate);
      } catch (cvErr: any) {
        console.warn('⚠️ canonical_vehicles upsert failed:', cvErr.message);
      }
    }

    // ── Step 8: Update observation with plate + SC status ────────────────
    // Only plate + NZSCV SC data + embedding go in here.
    // Vehicle make/model/year/colour come from Railway inference (Step 3), NOT NZSCV.
    const observationUpdate: Record<string, unknown> = {
      plate_number: plate ?? 'MANUAL_REQUIRED',
    };
    // SC certification from NZSCV only
    if (nzscv !== null) {
      observationUpdate.self_contained        = nzscv.isSelfContained;
      observationUpdate.self_contained_expiry = nzscv.selfContainedExpiry;
    }
    if (inference.embedding) {
      observationUpdate.vehicle_embedding      = inference.embedding;
      observationUpdate.embedding_quality      = inference.embeddingQuality;
      observationUpdate.embedding_model_version = 'yolov8n_mobilenetv3_v1.0';
      observationUpdate.embedding_created_at   = new Date().toISOString();
    }

    const { error: updateErr } = await supabase
      .from('observations')
      .update(observationUpdate)
      .eq('observation_id', observationId);

    if (updateErr) {
      // Strip optional columns that may not exist in schema and retry
      const optionalCols = [
        'vehicle_embedding', 'embedding_quality',
        'embedding_model_version', 'embedding_created_at',
      ];
      for (const col of optionalCols) delete observationUpdate[col];
      await supabase
        .from('observations')
        .update(observationUpdate)
        .eq('observation_id', observationId);
      console.warn('⚠️ Retried observation UPDATE without embedding columns');
    } else {
      console.log('✅ Observation updated with plate + vehicle details');
    }

    // ── Step 9: Compliance evaluation ─────────────────────────────────────
    // Check canonical vehicle for homeless status (affects CSC exemption)
    let isHomeless = false;
    if (plate) {
      try {
        const { data: cv } = await supabase
          .from('canonical_vehicles')
          .select('is_homeless, homeless_status')
          .eq('plate_number', plate)
          .maybeSingle();
        isHomeless = !!(cv?.is_homeless) ||
          cv?.homeless_status === 'confirmed' ||
          cv?.homeless_status === 'claimed';
      } catch { /* ignore */ }
    }

    const compliance = await evaluateCompliance(supabase, {
      zoneId,
      organizationId,
      plate: plate ?? 'MANUAL_REQUIRED',
      recordedAt,
      isSelfContained: nzscv?.isSelfContained ?? false,
      isHomeless,
    });

    console.log('⚖️ Compliance result:', compliance);

    // ── Step 10: Update observation with compliance fields ─────────────────
    await supabase
      .from('observations')
      .update({
        is_compliant:              compliance.isCompliant,
        is_breach:                 !compliance.isCompliant,
        breach_type:               compliance.breachType,
        breach_reason:             compliance.breachReason,
        nights_stayed_this_month:  compliance.nightsStayed,
        consecutive_nights:        compliance.consecutiveNights,
      })
      .eq('observation_id', observationId);

    // ── Step 11: Insert / update compliance_results ────────────────────────
    try {
      // Look up matrix id/version for audit trail
      let matrixId: string | null = null;
      let matrixVersion: number | null = null;
      try {
        const { data: mx } = await supabase
          .from('zone_compliance_matrix')
          .select('id, version')
          .eq('zone_id', zoneId)
          .lte('effective_from', recordedAt)
          .or(`effective_to.is.null,effective_to.gt.${recordedAt}`)
          .order('version', { ascending: false })
          .limit(1)
          .maybeSingle();
        matrixId      = mx?.id ?? null;
        matrixVersion = mx?.version ?? null;
      } catch { /* ignore */ }

      await supabase
        .from('compliance_results')
        .upsert(
          {
            observation_id:  observationId,
            zone_id:         zoneId,
            organization_id: organizationId,
            matrix_id:       matrixId,
            matrix_version:  matrixVersion,
            is_compliant:    compliance.isCompliant,
            violation_reasons: compliance.violationReasons,
            evaluated_at:    new Date().toISOString(),
          },
          { onConflict: 'observation_id' }
        );
      console.log('✅ compliance_results upserted');
    } catch (crErr: any) {
      console.warn('⚠️ compliance_results upsert failed:', crErr.message);
    }

    // ── Step 12: Create breach_alert if non-compliant ──────────────────────
    if (!compliance.isCompliant && compliance.breachType && plate) {
      try {
        await supabase
          .from('breach_alerts')
          .insert({
            observation_id:  observationId,
            plate_number:    plate,
            zone_id:         zoneId,
            organization_id: organizationId,
            breach_type:     compliance.breachType,
            breach_details:  {
              breach_reason:            compliance.breachReason,
              violation_reasons:        compliance.violationReasons,
              nights_stayed_this_month: compliance.nightsStayed,
              consecutive_nights:       compliance.consecutiveNights,
              // NZSCV only provides SC status — NOT make/model/year
              is_self_contained:        nzscv?.isSelfContained ?? false,
              sc_expiry:                nzscv?.selfContainedExpiry ?? null,
              source:                   'process_officer_scan',
            },
            status:          'pending',
            created_at:      new Date().toISOString(),
          })
          .select()
          .single();
        console.log('🚨 breach_alert created');
      } catch (baErr: any) {
        // ON CONFLICT on (org_id, zone_id, observation_id) is expected
        console.warn('⚠️ breach_alert insert skipped (may already exist):', baErr.message);
      }
    }

    // ── Step 13: Return enriched result ───────────────────────────────────
    // NOTE: vehicle make/model/year/colour are NOT populated from NZSCV —
    // they come from Railway inference which returns plate + embedding only.
    // The ScanDetailPanel shows these fields from the updated observation row,
    // which may be null until a manual correction is entered by the officer.
    const result = {
      success: true,
      observation_id:   observationId,
      plate:            plate,
      plate_confidence: finalConfidence,
      requires_manual_entry: requiresManualEntry,
      vehicle: {
        // make/model/year/colour: not from NZSCV — will be null unless
        // Railway inference or manual officer entry provides them
        make:                  null as string | null,
        model:                 null as string | null,
        year:                  null as number | null,
        color:                 null as string | null,
        // SC certification IS from NZSCV (plate + expiry only)
        self_contained:        nzscv?.isSelfContained ?? false,
        self_contained_expiry: nzscv?.selfContainedExpiry ?? null,
      },
      movement: {
        is_new_vehicle: isNewVehicle,
        vehicle_moved:  vehicleMoved,
      },
      compliance: {
        is_compliant:   compliance.isCompliant,
        breach_type:    compliance.breachType,
        breach_reason:  compliance.breachReason,
        violations:     compliance.violationReasons,
      },
    };

    console.log('✅ process-officer-scan complete', {
      observationId,
      plate,
      isCompliant: compliance.isCompliant,
      breachType: compliance.breachType,
    });

    return jsonResp(result);

  } catch (err: any) {
    console.error('❌ process-officer-scan error:', err.message, err.stack);
    return jsonResp({ error: err.message || 'Internal server error' }, 500);
  }
});
