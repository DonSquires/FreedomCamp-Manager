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
//   3.  Railway inference  → plate candidate + vehicle embedding + sticker detection
//       + make/model/colour/sticker presence (all optional)
//   4.  ALPR backup (Plate Recognizer) if inference returns no plate
//   5.  Canonical vehicle + SCV lookup → check canonical_vehicles first
//       (trusted local source) before NZSCV API (may be on test endpoint).
//       Returns self-contained certificate status + expiry date (guaranteed)
//       + make/model/year/vin/colour/maxOccupants when provided (optional/nullable)
//   5b. Cross-source discrepancy detection:
//       - SC sticker presence (inference) vs NZSCV register
//       - make/model/colour: inference vs NZSCV vs canonical_vehicles
//       - plate-mismatch-same-vehicle (embedding similarity ≥ 0.85, different plate)
//       - Writes to vehicle_discrepancies table; raises breach_alert for critical items
//       - SC law enforcement date: 1 June 2026
//   6.  Movement detection (cosine similarity vs prior observation embedding)
//   7.  Upsert canonical_vehicles with enriched data
//   8.  UPDATE observation: plate, embedding, SC status, sticker, discrepancy flags
//   9.  Inline compliance evaluation (zone-matrix rules)
//   10. UPDATE observation: is_compliant + breach fields
//   11. INSERT / UPDATE compliance_results row
//   12. INSERT breach_alert if non-compliant OR critical discrepancy
//   13. Return enriched observation
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { corsHeaders } from '../_shared/cors.ts';
import { alprWithBytes } from '../_shared/alpr.ts';
import { nzHour, toValidBreachType } from '../_shared/compliance.ts';

// ─── Environment ────────────────────────────────────────────────────────────
const SUPABASE_URL             = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const INFERENCE_SERVICE_URL    = Deno.env.get('INFERENCE_SERVICE_URL');
const INFERENCE_TIMEOUT_MS     = Number(Deno.env.get('INFERENCE_TIMEOUT_MS') ?? '7000');
const ALPR_BACKUP_TIMEOUT_MS   = Number(Deno.env.get('ALPR_TIMEOUT_MS') ?? '3500');
const ALPR_BACKUP_START_DELAY_MS = Number(Deno.env.get('ALPR_BACKUP_START_DELAY_MS') ?? '1200');
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
const MAKE_MISMATCH_MIN_CONF = Number(Deno.env.get('MAKE_MISMATCH_MIN_CONF') ?? '0.72');
const MODEL_MISMATCH_MIN_CONF = Number(Deno.env.get('MODEL_MISMATCH_MIN_CONF') ?? '0.68');
const COLOUR_MISMATCH_MIN_CONF = Number(Deno.env.get('COLOUR_MISMATCH_MIN_CONF') ?? '0.60');
const PROCESSING_LOCK_STALE_MS = Number(Deno.env.get('PROCESSING_LOCK_STALE_MS') ?? '120000');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const trimmed = authHeader.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^Bearer\s+(.+)$/i);
  if (match?.[1]) return match[1].trim() || null;

  // Compatibility fallback: accept raw token strings for legacy callers.
  if (!trimmed.includes(' ')) return trimmed;
  return null;
}

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

function firstPresent(...values: Array<unknown>): string | null {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

function normText(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
}

function isLikelyTextMismatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normText(a);
  const right = normText(b);
  if (!left || !right) return false;
  if (left === right) return false;
  // Treat substrings as equivalent to avoid noisy mismatches like
  // "Toyota Hiace" vs "Hiace" or punctuation-only differences.
  if (left.length >= 4 && right.includes(left)) return false;
  if (right.length >= 4 && left.includes(right)) return false;
  return true;
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

function canonicalizePhotoReference(raw: string): string {
  const loc = parseStorageLocation(raw);
  if (!loc) return String(raw || '').trim();
  return `${loc.bucket}/${loc.path}`;
}

function extractFileName(rawPath: string | null | undefined): string | null {
  if (!rawPath) return null;
  const clean = String(rawPath).split('?')[0].replace(/\\/g, '/').replace(/\/+$/, '');
  if (!clean) return null;
  const parts = clean.split('/');
  const last = parts[parts.length - 1]?.trim();
  return last || null;
}

async function upsertPhotoMetadataLink(
  supabase: ReturnType<typeof createClient>,
  params: {
    observationId: string;
    userId: string;
    photoRef: string;
    photoHash?: string | null;
    fileSize?: number | null;
  },
): Promise<void> {
  const canonicalRef = canonicalizePhotoReference(params.photoRef);
  const loc = parseStorageLocation(canonicalRef) ?? parseStorageLocation(params.photoRef);
  const storagePath = loc ? `${loc.bucket}/${loc.path}` : canonicalRef;
  if (!storagePath) return;

  const fileName = extractFileName(loc?.path ?? storagePath);
  const mimeType = fileName?.toLowerCase().endsWith('.png')
    ? 'image/png'
    : fileName?.toLowerCase().endsWith('.webp')
    ? 'image/webp'
    : 'image/jpeg';

  const row = {
    observation_id: params.observationId,
    user_id: params.userId,
    storage_path: storagePath,
    file_name: fileName,
    file_size: params.fileSize ?? null,
    mime_type: mimeType,
    sha256_hash: params.photoHash ?? null,
  };

  const { data: existing, error: findErr } = await supabase
    .from('photo_metadata')
    .select('id')
    .eq('observation_id', params.observationId)
    .eq('storage_path', storagePath)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (findErr) {
    console.warn('⚠️ photo_metadata lookup failed, continuing without link:', findErr.message);
    return;
  }

  if (existing?.id) {
    const { error: updateErr } = await supabase
      .from('photo_metadata')
      .update(row)
      .eq('id', existing.id);
    if (updateErr) {
      console.warn('⚠️ photo_metadata update failed:', updateErr.message);
    }
    return;
  }

  const { error: insertErr } = await supabase
    .from('photo_metadata')
    .insert(row);

  if (insertErr) {
    console.warn('⚠️ photo_metadata insert failed:', insertErr.message);
  }
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
  // Optional vehicle detail fields from inference service
  inferMake:   string | null;
  inferModel:  string | null;
  inferYear:   number | null;
  inferColour: string | null;
  inferMakeConf:   number | null;
  inferModelConf:  number | null;
  inferColourConf: number | null;
  // SC sticker detection from inference service (tri-state: true/false/null=inconclusive)
  stickerPresence: boolean | null;
  stickerColor:    string | null;
  stickerConf:     number | null;
}

async function callInference(imageBytes: Uint8Array): Promise<InferenceResult> {
  const empty: InferenceResult = {
    plate: null, confidence: null, embedding: null, embeddingQuality: null,
    path: 'no_inference_url',
    inferMake: null, inferModel: null, inferYear: null, inferColour: null,
    inferMakeConf: null, inferModelConf: null, inferColourConf: null,
    stickerPresence: null, stickerColor: null, stickerConf: null,
  };
  if (!INFERENCE_SERVICE_URL) {
    console.warn('⚠️ INFERENCE_SERVICE_URL not configured — skipping inference');
    return empty;
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

    // Sticker detection — tri-state per inference contract v1
    const s = d?.sticker;
    const stickerPresence: boolean | null =
      s?.presence !== undefined && s?.presence !== null ? Boolean(s.presence) : null;

    return {
      plate:           normalizePlate(d?.plate_number ?? d?.plate ?? null),
      confidence:      d?.detection?.confidence ?? d?.confidence ?? null,
      embedding:       Array.isArray(d?.embedding) ? d.embedding : null,
      embeddingQuality: d?.embedding_quality ?? null,
      path:            'railway_inference',
      inferMake:       d?.vehicle_make   ? String(d.vehicle_make)   : (d?.make ? String(d.make) : null),
      inferModel:      d?.vehicle_model  ? String(d.vehicle_model)  : (d?.model ? String(d.model) : null),
      inferYear:       toIntOrNull(d?.vehicle_year ?? d?.year ?? null),
      inferColour:     d?.vehicle_colour
        ? String(d.vehicle_colour)
        : (d?.vehicle_color ? String(d.vehicle_color) : (d?.colour ? String(d.colour) : null)),
      inferMakeConf:   d?.vehicle_make_confidence   ?? null,
      inferModelConf:  d?.vehicle_model_confidence  ?? null,
      inferColourConf: d?.vehicle_colour_confidence ?? d?.vehicle_color_confidence ?? null,
      stickerPresence,
      stickerColor:    s?.color ?? null,
      stickerConf:     s?.detection_confidence ?? null,
    };
  } catch (err: any) {
    console.error('❌ Inference failed:', err.message);
    return { ...empty, path: 'inference_error' };
  }
}

// ─── Step 5: NZSCV lookup ────────────────────────────────────────────────────
// Guaranteed fields: isSelfContained, selfContainedExpiry.
// Optional fields (make/model/year/vin/colour/maxOccupants): populated when
// NZSCV provides them in the response, null otherwise.
interface NZSCVResult {
  /** Whether the SC certificate is current */
  isSelfContained: boolean;
  /** ISO date string of SC certificate expiry, or null if not on register */
  selfContainedExpiry: string | null;
  /** Optional — vehicle make if provided by NZSCV */
  make: string | null;
  /** Optional — vehicle model if provided by NZSCV */
  model: string | null;
  /** Optional — year of manufacture if provided by NZSCV */
  year: number | null;
  /** Optional — VIN if provided by NZSCV */
  vin: string | null;
  /** Optional — primary colour if provided by NZSCV */
  colour: string | null;
  /** Optional — max occupants certified if provided by NZSCV */
  maxOccupants: number | null;
}

interface CanonicalVehicleSnapshot {
  plate_number: string;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  vehicle_color: string | null;
  self_contained: boolean | null;
  self_contained_expiry: string | null;
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
        return {
          isSelfContained: false, selfContainedExpiry: null,
          make: null, model: null, year: null, vin: null, colour: null, maxOccupants: null,
        };
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
    // check-nzscv-status edge function wraps it under result.
    // Handle both shapes defensively.
    const vr   = data?.VehicleRegistration ?? null;
    const cert = data?.result ?? data?.certification ?? null;

    // Derive expiry: prefer direct NZSCV field, fall back to wrapped shapes
    const expiry: string | null = firstPresent(
      vr?.CertificateExpiryDate,
      vr?.certificateExpiryDate,
      vr?.ExpiryDate,
      cert?.expiry_date,
      cert?.expiryDate,
      cert?.certificate_expiry,
      data?.CertificateExpiryDate,
      data?.certificateExpiryDate,
    );

    // Derive status: prefer direct NZSCV field, fall back to wrapped shapes
    const status: string | null = firstPresent(
      vr?.CertificateStatus,
      vr?.certificateStatus,
      vr?.Status,
      cert?.status,
      cert?.certificate_status,
      cert?.cert_status,
      data?.CertificateStatus,
      data?.certificateStatus,
    );

    // A vehicle is self-contained if:
    //  a) The register explicitly says Current or Issued, OR
    //  b) There is an expiry date and it is still in the future
    //     (some integrations only return expiry, not a status field)
    const isCurrentByStatus = status === 'Current' || status === 'Issued';
    const isCurrentByExpiry = expiry != null && new Date(expiry) > new Date();
    const isSelfContained = isCurrentByStatus || (!status && isCurrentByExpiry);

    // Optional vehicle detail fields — present when NZSCV provides them
    const rawMake = firstPresent(
      vr?.make,
      vr?.Make,
      vr?.vehicle_make,
      vr?.VehicleMake,
      cert?.make,
      cert?.Make,
      cert?.vehicle_make,
      cert?.VehicleMake,
      data?.make,
      data?.Make,
    );
    const rawModel = firstPresent(
      vr?.model,
      vr?.Model,
      vr?.vehicle_model,
      vr?.VehicleModel,
      cert?.model,
      cert?.Model,
      cert?.vehicle_model,
      cert?.VehicleModel,
      data?.model,
      data?.Model,
    );
    const rawYear = firstPresent(
      vr?.year,
      vr?.Year,
      vr?.vehicle_year,
      vr?.VehicleYear,
      cert?.year,
      cert?.Year,
      cert?.vehicle_year,
      data?.year,
      data?.Year,
    );
    const rawVin = firstPresent(
      vr?.vin,
      vr?.VIN,
      vr?.vehicle_vin,
      cert?.vin,
      cert?.VIN,
      cert?.vehicle_vin,
      data?.vin,
      data?.VIN,
    );
    const rawColour = firstPresent(
      vr?.colour,
      vr?.color,
      vr?.Colour,
      vr?.Color,
      vr?.vehicle_colour,
      vr?.vehicle_color,
      cert?.colour,
      cert?.color,
      cert?.Colour,
      cert?.Color,
      data?.colour,
      data?.color,
    );
    const rawMaxOcc = firstPresent(
      vr?.MaxOccupants,
      vr?.max_occupants,
      vr?.maxOccupants,
      cert?.max_occupants,
      cert?.maxOccupants,
      data?.max_occupants,
      data?.maxOccupants,
    );

    return {
      isSelfContained,
      selfContainedExpiry: expiry,
      make:         rawMake   ? String(rawMake)                     : null,
      model:        rawModel  ? String(rawModel)                    : null,
      year:         rawYear   ? parseInt(String(rawYear), 10) || null : null,
      vin:          rawVin    ? String(rawVin)                      : null,
      colour:       rawColour ? String(rawColour)                   : null,
      maxOccupants: rawMaxOcc ? parseInt(String(rawMaxOcc), 10) || null : null,
    };
  } catch (err: any) {
    console.error('❌ NZSCV lookup failed:', err.message);
    return null;
  }
}

function toIntOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

// ─── Step 9: Inline compliance evaluation ────────────────────────────────────
interface ComplianceResult {
  isCompliant: boolean;
  breachType: string | null;
  breachReason: string | null;
  isExempt: boolean;
  exemptionReason: string | null;
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
    return {
      isCompliant: true,
      breachType: null,
      breachReason: null,
      isExempt: false,
      exemptionReason: null,
      violationReasons: [],
      nightsStayed: 0,
      consecutiveNights: 0,
    };
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
    isExempt: homelessExempt,
    exemptionReason: homelessExempt ? 'homeless_vehicle_exempt' : null,
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

  let lockToken: string | null = null;
  let observationIdForCleanup: string | null = null;
  let supabase: any = null;

  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    const jwt = extractBearerToken(authHeader);
    if (!jwt) {
      const clientInfo = (req.headers.get('x-client-info') ?? '').toLowerCase();
      if (clientInfo.startsWith('supabase-js-web/')) {
        console.warn('⚠️ process-officer-scan missing Authorization from web client; skipping direct call and expecting backend kickoff');
        return jsonResp({ success: true, skipped: true, reason: 'missing_auth_header_web_client' }, 202);
      }
      return jsonResp({ error: 'Missing Authorization header' }, 401);
    }

    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const jwtPayload = decodeJwtPayload(jwt);
    let authUserId = typeof jwtPayload?.sub === 'string' && jwtPayload.sub.length > 0
      ? jwtPayload.sub
      : null;

    // Fallback: full user validation when local JWT decode fails (e.g. non-HS256 tokens).
    if (!authUserId) {
      const { data: authData, error: authError } = await supabase.auth.getUser(jwt);
      if (!authError && authData?.user?.id) {
        authUserId = authData.user.id;
      }
    }

    if (!authUserId) {
      console.error('🚫 process-officer-scan auth failed after all fallbacks', {
        hasAuthHeader: !!req.headers.get('Authorization'),
        hasLocalPayload: !!jwtPayload,
      });
      return jsonResp({ error: 'Unauthorized' }, 401);
    }

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('id, role, organization_id')
      .eq('id', authUserId)
      .maybeSingle();

    if (!profile) return jsonResp({ error: 'User profile not found' }, 403);

    // ── Parse input ─────────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const observationId: string | null = body.observation_id ?? null;
    const photoUrl:       string | null = body.photo_url ?? null;
    const allowAdminOverride = body.allow_admin_override === true;

    if (!observationId) return jsonResp({ error: 'observation_id is required' }, 400);
    if (!photoUrl)       return jsonResp({ error: 'photo_url is required' }, 400);
    observationIdForCleanup = observationId;

    console.log('🔍 process-officer-scan started', { observationId, officerId: profile.id });

    // ── Step 1: Load observation ────────────────────────────────────────────
    const { data: obs, error: obsLoadError } = await supabase
      .from('observations')
      .select('observation_id, organization_id, zone_id, recorded_at, recorded_by, updated_at, plate_number, is_compliant, sticker_presence, sticker_color, vehicle_make, vehicle_model, vehicle_year, vehicle_color')
      .eq('observation_id', observationId)
      .maybeSingle();

    if (obsLoadError || !obs) {
      console.error('❌ Observation not found:', obsLoadError?.message);
      return jsonResp({ error: 'Observation not found' }, 404);
    }

    const existingPlate = typeof obs.plate_number === 'string' ? obs.plate_number : null;
    const isProcessingPlaceholder = !!existingPlate && (
      existingPlate === 'PROCESSING...' || existingPlate.startsWith('PROCESSING_LOCKED:')
    );

    // Idempotent fast-exit: if the observation already has a resolved plate,
    // background enrichment has already completed (or manual correction was
    // applied). This makes duplicate fire-and-forget invocations harmless.
    // Skipped when allow_admin_override=true (admin-triggered reingest).
    if (!allowAdminOverride && existingPlate && !isProcessingPlaceholder && existingPlate !== 'MANUAL_REQUIRED') {
      console.log('ℹ️ process-officer-scan skipping already-enriched observation', {
        observationId,
        plate: existingPlate,
      });
      return jsonResp({ success: true, skipped: true, reason: 'already_enriched' });
    }

    // Verify officer owns this observation, unless explicit admin override is enabled.
    // Reingest uses this override so admin/admin_officer can reprocess historical
    // observations without changing original recorded_by metadata.
    const isAdminRole = ['admin', 'admin_officer', 'master'].includes(profile.role);
    const sameOrg = obs.organization_id === profile.organization_id;
    if (profile.role !== 'master' && obs.recorded_by !== profile.id) {
      if (!(allowAdminOverride && isAdminRole && sameOrg)) {
        return jsonResp({ error: 'Forbidden: observation belongs to another officer' }, 403);
      }
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

    await upsertPhotoMetadataLink(supabase, {
      observationId,
      userId: profile.id,
      photoRef: photoUrl,
      photoHash: body.photo_hash ?? null,
      fileSize: imageBytes.length,
    });

    // Concurrency guard: ensure only one invocation claims this observation
    // while it is in a processing placeholder state.
    if (isProcessingPlaceholder && existingPlate) {
      let claimFromPlate = existingPlate;

      if (existingPlate.startsWith('PROCESSING_LOCKED:')) {
        const updatedAtMs = Date.parse(String((obs as any).updated_at ?? ''));
        const lockAgeMs = Number.isFinite(updatedAtMs) ? Date.now() - updatedAtMs : PROCESSING_LOCK_STALE_MS + 1;
        if (lockAgeMs < PROCESSING_LOCK_STALE_MS) {
          console.log('⏭️ Active in-flight lock detected — skipping duplicate invocation', { observationId, lockAgeMs });
          return jsonResp({ success: true, skipped: true, reason: 'duplicate_in_flight' }, 202);
        }

        const { data: reclaimed } = await supabase
          .from('observations')
          .update({ plate_number: 'PROCESSING...' })
          .eq('observation_id', observationId)
          .eq('plate_number', existingPlate)
          .select('observation_id')
          .maybeSingle();

        if (!reclaimed) {
          console.log('⏭️ Lock changed before reclaim — skipping duplicate invocation', { observationId });
          return jsonResp({ success: true, skipped: true, reason: 'duplicate_in_flight' }, 202);
        }

        claimFromPlate = 'PROCESSING...';
        console.log('🔁 Reclaimed stale processing lock', { observationId, lockAgeMs });
      }

      lockToken = `PROCESSING_LOCKED:${crypto.randomUUID().slice(0, 8)}`;
      const { data: claimed, error: claimErr } = await supabase
        .from('observations')
        .update({ plate_number: lockToken })
        .eq('observation_id', observationId)
        .eq('plate_number', claimFromPlate)
        .select('observation_id')
        .maybeSingle();

      if (claimErr) {
        console.warn('⚠️ Failed to claim processing lock, continuing best-effort:', claimErr.message);
      } else if (!claimed) {
        console.log('⏭️ Duplicate in-flight invocation detected — skipping', { observationId });
        return jsonResp({ success: true, skipped: true, reason: 'duplicate_in_flight' }, 202);
      } else {
        console.log('🔒 Claimed processing lock', { observationId });
      }
    }

    // ── Step 3: Plate detection and inference ─────────────────────────────
    // Start ALPR backup only when Railway inference is slow or returns no
    // plate. This keeps fast-path cost low while collapsing worst-case plate
    // detection latency from sequential (inference + ALPR) to overlapping.
    const inferenceStartedAt = Date.now();
    const inferencePromise = callInference(imageBytes);

    let alprPromise: Promise<ReturnType<typeof alprWithBytes> extends Promise<infer T> ? T : never> | null = null;
    const startAlprBackup = () => {
      if (!alprPromise) {
        alprPromise = alprWithBytes(imageBytes, {
          regions: Deno.env.get('ALPR_REGIONS') ?? 'nz',
          mmc: true,
          timeout: ALPR_BACKUP_TIMEOUT_MS,
        });
      }
      return alprPromise;
    };

    const alprStartTimer = setTimeout(() => {
      void startAlprBackup();
    }, ALPR_BACKUP_START_DELAY_MS);

    const inference = await inferencePromise;
    clearTimeout(alprStartTimer);

    console.log('🚂 Inference result:', {
      plate: inference.plate,
      confidence: inference.confidence,
      hasEmbedding: !!inference.embedding,
      path: inference.path,
      duration_ms: Date.now() - inferenceStartedAt,
    });

    // ── Step 4: ALPR backup ───────────────────────────────────────────────
    let finalPlate = inference.plate;
    let finalConfidence = inference.confidence;
    let alprMake: string | null = null;
    let alprModel: string | null = null;
    let alprColour: string | null = null;
    let alprColourConf: number | null = null;
    let alprOrientation: string | null = null;

    if (!finalPlate) {
      console.log('🔄 No plate from inference — running ALPR backup...');
      try {
        const alprStartedAt = Date.now();
        const alprResult = await startAlprBackup();

        // ALPR vehicle attributes are used as a low-priority fallback only.
        alprMake = alprResult.make;
        alprModel = alprResult.model;
        alprColour = alprResult.color;
        alprColourConf = alprResult.colorConfidence;
        alprOrientation = alprResult.orientation;

        if (alprResult.plate) {
          finalPlate = normalizePlate(alprResult.plate);
          finalConfidence = alprResult.confidence;
          console.log('✅ ALPR backup found plate:', finalPlate, {
            duration_ms: Date.now() - alprStartedAt,
            make: alprMake,
            model: alprModel,
            colour: alprColour,
            orientation: alprOrientation,
          });
        } else {
          console.warn('⚠️ ALPR backup returned no plate');
        }
      } catch (alprErr: any) {
        console.warn('⚠️ ALPR backup failed:', alprErr.message);
      }
    }

    const plate = finalPlate ?? null;
    const requiresManualEntry = !plate;

    // ── Step 5: Canonical vehicle + SCV lookup ────────────────────────────
    // Vehicle attributes (make/model/year/colour) come from canonical_vehicles.
    // SCV status comes exclusively from canonical_scv (authoritative registry).
    let canonicalVehicle: CanonicalVehicleSnapshot | null = null;
    let canonicalMake:   string | null = null;
    let canonicalModel:  string | null = null;
    let canonicalColour: string | null = null;
    let canonicalYear: number | null = null;
    let nzscv: NZSCVResult | null = null;
    if (plate) {
      try {
        const { data: cv } = await supabase
          .from('canonical_vehicles')
          .select('plate_number, vehicle_make, vehicle_model, vehicle_year, vehicle_color')
          .eq('plate_number', plate)
          .maybeSingle();

        canonicalVehicle = cv as CanonicalVehicleSnapshot | null;
        canonicalMake   = canonicalVehicle?.vehicle_make  ?? null;
        canonicalModel  = canonicalVehicle?.vehicle_model ?? null;
        canonicalColour = canonicalVehicle?.vehicle_color ?? null;
        canonicalYear   = toIntOrNull(canonicalVehicle?.vehicle_year);
      } catch (canonicalErr: any) {
        console.warn('⚠️ canonical_vehicles lookup failed:', canonicalErr.message);
      }

      // SCV status exclusively from canonical_scv
      try {
        const { data: scvRow } = await (supabase.from('canonical_scv') as any)
          .select('is_self_contained, certificate_expiry')
          .eq('plate_number', plate)
          .maybeSingle();

        nzscv = {
          isSelfContained: scvRow?.is_self_contained ?? false,
          selfContainedExpiry: scvRow?.certificate_expiry ?? null,
          make: null,
          model: null,
          year: null,
          vin: null,
          colour: null,
          maxOccupants: null,
        };

        console.log('✅ SCV status from canonical_scv:', {
          plate,
          isSelfContained: nzscv.isSelfContained,
          expiry: nzscv.selfContainedExpiry,
          canonicalMake,
          canonicalModel,
          canonicalYear,
          canonicalColour,
        });
      } catch (scvErr: any) {
        console.warn('⚠️ canonical_scv lookup failed:', scvErr?.message);
      }
    }

    // ── Step 5b: Cross-source discrepancy detection ───────────────────────
    // The Freedom Camping (Self-Contained Vehicles) Amendment Act comes into
    // force on 1 June 2026.  After that date SC discrepancies become critical.
    const SC_LAW_DATE = new Date('2026-06-01T00:00:00+12:00'); // NZ midnight
    const obsDate     = new Date(recordedAt);
    const scLawActive = obsDate >= SC_LAW_DATE;

    // --- discrepancy helper types ---
    interface Discrepancy {
      discrepancy_type: string;
      source_a: string;
      source_b: string;
      value_a: string | null;
      value_b: string | null;
      severity: 'warning' | 'critical';
      sc_law_active: boolean;
      details: Record<string, unknown>;
    }

    const discrepancies: Discrepancy[] = [];

    // Effective sticker presence: prefer fresh inference result, fall back to
    // whatever was stored on the observation by a prior pipeline call.
    const effectiveStickerPresence: boolean | null =
      inference.stickerPresence !== null
        ? inference.stickerPresence
        : (obs.sticker_presence !== undefined ? (obs.sticker_presence as boolean | null) : null);

    // --- 1. SC sticker vs canonical SCV record ---
    if (nzscv !== null && effectiveStickerPresence !== null && plate) {
      if (effectiveStickerPresence === true && !nzscv.isSelfContained) {
        // Sticker on vehicle but not marked self-contained in canonical record
        discrepancies.push({
          discrepancy_type: 'sc_sticker_not_in_register',
          source_a: 'inference',
          source_b: 'canonical',
          value_a: `sticker_present (color=${inference.stickerColor ?? 'unknown'}, conf=${(inference.stickerConf ?? 0).toFixed(2)})`,
          value_b: 'not_self_contained_in_canonical',
          severity: 'critical',
          sc_law_active: scLawActive,
          details: {
            sticker_color:    inference.stickerColor ?? obs.sticker_color ?? null,
            sticker_conf:     inference.stickerConf,
            canonical_scv_status: 'not_self_contained',
            canonical_scv_expiry: nzscv.selfContainedExpiry,
            note: scLawActive
              ? 'SC law active (1 Jun 2026): physical sticker present but canonical record is not self-contained — verify manually'
              : 'Sticker present on vehicle but canonical vehicle record is not self-contained — verify manually',
          },
        });
      } else if (effectiveStickerPresence === false && nzscv.isSelfContained) {
        // No sticker visible but canonical record says self-contained
        discrepancies.push({
          discrepancy_type: 'sc_in_register_no_sticker',
          source_a: 'canonical',
          source_b: 'inference',
          value_a: `self_contained_in_canonical (expiry=${nzscv.selfContainedExpiry ?? 'unknown'})`,
          value_b: 'no_sticker_detected',
          severity: scLawActive ? 'critical' : 'warning',
          sc_law_active: scLawActive,
          details: {
            canonical_scv_expiry: nzscv.selfContainedExpiry,
            sticker_conf: inference.stickerConf,
            note: 'Vehicle is marked self-contained in canonical records but no SC sticker was detected — sticker may be hidden, faded, or removed',
          },
        });
      }
    } else if (nzscv !== null && effectiveStickerPresence === null && plate) {
      // Sticker detection was inconclusive — flag for manual review
      discrepancies.push({
        discrepancy_type: 'sc_sticker_inconclusive',
        source_a: 'inference',
        source_b: 'canonical',
        value_a: 'inconclusive',
        value_b: nzscv.isSelfContained ? 'self_contained_in_canonical' : 'not_self_contained_in_canonical',
        severity: 'warning',
        sc_law_active: scLawActive,
        details: {
          sticker_conf:  inference.stickerConf,
          canonical_scv_status: nzscv.isSelfContained ? 'self_contained' : 'not_self_contained',
          canonical_scv_expiry: nzscv.selfContainedExpiry,
          note: 'Sticker detection was inconclusive — manual review required to confirm SC status',
        },
      });
    }

    // If plate is known but key attributes are still missing from stronger sources,
    // fetch ALPR attributes as a low-priority enrichment path.
    const needsAlprAttributeEnrichment = !!plate && (
      (!nzscv?.make && !canonicalMake && !inference.inferMake) ||
      (!nzscv?.model && !canonicalModel && !inference.inferModel) ||
      (!nzscv?.colour && !canonicalColour && !inference.inferColour)
    );
    if (needsAlprAttributeEnrichment && !alprMake && !alprModel && !alprColour) {
      try {
        const alprStartedAt = Date.now();
        const alprResult = await startAlprBackup();
        alprMake = alprResult.make ?? alprMake;
        alprModel = alprResult.model ?? alprModel;
        alprColour = alprResult.color ?? alprColour;
        alprColourConf = alprResult.colorConfidence ?? alprColourConf;
        alprOrientation = alprResult.orientation ?? alprOrientation;
        console.log('✅ ALPR attribute enrichment complete', {
          duration_ms: Date.now() - alprStartedAt,
          make: alprMake,
          model: alprModel,
          colour: alprColour,
          orientation: alprOrientation,
        });
      } catch (alprErr: any) {
        console.warn('⚠️ ALPR attribute enrichment failed:', alprErr.message);
      }
    }

    const isNewVehicle = !canonicalVehicle;

    if (inference.inferMake && plate && (inference.inferMakeConf ?? 0) >= MAKE_MISMATCH_MIN_CONF) {
      if (isLikelyTextMismatch(inference.inferMake, nzscv?.make)) {
        discrepancies.push({
          discrepancy_type: 'make_mismatch',
          source_a: 'inference',
          source_b: 'nzscv',
          value_a: inference.inferMake,
          value_b: nzscv?.make ?? null,
          severity: 'warning',
          sc_law_active: scLawActive,
          details: { inference_conf: inference.inferMakeConf },
        });
      } else if (isLikelyTextMismatch(inference.inferMake, canonicalMake)) {
        discrepancies.push({
          discrepancy_type: 'make_mismatch',
          source_a: 'inference',
          source_b: 'canonical',
          value_a: inference.inferMake,
          value_b: canonicalMake,
          severity: 'warning',
          sc_law_active: scLawActive,
          details: { inference_conf: inference.inferMakeConf },
        });
      }
    }

    // --- 4. Model mismatch ---
    if (inference.inferModel && plate && (inference.inferModelConf ?? 0) >= MODEL_MISMATCH_MIN_CONF) {
      if (isLikelyTextMismatch(inference.inferModel, nzscv?.model)) {
        discrepancies.push({
          discrepancy_type: 'model_mismatch',
          source_a: 'inference',
          source_b: 'nzscv',
          value_a: inference.inferModel,
          value_b: nzscv?.model ?? null,
          severity: 'warning',
          sc_law_active: scLawActive,
          details: { inference_conf: inference.inferModelConf },
        });
      } else if (isLikelyTextMismatch(inference.inferModel, canonicalModel)) {
        discrepancies.push({
          discrepancy_type: 'model_mismatch',
          source_a: 'inference',
          source_b: 'canonical',
          value_a: inference.inferModel,
          value_b: canonicalModel,
          severity: 'warning',
          sc_law_active: scLawActive,
          details: { inference_conf: inference.inferModelConf },
        });
      }
    }

    // --- 5. Colour mismatch ---
    if (inference.inferColour && plate && (inference.inferColourConf ?? 0) >= COLOUR_MISMATCH_MIN_CONF) {
      if (isLikelyTextMismatch(inference.inferColour, nzscv?.colour)) {
        discrepancies.push({
          discrepancy_type: 'colour_mismatch',
          source_a: 'inference',
          source_b: 'nzscv',
          value_a: inference.inferColour,
          value_b: nzscv?.colour ?? null,
          severity: 'warning',
          sc_law_active: scLawActive,
          details: { inference_conf: inference.inferColourConf },
        });
      } else if (isLikelyTextMismatch(inference.inferColour, canonicalColour)) {
        discrepancies.push({
          discrepancy_type: 'colour_mismatch',
          source_a: 'inference',
          source_b: 'canonical',
          value_a: inference.inferColour,
          value_b: canonicalColour,
          severity: 'warning',
          sc_law_active: scLawActive,
          details: { inference_conf: inference.inferColourConf },
        });
      }
    }

    console.log(`🔍 Discrepancy check: ${discrepancies.length} found for plate ${plate ?? '(unknown)'}`);

    // --- Persist discrepancies ---
    const hasDiscrepancies = discrepancies.length > 0;
    if (hasDiscrepancies) {
      try {
        const rows = discrepancies.map(d => ({
          observation_id:   observationId,
          plate_number:     plate,
          organization_id:  organizationId,
          zone_id:          zoneId,
          discrepancy_type: d.discrepancy_type,
          source_a:         d.source_a,
          source_b:         d.source_b,
          value_a:          d.value_a,
          value_b:          d.value_b,
          severity:         d.severity,
          sc_law_active:    d.sc_law_active,
          details:          d.details,
          requires_review:  true,
        }));
        await supabase.from('vehicle_discrepancies').insert(rows);
        console.log(`🚨 Inserted ${rows.length} discrepancy record(s)`);
      } catch (discErr: any) {
        console.warn('⚠️ Failed to insert discrepancies:', discErr.message);
      }
    }

    // ── Step 6: Movement detection + plate-mismatch-same-vehicle check ───────
    let vehicleMoved: boolean | null = null;
    // Plate mismatch: same vehicle (high embedding similarity) but different plate
    let plateMismatchSameVehicle = false;

    if (plate && inference.embedding) {
      try {
        // Search across all plates in this zone (not just the current plate) to
        // detect if this vehicle appeared previously under a different plate.
        const { data: priorObs } = await supabase
          .from('observations')
          .select('observation_id, vehicle_embedding, recorded_at, plate_number')
          .eq('zone_id', zoneId)
          .not('vehicle_embedding', 'is', null)
          .neq('observation_id', observationId)
          .order('recorded_at', { ascending: false })
          .limit(20);  // scan recent observations in this zone

        let bestSim = 0;
        let bestPrior: { observation_id: string; plate_number: string | null; recorded_at: string } | null = null;

        for (const prior of (priorObs ?? [])) {
          const priorEmb = Array.isArray(prior.vehicle_embedding)
            ? prior.vehicle_embedding
            : Object.values(prior.vehicle_embedding as any);
          const sim = cosineSimilarity(inference.embedding, priorEmb as number[]);
          if (sim > bestSim) {
            bestSim   = sim;
            bestPrior = prior;
          }
        }

        if (bestPrior && bestSim >= MOVEMENT_THRESHOLD) {
          if (bestPrior.plate_number === plate) {
            // Same plate → movement check
            vehicleMoved = bestSim < MOVEMENT_THRESHOLD;
          } else if (bestSim >= 0.85) {
            // Very high visual similarity but DIFFERENT plate → potential plate swap / cloning
            plateMismatchSameVehicle = true;
            discrepancies.push({
              discrepancy_type: 'plate_mismatch_same_vehicle',
              source_a: 'inference',
              source_b: 'canonical',
              value_a: plate,
              value_b: bestPrior.plate_number,
              severity: 'critical',
              sc_law_active: scLawActive,
              details: {
                embedding_similarity:   bestSim.toFixed(4),
                prior_observation_id:   bestPrior.observation_id,
                prior_recorded_at:      bestPrior.recorded_at,
                note: 'Same vehicle appearance (embedding similarity ≥ 0.85) but different plate number detected — possible plate swap or cloning',
              },
            });
            // Persist this extra discrepancy immediately (added after initial batch)
            try {
              await supabase.from('vehicle_discrepancies').insert({
                observation_id:   observationId,
                plate_number:     plate,
                organization_id:  organizationId,
                zone_id:          zoneId,
                discrepancy_type: 'plate_mismatch_same_vehicle',
                source_a:         'inference',
                source_b:         'canonical',
                value_a:          plate,
                value_b:          bestPrior.plate_number,
                severity:         'critical',
                sc_law_active:    scLawActive,
                details: {
                  embedding_similarity: bestSim.toFixed(4),
                  prior_observation_id: bestPrior.observation_id,
                  prior_recorded_at:    bestPrior.recorded_at,
                  note: 'Same vehicle appearance but different plate number — possible plate swap or cloning',
                },
                requires_review: true,
              });
            } catch (plErr: any) {
              console.warn('⚠️ Failed to insert plate-mismatch discrepancy:', plErr.message);
            }
            console.log(`🚨 Plate mismatch detected: ${plate} vs prior ${bestPrior.plate_number} (sim=${bestSim.toFixed(3)})`);
          } else {
            // Moderate similarity — same plate, movement check
            vehicleMoved = bestSim < MOVEMENT_THRESHOLD;
          }
          console.log(`📍 Movement check: similarity=${bestSim.toFixed(3)}, moved=${vehicleMoved}`);
        } else {
          // No prior match → new vehicle in zone
          // No prior match in zone
          console.log('🆕 New vehicle in zone:', plate);
        }
      } catch (mvErr: any) {
        console.warn('⚠️ Movement check failed:', mvErr.message);
      }
    }

    // Recompute hasDiscrepancies after potential plate-mismatch addition
    const finalHasDiscrepancies = discrepancies.length > 0;

    // Build resolved details once and always write them to the observation row.
    // Source priority: NZSCV (authoritative when available) → canonical snapshot
    // → inference → ALPR.
    const resolvedMake = nzscv?.make ?? canonicalMake ?? inference.inferMake ?? alprMake ?? null;
    const resolvedModel = nzscv?.model ?? canonicalModel ?? inference.inferModel ?? alprModel ?? null;
    const resolvedYear = nzscv?.year ?? canonicalYear ?? inference.inferYear ?? toIntOrNull(obs.vehicle_year) ?? null;
    const hasHighConfidenceInferenceColour = !!inference.inferColour && (inference.inferColourConf ?? 0) >= COLOUR_MISMATCH_MIN_CONF;
    const hasHighConfidenceAlprColour = !!alprColour && (alprColourConf ?? 0) >= COLOUR_MISMATCH_MIN_CONF;

    // Color drifts frequently in canonical snapshots; prefer fresh, confident
    // scan-time color when NZSCV does not provide a color.
    let resolvedColour: string | null = null;
    let resolvedColourSource: 'nzscv' | 'canonical' | 'inference' | 'alpr' | null = null;
    if (nzscv?.colour) {
      resolvedColour = nzscv.colour;
      resolvedColourSource = 'nzscv';
    } else if (hasHighConfidenceInferenceColour) {
      resolvedColour = inference.inferColour;
      resolvedColourSource = 'inference';
    } else if (hasHighConfidenceAlprColour) {
      resolvedColour = alprColour;
      resolvedColourSource = 'alpr';
    } else if (canonicalColour) {
      resolvedColour = canonicalColour;
      resolvedColourSource = 'canonical';
    } else if (inference.inferColour) {
      resolvedColour = inference.inferColour;
      resolvedColourSource = 'inference';
    } else if (alprColour) {
      resolvedColour = alprColour;
      resolvedColourSource = 'alpr';
    }

    // Track attribute sources for transparency in UI
    const attributeSources = {
      make_source: nzscv?.make ? 'nzscv' : canonicalMake ? 'canonical' : inference.inferMake ? 'inference' : alprMake ? 'alpr' : null,
      model_source: nzscv?.model ? 'nzscv' : canonicalModel ? 'canonical' : inference.inferModel ? 'inference' : alprModel ? 'alpr' : null,
      color_source: resolvedColourSource,
      year_source: nzscv?.year ? 'nzscv' : canonicalYear ? 'canonical' : inference.inferYear ? 'inference' : null,
    };

    const mismatchNotices = discrepancies.map((d) => {
      const mismatchLocation = (d.details as Record<string, unknown>)?.mismatch_location;
      const locationText = typeof mismatchLocation === 'string' ? mismatchLocation : `${d.source_a}_vs_${d.source_b}`;
      const reasonText = (d.details as Record<string, unknown>)?.reason;
      return {
        type: d.discrepancy_type,
        location: locationText,
        severity: d.severity,
        reason: typeof reasonText === 'string' && reasonText.length > 0
          ? reasonText
          : `Mismatch detected between ${d.source_a} and ${d.source_b}`,
      };
    });

    // ── Step 7: Upsert canonical_vehicles ─────────────────────────────────
    if (plate) {
      try {
        const vehicleUpsertData: Record<string, unknown> = {
          plate_number: plate,
          last_seen_at: recordedAt,
        };
        if (nzscv !== null) {
          // SC certification — always from NZSCV
          vehicleUpsertData.self_contained        = nzscv.isSelfContained;
          vehicleUpsertData.self_contained_expiry = nzscv.selfContainedExpiry;
        }

        // Always keep canonical details current with the resolved values.
        if (resolvedMake)   vehicleUpsertData.vehicle_make = resolvedMake;
        if (resolvedModel)  vehicleUpsertData.vehicle_model = resolvedModel;
        if (resolvedYear)   vehicleUpsertData.vehicle_year = resolvedYear;
        if (resolvedColour) vehicleUpsertData.vehicle_color = resolvedColour;

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

    // ── Step 8: Update observation with plate + NZSCV data ────────────────
    const observationUpdate: Record<string, unknown> = {
      plate_number: plate ?? 'MANUAL_REQUIRED',
    };
    if (resolvedMake) observationUpdate.vehicle_make = resolvedMake;
    if (resolvedModel) observationUpdate.vehicle_model = resolvedModel;
    if (resolvedYear) observationUpdate.vehicle_year = resolvedYear;
    if (resolvedColour) observationUpdate.vehicle_color = resolvedColour;
    // Track source of each attribute for UI transparency
    observationUpdate.vehicle_attribute_sources = attributeSources;
    if (nzscv !== null) {
      // SC certification — always present when NZSCV lookup succeeded
      observationUpdate.self_contained        = nzscv.isSelfContained;
      observationUpdate.self_contained_expiry = nzscv.selfContainedExpiry;
    }
    // Inference-provided vehicle attributes (also write when NZSCV didn't provide them)
    if (!observationUpdate.vehicle_make  && inference.inferMake)   observationUpdate.vehicle_make  = inference.inferMake;
    if (!observationUpdate.vehicle_model && inference.inferModel)  observationUpdate.vehicle_model = inference.inferModel;
    if (!observationUpdate.vehicle_color && inference.inferColour) observationUpdate.vehicle_color = inference.inferColour;
    // Sticker presence (fresh from inference, or leave as-is if inference was inconclusive)
    if (inference.stickerPresence !== null) {
      observationUpdate.sticker_presence            = inference.stickerPresence;
      observationUpdate.sticker_color               = inference.stickerColor;
      observationUpdate.sticker_detection_confidence = inference.stickerConf;
    }
    if (inference.embedding) {
      observationUpdate.vehicle_embedding      = inference.embedding;
      observationUpdate.embedding_quality      = inference.embeddingQuality;
      observationUpdate.embedding_model_version = 'yolov8n_mobilenetv3_v1.0';
      observationUpdate.embedding_created_at   = new Date().toISOString();
    }
    // Discrepancy flags summary
    observationUpdate.has_discrepancies = finalHasDiscrepancies;
    if (finalHasDiscrepancies) {
      observationUpdate.discrepancy_flags = discrepancies.map(d => ({
        type:     d.discrepancy_type,
        location: ((d.details as Record<string, unknown>)?.mismatch_location as string | undefined) ?? `${d.source_a}_vs_${d.source_b}`,
        severity: d.severity,
        source_a: d.source_a,
        source_b: d.source_b,
        value_a:  d.value_a,
        value_b:  d.value_b,
        reason:   (d.details as Record<string, unknown>)?.reason ?? null,
      }));
    }

    const { error: updateErr } = await supabase
      .from('observations')
      .update(observationUpdate)
      .eq('observation_id', observationId);

    if (updateErr) {
      console.warn('⚠️ Observation update failed, retrying without optional columns:', updateErr.message);
      // Strip optional columns that may not exist in schema and retry
      const optionalCols = [
        'vehicle_embedding', 'embedding_quality',
        'embedding_model_version', 'embedding_created_at',
        'sticker_presence', 'sticker_color', 'sticker_detection_confidence',
        'vehicle_color', 'has_discrepancies', 'discrepancy_flags',
        'vehicle_attribute_sources',
      ];
      for (const col of optionalCols) delete observationUpdate[col];
      await supabase
        .from('observations')
        .update(observationUpdate)
        .eq('observation_id', observationId);
      console.warn('⚠️ Retried observation UPDATE without optional columns');
    } else {
      console.log('✅ Observation updated with plate + vehicle details');
    }

    // ── Step 9: Compliance evaluation ─────────────────────────────────────
    // Homeless status exclusively from canonical_homeless (authoritative).
    let isHomeless = false;
    if (plate) {
      try {
        const { data: homelessRow } = await (supabase.from('canonical_homeless') as any)
          .select('status')
          .eq('plate_number', plate)
          .maybeSingle();
        if (homelessRow) {
          isHomeless = homelessRow.status === 'confirmed' || homelessRow.status === 'claimed';
          if (isHomeless) {
            console.log('✅ Homeless status from canonical_homeless:', { plate, status: homelessRow.status });
          }
        }
      } catch (homelessErr: any) {
        console.warn('⚠️ canonical_homeless lookup failed:', homelessErr?.message);
      }
    }

    // Determine self-contained status for compliance evaluation.
    // nzscv is always set from canonical_scv when Step 5 succeeds.
    // If Step 5 failed entirely (nzscv is null), re-query canonical_scv directly
    // as a last resort — benefit of the doubt (true) if that also fails.
    let isSelfContainedForCompliance: boolean;
    if (nzscv !== null) {
      isSelfContainedForCompliance = nzscv.isSelfContained;
    } else if (plate) {
      // Step 5 threw — try canonical_scv directly
      try {
        const { data: scvFallback } = await (supabase.from('canonical_scv') as any)
          .select('is_self_contained')
          .eq('plate_number', plate)
          .maybeSingle();
        isSelfContainedForCompliance = scvFallback?.is_self_contained ?? true;
        console.log('ℹ️ Step 5 failed — using canonical_scv direct fallback:', isSelfContainedForCompliance);
      } catch {
        // Benefit of the doubt — avoid false breaches if canonical_scv is unreachable
        isSelfContainedForCompliance = true;
        console.warn('⚠️ canonical_scv fallback query failed — defaulting to self_contained=true (benefit of doubt)');
      }
    } else {
      // No plate yet (MANUAL_REQUIRED) — benefit of the doubt
      isSelfContainedForCompliance = true;
    }

    const compliance = await evaluateCompliance(supabase, {
      zoneId,
      organizationId,
      plate: plate ?? 'MANUAL_REQUIRED',
      recordedAt,
      isSelfContained: isSelfContainedForCompliance,
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

    // ── Step 11: compliance_results table was dropped in 20260221_rebuild_observations_clean.sql.
    //            Compliance state is stored directly on the observations row (is_compliant,
    //            breach_type, breach_reason, nights_stayed_this_month, consecutive_nights).
    //            Nothing to do here — the observations.update() call in Step 10 already
    //            persists the full compliance result.

    // ── Step 12: Create breach_alert if non-compliant OR if critical discrepancies ──
    // A breach alert is raised both for compliance violations and for critical
    // discrepancies (e.g. fraudulent SC sticker, plate cloning) even if the
    // vehicle is otherwise compliant with stay-length rules.
    const criticalDiscrepancies = discrepancies.filter(d => d.severity === 'critical');
    const shouldRaiseAlert =
      (!compliance.isCompliant && compliance.breachType) ||
      criticalDiscrepancies.length > 0;

    if (shouldRaiseAlert && plate) {
      const breachType = compliance.breachType
        ?? (criticalDiscrepancies[0]?.discrepancy_type === 'plate_mismatch_same_vehicle'
              ? 'plate_mismatch'
              : 'data_integrity_issue');

      // ── De-duplicate: skip if an active breach alert already exists for this
      //    plate + zone + breach_type combination.  This prevents multiple
      //    processing pipelines (process-officer-scan, scan-breaches,
      //    recalculate-compliance) from creating duplicate rows.
      const { data: existingAlert } = await supabase
        .from('breach_alerts')
        .select('id')
        .eq('plate_number', plate)
        .eq('zone_id', zoneId)
        .eq('breach_type', breachType)
        .in('status', ['pending', 'acknowledged', 'enforcement_started'])
        .limit(1)
        .maybeSingle();

      if (existingAlert) {
        console.log('ℹ️ breach_alert already exists for plate/zone/type — skipping', {
          plate, zoneId, breachType, existingAlertId: existingAlert.id,
        });
      } else {
        try {
          await supabase
            .from('breach_alerts')
            .insert({
              observation_id:  observationId,
              plate_number:    plate,
              zone_id:         zoneId,
              organization_id: organizationId,
              breach_type:     breachType,
              breach_details:  {
                breach_reason:            compliance.breachReason,
                violation_reasons:        compliance.violationReasons,
                nights_stayed_this_month: compliance.nightsStayed,
                consecutive_nights:       compliance.consecutiveNights,
                observation_recorded_at:  recordedAt,
                is_self_contained:        nzscv?.isSelfContained ?? false,
                sc_expiry:                nzscv?.selfContainedExpiry ?? null,
                source:                   'process_officer_scan',
                // Discrepancy summary for admin review panel
                discrepancies: discrepancies.length > 0
                  ? discrepancies.map(d => ({
                      type:     d.discrepancy_type,
                      severity: d.severity,
                      source_a: d.source_a,
                      source_b: d.source_b,
                      value_a:  d.value_a,
                      value_b:  d.value_b,
                      note:     (d.details as any)?.note ?? null,
                    }))
                  : undefined,
                sc_law_active: scLawActive,
              },
              status:          'pending',
              created_at:      recordedAt ?? new Date().toISOString(),
            })
            .select()
            .single();
          console.log('🚨 breach_alert created');
        } catch (baErr: any) {
          // ON CONFLICT on (org_id, zone_id, observation_id) is expected
          console.warn('⚠️ breach_alert insert skipped (may already exist):', baErr.message);
        }
      }
    }

    // ── Step 13: Return enriched result ───────────────────────────────────
    const result = {
      success: true,
      observation_id:   observationId,
      plate:            plate,
      plate_confidence: finalConfidence,
      requires_manual_entry: requiresManualEntry,
      pipeline: {
        inference_path: inference.path,
        inference_url_configured: !!INFERENCE_SERVICE_URL,
        alpr_fallback_used: inference.path !== 'railway_inference',
      },
      vehicle: {
        // SC certification — primary purpose of NZSCV lookup
        self_contained:        nzscv?.isSelfContained ?? false,
        self_contained_expiry: nzscv?.selfContainedExpiry ?? null,
        // Optional vehicle detail fields — resolved with source priority
        make:   resolvedMake,
        model:  resolvedModel,
        year:   resolvedYear,
        vin:    nzscv?.vin ?? null,
        colour: resolvedColour,
        color:  resolvedColour,
        orientation: alprOrientation,
        // Attribute source tracking for UI transparency
        attribute_sources: attributeSources,
      },
      movement: {
        is_new_vehicle:             isNewVehicle,
        vehicle_moved:              vehicleMoved,
        plate_mismatch_same_vehicle: plateMismatchSameVehicle,
      },
      compliance: {
        is_compliant:   compliance.isCompliant,
        breach_type:    compliance.breachType,
        breach_reason:  compliance.breachReason,
        is_exempt:      compliance.isExempt,
        exemption_reason: compliance.exemptionReason,
        violations:     compliance.violationReasons,
      },
      // Discrepancy summary — empty array when none detected
      discrepancies: discrepancies.map(d => ({
        type:     d.discrepancy_type,
        location: ((d.details as Record<string, unknown>)?.mismatch_location as string | undefined) ?? `${d.source_a}_vs_${d.source_b}`,
        severity: d.severity,
        source_a: d.source_a,
        source_b: d.source_b,
        value_a:  d.value_a,
        value_b:  d.value_b,
      })),
      mismatch_notices: mismatchNotices,
      has_discrepancies: finalHasDiscrepancies,
      sc_law_active:     scLawActive,
    };

    console.log('✅ process-officer-scan complete', {
      observationId,
      plate,
      inferencePath: inference.path,
      inferenceUrlConfigured: !!INFERENCE_SERVICE_URL,
      isCompliant:       compliance.isCompliant,
      breachType:        compliance.breachType,
      discrepancies:     discrepancies.length,
      criticalDiscrepancies: criticalDiscrepancies.length,
    });

    return jsonResp(result);

  } catch (err: any) {
    console.error('❌ process-officer-scan error:', err.message, err.stack);

    // Best-effort unlock on hard failure so the observation can be retried.
    if (supabase && lockToken && observationIdForCleanup) {
      try {
        await supabase
          .from('observations')
          .update({ plate_number: 'PROCESSING...' })
          .eq('observation_id', observationIdForCleanup)
          .eq('plate_number', lockToken);
      } catch {
        // non-fatal cleanup path
      }
    }

    return jsonResp({ error: err.message || 'Internal server error' }, 500);
  }
});
