/**
 * ALPR Process — 3-Stage Plate Recognition Pipeline
 *
 * Stage 1: Plate Recognizer  (PLATERECOGNIZER_TOKEN — primary, highest accuracy)
 * Stage 2: Railway /infer    (INFERENCE_SERVICE_URL — vehicle embedding + plate fallback)
 * Stage 3: MANUAL_REQUIRED  (zero-failure guarantee)
 *
 * Flow (UPDATE mode — triggered by FieldOfficerPortal after fast observation save):
 *   1. Frontend uploads photo → scans bucket, saves observation (status=pending)
 *   2. Frontend fire-and-forgets POST /alpr-process { observation_id, photo_url }
 *   3. This function downloads photo, runs 3-stage pipeline, writes plate + embedding back
 *
 * Flow (CREATE mode — legacy, direct insert):
 *   Validates fields, deduplicates, runs pipeline, inserts observation.
 *
 * Uses SERVICE_ROLE_KEY to bypass RLS for system operations.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3';
import { withCors, jsonResponse, errorResponse, getCorsHeaders } from '../_shared/withCors.ts';
import { alprWithBytes } from '../_shared/alpr.ts';
import { requireAuth } from '../_shared/requireAuth.ts';

// API Configuration
const RAILWAY_INFERENCE_URL = Deno.env.get('INFERENCE_SERVICE_URL');
const PHOTO_FETCH_TIMEOUT_MS = Number(Deno.env.get('ALPR_PHOTO_FETCH_TIMEOUT_MS') ?? '8000');

function parseStorageLocation(raw: string): { bucket: string; path: string } | null {
  const input = String(raw || '').trim();
  if (!input) return null;

  // Match Supabase storage URLs:
  // /storage/v1/object/public/<bucket>/<path>
  // /storage/v1/object/sign/<bucket>/<path>
  // /storage/v1/object/authenticated/<bucket>/<path>
  if (/^https?:\/\//i.test(input)) {
    try {
      const url = new URL(input);
      const decodedPath = decodeURIComponent(url.pathname);
      const m = decodedPath.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/);
      if (!m) return null;
      return { bucket: m[1], path: m[2].replace(/^\/+/, '') };
    } catch {
      return null;
    }
  }

  // Direct bucket/path input support: "scans/<file>" or "evidence/<file>"
  const cleaned = input.replace(/^\/+/, '');
  const slashIndex = cleaned.indexOf('/');
  if (slashIndex <= 0) return null;

  const bucket = cleaned.slice(0, slashIndex);
  const path = cleaned.slice(slashIndex + 1).replace(/^\/+/, '');
  if (!bucket || !path) return null;

  return { bucket, path };
}

async function downloadPhotoBytes(
  supabase: ReturnType<typeof createClient>,
  photoRef: string,
): Promise<{ bytes: Uint8Array; mimeType: string; source: string }> {
  const storageLocation = parseStorageLocation(photoRef);

  // Prefer service-role storage download when the URL/path points to Supabase storage.
  if (storageLocation) {
    const { data, error } = await supabase.storage
      .from(storageLocation.bucket)
      .download(storageLocation.path);

    if (!error && data) {
      const bytes = new Uint8Array(await data.arrayBuffer());
      return {
        bytes,
        mimeType: data.type || 'image/jpeg',
        source: `storage:${storageLocation.bucket}`,
      };
    }

    console.warn('⚠️ Storage download failed, falling back to HTTP fetch:', {
      bucket: storageLocation.bucket,
      path: storageLocation.path,
      error: error?.message,
    });
  }

  const response = await fetch(photoRef, {
    signal: AbortSignal.timeout(PHOTO_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Failed to download photo: HTTP ${response.status}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    bytes,
    mimeType: response.headers.get('content-type') || 'image/jpeg',
    source: 'http',
  };
}

interface ALPRRequest {
  // MODE 1: Update existing observation (Background Processing)
  observation_id?: string; // If provided, update existing observation
  
  // MODE 2: Create new observation (Legacy mode)
  officerId?: string;
  organizationId?: string;
  zoneId?: string;
  idempotencyKey?: string;
  gpsLatitude?: number;
  gpsLongitude?: number;
  gpsAccuracy?: number;
  recordedAt?: string;
  
  // SHARED: Photo evidence
  photo_url: string;
  photo_hash?: string;
  
  // OPTIONAL: Context for movement comparison
  incident_id?: string;
  previous_observation_id?: string;
  
  // OPTIONAL: Configuration
  regions?: string[];
  mmc?: boolean;
  officerNotes?: string;
  weatherConditions?: string;
}

interface VehicleDetails {
  make?: string;
  model?: string;
  color?: string;
  type?: string;
}

interface InferenceSticker {
  presence: boolean | null;   // null = inconclusive
  color: 'blue' | 'green' | 'unknown';
  bbox?: { x: number; y: number; width: number; height: number };
  detection_confidence?: number;
  color_confidence?: number;
}

interface InferenceMovement {
  moved: boolean | null;      // null = not yet run
  background_similarity?: number;
  vehicle_bbox_iou?: number;
  decision?: string;
}

interface ALPRResponse {
  success: boolean;
  observation_id?: string;
  plate?: string;
  confidence?: number;
  stage?: 'platerecognizer' | 'railway' | 'manual';
  vehicle?: {
    make?: string;
    model?: string;
    color?: string;
    type?: string;
    make_confidence?: number;
    model_confidence?: number;
    color_confidence?: number;
  };
  sticker?: InferenceSticker;
  movement?: InferenceMovement;
  is_compliant?: boolean;
  error?: string;
  warnings?: string[];
}

function isMissingIdempotencyColumnError(error: unknown): boolean {
  const message =
    typeof error === 'string'
      ? error
      : (error as any)?.message || (error as any)?.error || '';

  return /idempotency_key/i.test(String(message))
    && /schema cache|does not exist|column/i.test(String(message));
}

/**
 * Extracts the name of a missing column from a PostgREST schema-cache error
 * message of the form:
 *   "Could not find the '<column>' column of '<table>' in the schema cache"
 * Returns null when the error is not of this form.
 */
function extractMissingSchemaColumn(error: unknown): string | null {
  const message =
    typeof error === 'string'
      ? error
      : (error as any)?.message || (error as any)?.error || '';
  const match = String(message).match(/Could not find the '([^']+)' column/i);
  return match ? match[1] : null;
}

/**
 * Detects COALESCE type mismatch errors from database triggers.
 * These occur when the trigger function expects INTEGER but the column is TEXT.
 * Error pattern: "COALESCE types integer and text cannot be matched"
 */
function isCoalesceTypeMismatchError(error: unknown): boolean {
  const message =
    typeof error === 'string'
      ? error
      : (error as any)?.message || (error as any)?.error || '';
  return /coalesce types .* integer and text cannot be matched/i.test(String(message));
}

/**
 * Columns that may cause COALESCE type mismatch errors in triggers when
 * the column types have drifted. These are safe to omit from the payload
 * (the trigger function will use defaults).
 */
const COMPLIANCE_DRIFT_COLUMNS = new Set([
  'nights_stayed_this_month',
  'consecutive_nights',
  'is_compliant',
  'self_contained',
  'breach_type',
  'breach_reason',
]);

/**
 * Optional AI inference columns that may not yet be present in the PostgREST
 * schema cache when the migration adding them has not been applied (or the
 * cache has not been refreshed).  These columns are safe to drop from the
 * INSERT / UPDATE payload and retry — the observation is still recorded with
 * core fields; the AI enrichment can be re-run once the schema is up to date.
 */
const OPTIONAL_INFERENCE_COLUMNS = new Set([
  'plate_confidence',
  'vehicle_make_confidence',
  'vehicle_model_confidence',
  'vehicle_color_confidence',
  'sticker_presence',
  'sticker_color',
  'sticker_bbox',
  'sticker_detection_confidence',
  'sticker_color_confidence',
  'movement_moved',
  'movement_background_similarity',
  'movement_vehicle_bbox_iou',
  'movement_decision',
  'incident_id',
  'previous_observation_id',
  'processing_status',
  'processing_started_at',
  'processing_completed_at',
  'processing_error',
  'vehicle_embedding',
  'embedding_quality',
  'embedding_model_version',
  'embedding_created_at',
  // NZSCV registry fields for vehicle mismatch detection
  'nzscv_certificate_status',
  'nzscv_certificate_issue_date',
  'vehicle_vin',
  'vehicle_max_occupants',
  'nzscv_logo_url',
  'nzscv_checked_at',
]);

/**
 * Perform a .update() on the observations table, adaptively dropping optional
 * inference columns that the schema cache does not yet know about, until the
 * update succeeds or only required columns remain.
 */
async function adaptiveObservationUpdate(
  supabase: ReturnType<typeof createClient>,
  key: string,
  id: string,
  data: Record<string, any>,
  dropped: string[] = [],
  coalesceRetried: boolean = false,
): Promise<{ data: any; error: any; droppedColumns: string[] }> {
  const { data: result, error } = await supabase
    .from('observations')
    .update(data)
    .eq(key, id)
    .select('*')
    .single();

  if (!error) return { data: result, error: null, droppedColumns: dropped };

  // Handle missing schema column errors
  const missingCol = extractMissingSchemaColumn(error);
  if (missingCol && OPTIONAL_INFERENCE_COLUMNS.has(missingCol) && (missingCol in data)) {
    console.warn(`⚠️ Schema cache missing column '${missingCol}' — dropping from UPDATE and retrying`);
    const next = { ...data };
    delete next[missingCol];
    return adaptiveObservationUpdate(supabase, key, id, next, [...dropped, missingCol], coalesceRetried);
  }

  // Handle COALESCE type mismatch errors (trigger expects INTEGER but column is TEXT)
  // Remove compliance-related columns and let the trigger use defaults
  if (!coalesceRetried && isCoalesceTypeMismatchError(error)) {
    console.warn('⚠️ COALESCE type mismatch detected — dropping compliance columns and retrying');
    const next = { ...data };
    const droppedForCoalesce: string[] = [];
    for (const col of COMPLIANCE_DRIFT_COLUMNS) {
      if (col in next) {
        delete next[col];
        droppedForCoalesce.push(col);
      }
    }
    if (droppedForCoalesce.length > 0) {
      return adaptiveObservationUpdate(supabase, key, id, next, [...dropped, ...droppedForCoalesce], true);
    }
  }

  return { data: null, error, droppedColumns: dropped };
}

/**
 * Perform an .insert() on the observations table, adaptively dropping optional
 * inference columns that the schema cache does not yet know about, until the
 * insert succeeds or only required columns remain.
 */
async function adaptiveObservationInsert(
  supabase: ReturnType<typeof createClient>,
  data: Record<string, any>,
  dropped: string[] = [],
  coalesceRetried: boolean = false,
): Promise<{ data: any; error: any; droppedColumns: string[] }> {
  const { data: result, error } = await supabase
    .from('observations')
    .insert(data)
    .select('*')
    .single();

  if (!error) return { data: result, error: null, droppedColumns: dropped };

  // Handle missing schema column errors
  const missingCol = extractMissingSchemaColumn(error);
  if (missingCol && OPTIONAL_INFERENCE_COLUMNS.has(missingCol) && (missingCol in data)) {
    console.warn(`⚠️ Schema cache missing column '${missingCol}' — dropping from INSERT and retrying`);
    const next = { ...data };
    delete next[missingCol];
    return adaptiveObservationInsert(supabase, next, [...dropped, missingCol], coalesceRetried);
  }

  // Handle COALESCE type mismatch errors (trigger expects INTEGER but column is TEXT)
  // Remove compliance-related columns and let the trigger use defaults
  if (!coalesceRetried && isCoalesceTypeMismatchError(error)) {
    console.warn('⚠️ COALESCE type mismatch detected — dropping compliance columns and retrying');
    const next = { ...data };
    const droppedForCoalesce: string[] = [];
    for (const col of COMPLIANCE_DRIFT_COLUMNS) {
      if (col in next) {
        delete next[col];
        droppedForCoalesce.push(col);
      }
    }
    if (droppedForCoalesce.length > 0) {
      return adaptiveObservationInsert(supabase, next, [...dropped, ...droppedForCoalesce], true);
    }
  }

  return { data: null, error, droppedColumns: dropped };
}

Deno.serve(async (req) => {
  // ============================================================================
  // STEP 1: CORS PREFLIGHT
  // ============================================================================
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) });
  }

  const requestStartTime = Date.now();
  const warnings: string[] = [];

  // Declared outside the try block so the catch can clean up a stuck observation.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );
  // Tracks an observation_id that has been marked 'processing' so the catch
  // block can flip it to 'failed' if an unhandled exception aborts the pipeline.
  let processingObservationId: string | null = null;
  let processingObservationKey: 'observation_id' | 'id' = 'observation_id';

  // ============================================================================
  // STEP 2: AUTHENTICATE REQUEST
  // ============================================================================
  const authResult = await requireAuth(req);
  if (!authResult.user) {
    return new Response(
      JSON.stringify({ success: false, error: authResult.error ?? 'Unauthorized' }),
      { status: 401, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    );
  }

  try {
    let supportsIdempotencyKeyColumn = true;

    // ==========================================================================
    // STEP 3: VALIDATE REQUEST PAYLOAD
    // ==========================================================================
    const body: ALPRRequest = await req.json();

    const isUpdateMode = !!body.observation_id;

    console.log('📍 ALPR Request:', {
      mode: isUpdateMode ? 'UPDATE' : 'CREATE',
      observation_id: body.observation_id,
      photo_url: body.photo_url,
    });

    // Validate required fields
    if (!body.photo_url) {
      return new Response(
        JSON.stringify({ success: false, error: 'photo_url is required' }),
        { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    if (!isUpdateMode) {
      // CREATE mode validation
      if (!body.officerId || !body.organizationId || !body.zoneId || !body.idempotencyKey) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'Missing required identity fields (CREATE mode)',
            required: ['officerId', 'organizationId', 'zoneId', 'idempotencyKey']
          }),
          { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        );
      }

      if (body.gpsLatitude === undefined || body.gpsLongitude === undefined) {
        return new Response(
          JSON.stringify({ success: false, error: 'GPS coordinates required' }),
          { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        );
      }

      // Check for duplicate (best effort; tolerate deployments where schema cache
      // does not currently expose observations.idempotency_key).
      const { data: existingObs, error: duplicateCheckError } = await supabase
        .from('observations')
        .select('*')
        .eq('idempotency_key', body.idempotencyKey)
        .maybeSingle();

      if (duplicateCheckError && isMissingIdempotencyColumnError(duplicateCheckError)) {
        supportsIdempotencyKeyColumn = false;
        warnings.push('idempotency_key unavailable in schema cache; duplicate pre-check skipped');
        console.warn('⚠️ observations.idempotency_key unavailable during duplicate pre-check:', duplicateCheckError.message);
      } else if (duplicateCheckError) {
        throw duplicateCheckError;
      }

      if (existingObs) {
        console.log('⚠️ Duplicate observation detected:', body.idempotencyKey);
        // Live schema: observation_id is the canonical PK
        return new Response(
          JSON.stringify({
            success: true,
            duplicate: true,
            observation_id: existingObs.observation_id ?? existingObs.id,
            plate: existingObs.plate_number,
            is_compliant: existingObs.is_compliant,
          }),
          { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        );
      }
    } else {
      // UPDATE mode validation
      // Live schema: observation_id is the NOT NULL primary key, id is nullable
      // Try observation_id first (canonical PK), then id as fallback
      let existingObs: any | null = null;
      let obsError: any = null;
      let observationKey: 'observation_id' | 'id' = 'observation_id';

      // Try observation_id first (the actual PK in live DB)
      {
        const r = await supabase
          .from('observations')
          .select('*')
          .eq('observation_id', body.observation_id)
          .maybeSingle();
        if (r.data) {
          existingObs = r.data;
          observationKey = 'observation_id';
        } else {
          obsError = r.error;
        }
      }

      // Fallback to id column if observation_id lookup failed
      if (!existingObs) {
        const r = await supabase
          .from('observations')
          .select('*')
          .eq('id', body.observation_id)
          .maybeSingle();
        if (r.data) {
          existingObs = r.data;
          observationKey = 'id';
        } else if (!obsError) {
          obsError = r.error;
        }
      }

      if (obsError || !existingObs) {
        return new Response(
          JSON.stringify({ success: false, error: 'Observation not found' }),
          { status: 404, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        );
      }

      // Use the canonical observation_id from the row, falling back to id
      const existingObservationId = existingObs.observation_id ?? existingObs.id;

      // Idempotency: if ALPR has already run (embedding_created_at is set), skip reprocessing
      if (existingObs.embedding_created_at) {
        console.log('⚠️ Observation already processed (embedding_created_at set):', existingObservationId);
        return new Response(
          JSON.stringify({ success: true, already_processed: true }),
          { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        );
      }

      // Track so the outer catch can log the failure observation.
      processingObservationId = existingObservationId;
      processingObservationKey = observationKey;
    }

    const photoHash = body.photo_hash || `sha256-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    // ==========================================================================
    // STEP 5: DOWNLOAD PHOTO FROM STORAGE
    // ==========================================================================
    console.log('📥 Downloading photo from:', body.photo_url);

    const photoDownload = await downloadPhotoBytes(supabase, body.photo_url);

    const photoBlob = new Blob([photoDownload.bytes], { type: photoDownload.mimeType });
    console.log('✅ Photo downloaded:', {
      size_bytes: photoBlob.size,
      type: photoBlob.type,
      source: photoDownload.source,
    });

    let plateNumber: string | null = null;
    let plateConfidence = 0;
    let vehicle: ALPRResponse['vehicle'] = {};
    let stage: ALPRResponse['stage'] = 'manual';

    // Convert blob to bytes once — shared by Stage 1 (bytes) and Stage 2 (Blob)
    const photoBytes = photoDownload.bytes;

    // ==========================================================================
    // STAGE 1: PLATE RECOGNIZER (Primary — cloud ALPR, highest accuracy)
    // Env var: PLATERECOGNIZER_TOKEN  (or PLATE_RECOGNIZER_TOKEN as fallback)
    // ==========================================================================
    try {
      console.log('🔍 Stage 1: Plate Recognizer...');
      const alprResult = await alprWithBytes(photoBytes, {
        regions: Array.isArray(body.regions) ? body.regions.join(',') : 'nz',
        mmc: body.mmc ?? true,
      });

      if (alprResult.plate) {
        plateNumber = alprResult.plate; // already uppercased by helper
        plateConfidence = alprResult.confidence ?? 0;
        stage = 'platerecognizer';
        console.log('✅ Stage 1 Success:', { plate: plateNumber, confidence: plateConfidence });
      } else {
        console.log('⚠️ Stage 1: No plate detected by Plate Recognizer');
        if (alprResult.raw?.error) {
          warnings.push(`Plate Recognizer: ${alprResult.raw.error}`);
        } else {
          warnings.push('Plate Recognizer: no plate detected');
        }
      }
    } catch (error: any) {
      console.error('❌ Stage 1 Exception:', error.message);
      warnings.push(`Plate Recognizer exception: ${error.message}`);
    }

    // ==========================================================================
    // STAGE 2: RAILWAY INFERENCE SERVICE (vehicle embedding + plate fallback)
    // Endpoint: POST /infer  (multipart/form-data with "photo" field)
    // Returns:  { success, data: { embedding[], embedding_quality, detection: { confidence },
    //             sticker: { presence, color, bbox, detection_confidence, color_confidence },
    //             movement: { moved, background_similarity, vehicle_bbox_iou, decision } } }
    // Plate extraction only available when OPENAI_API_KEY is set on Railway.
    // ==========================================================================
    let vehicleEmbedding: number[] | null = null;
    let embeddingQuality: number | null = null;
    let inferSticker: InferenceSticker | null = null;
    let inferMovement: InferenceMovement | null = null;

    if (RAILWAY_INFERENCE_URL) {
      try {
        console.log('🚂 Stage 2: Railway Inference Service /infer ...');

        const inferForm = new FormData();
        inferForm.append('photo', new Blob([photoBytes], { type: 'image/jpeg' }), 'photo.jpg');

        const railwayResponse = await fetch(`${RAILWAY_INFERENCE_URL}/infer`, {
          method: 'POST',
          body: inferForm,
          signal: AbortSignal.timeout(8000), // 8-second cap — prevent edge fn timeout
        });

        if (railwayResponse.ok) {
          const railwayData = await railwayResponse.json();

          if (railwayData.success && railwayData.data) {
            const inferData = railwayData.data;

            // Always store embedding for visual vehicle matching
            if (inferData.embedding && Array.isArray(inferData.embedding)) {
              vehicleEmbedding = inferData.embedding;
              embeddingQuality = inferData.embedding_quality ?? null;
              if (stage !== 'platerecognizer') {
                // Only use Railway confidence when Plate Recognizer didn't fire
                plateConfidence = inferData.detection?.confidence ?? 0.5;
                stage = 'railway';
              }
              console.log('✅ Stage 2: embedding stored, detection confidence:', inferData.detection?.confidence);
            } else {
              warnings.push('Railway Inference returned no embedding');
            }

            // Use Railway plate only if Stage 1 didn't find one
            if (!plateNumber && inferData.plate_number && inferData.plate_number !== 'UNKNOWN') {
              plateNumber = inferData.plate_number.toUpperCase();
              plateConfidence = inferData.detection?.confidence ?? 0.5;
              stage = 'railway';
              console.log('✅ Stage 2: plate from Railway:', plateNumber);
            }

            // Vehicle make/model/colour (Railway provides if OPENAI_API_KEY set)
            if (inferData.vehicle_make || inferData.vehicle_model) {
              vehicle = {
                make: inferData.vehicle_make,
                model: inferData.vehicle_model,
                color: inferData.vehicle_colour,
                make_confidence: inferData.vehicle_make_confidence ?? undefined,
                model_confidence: inferData.vehicle_model_confidence ?? undefined,
                color_confidence: inferData.vehicle_colour_confidence ?? undefined,
              };
            }

            // Sticker detection (v1 self-contained sticker)
            if (inferData.sticker) {
              const s = inferData.sticker;
              inferSticker = {
                // Tri-state: null (inference sent null/undefined) = inconclusive → force review
                // false = sticker confirmed absent; true = sticker confirmed present
                presence: s.presence !== undefined ? s.presence : null,
                // Guard against non-string or unexpected enum values from inference service
                color: typeof s.color === 'string' && ['blue', 'green'].includes(s.color) ? s.color as 'blue' | 'green' : 'unknown',
                bbox: s.bbox ?? undefined,
                detection_confidence: s.detection_confidence ?? undefined,
                color_confidence: s.color_confidence ?? undefined,
              };
              console.log('✅ Stage 2: sticker data received:', inferSticker);
            }

            // Movement comparison (set by inference when previous_observation_id supplied)
            if (inferData.movement) {
              const m = inferData.movement;
              inferMovement = {
                // Tri-state: null = comparison not run; false = stationary; true = moved
                moved: m.moved !== undefined ? m.moved : null,
                background_similarity: m.background_similarity ?? undefined,
                vehicle_bbox_iou: m.vehicle_bbox_iou ?? undefined,
                decision: m.decision ?? undefined,
              };
              console.log('✅ Stage 2: movement data received:', inferMovement);
            }
          } else {
            console.log('⚠️ Stage 2: No vehicle detected in photo');
            warnings.push('Railway Inference: no vehicle detected');
          }
        } else {
          console.error('❌ Stage 2 Error:', railwayResponse.status);
          warnings.push(`Railway Inference error: ${railwayResponse.status}`);
        }
      } catch (error: any) {
        console.error('❌ Stage 2 Exception:', error.message);
        warnings.push(`Railway Inference exception: ${error.message}`);
      }
    } else {
      warnings.push('INFERENCE_SERVICE_URL not configured');
    }

    // ==========================================================================
    // STAGE 3: MANUAL ENTRY FALLBACK (Zero-Failure Guarantee)
    // ==========================================================================
    if (!plateNumber) {
      console.log('⚠️ Stages 1+2 found no plate — flagging for manual entry');
      plateNumber = 'MANUAL_REQUIRED';
      stage = 'manual';
      warnings.push('AI detection failed - manual plate entry required');
    }

    // ==========================================================================
    // STEP 7: CREATE OR UPDATE OBSERVATION
    // ==========================================================================
    let observation: any;

    if (isUpdateMode) {
      // UPDATE MODE: Update existing observation with AI results
      // Only write columns that exist in the live observations schema.
      const updateData: Record<string, any> = {
        plate_number: plateNumber,
        vehicle_make: vehicle.make || null,
        vehicle_model: vehicle.model || null,
        vehicle_color: vehicle.color || null,
      };

      // Optional incident context supplied by caller (column exists in live DB)
      if (body.incident_id) updateData.incident_id = body.incident_id;

      // Store vehicle embedding when inference service provided one (columns exist in live DB)
      if (vehicleEmbedding) {
        updateData.vehicle_embedding = vehicleEmbedding;
        updateData.embedding_quality = embeddingQuality;
        updateData.embedding_model_version = 'yolov8n_mobilenetv3_v1.0';
        updateData.embedding_created_at = new Date().toISOString();
      }

      // NOTE: plate_confidence, sticker_*, movement_*, processing_status, previous_observation_id
      // do NOT exist in the live observations table. The adaptiveObservationUpdate will strip
      // any extras via schema-cache error handling, but we don't write them here to avoid retries.

      console.log('💾 Updating observation:', {
        observation_id: body.observation_id,
        plate: updateData.plate_number,
        stage,
      });

      const {
        data: updatedObs,
        error: updateError,
        droppedColumns: updateDropped,
      } = await adaptiveObservationUpdate(
        supabase,
        processingObservationKey,
        processingObservationId!,
        updateData,
      );

      if (updateDropped.length > 0) {
        warnings.push(`Schema cache missing columns (UPDATE) — dropped: ${updateDropped.join(', ')}`);
        console.warn('⚠️ UPDATE succeeded after dropping columns:', updateDropped);
      }

      if (updateError) {
        console.error('❌ Database UPDATE failed:', updateError);
        
        // Log failure but don't try to write non-existent processing_status columns
        console.error('❌ UPDATE failed, observation stuck in PROCESSING... state:', processingObservationId);

        return new Response(
          JSON.stringify({
            success: false,
            error: 'Database error: ' + updateError.message,
          }),
          { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        );
      }

      observation = updatedObs;

    } else {
      // CREATE MODE: Insert new observation
      // Only write columns that exist in the live observations schema.
      const observationData = {
        recorded_by: body.officerId,
        organization_id: body.organizationId,
        zone_id: body.zoneId,
        photo: body.photo_url,     // primary photo column in live schema
        photo_url: body.photo_url, // secondary photo column for compatibility
        photo_hash: photoHash,
        plate_number: plateNumber,
        gps_latitude: body.gpsLatitude,
        gps_longitude: body.gpsLongitude,
        gps_accuracy: body.gpsAccuracy || null,
        recorded_at: body.recordedAt || new Date().toISOString(),
        officer_notes: body.officerNotes || null,
        vehicle_make: vehicle.make || null,
        vehicle_model: vehicle.model || null,
        vehicle_color: vehicle.color || null,
        incident_id: body.incident_id ?? null,
        // Provide compliance defaults to avoid COALESCE type mismatch in triggers
        nights_stayed_this_month: 0,
        consecutive_nights: 0,
        is_compliant: true,
        self_contained: false,
      };

      const insertPayload = supportsIdempotencyKeyColumn
        ? { ...observationData, idempotency_key: body.idempotencyKey }
        : observationData;

      console.log('💾 Creating observation:', {
        plate: observationData.plate_number,
        stage,
      });

      const {
        data: newObs,
        error: obsError,
        droppedColumns: insertDropped,
      } = await adaptiveObservationInsert(supabase, insertPayload);

      if (insertDropped.length > 0) {
        warnings.push(`Schema cache missing columns (INSERT) — dropped: ${insertDropped.join(', ')}`);
        console.warn('⚠️ INSERT succeeded after dropping columns:', insertDropped);
      }

      if (obsError) {
        console.error('❌ Database INSERT failed:', obsError);
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Database error: ' + obsError.message,
          }),
          { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        );
      }

      observation = newObs;
    }

    // ==========================================================================
    // STEP 8: SUCCESS RESPONSE
    // ==========================================================================
    const responseTime = Date.now() - requestStartTime;
    
    // Live schema: observation_id is the canonical PK
    console.log('✅ Observation created:', {
      observation_id: observation.observation_id ?? observation.id,
      plate: observation.plate_number,
      stage,
      response_time_ms: responseTime
    });

    const response: ALPRResponse = {
      success: true,
      observation_id: observation.observation_id ?? observation.id,
      plate: plateNumber,
      confidence: plateConfidence,
      stage,
      vehicle,
      sticker: inferSticker ?? undefined,
      movement: inferMovement ?? undefined,
      is_compliant: observation.is_compliant,
      warnings: warnings.length > 0 ? warnings : undefined,
    };

    return new Response(
      JSON.stringify(response),
      { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ ALPR Pipeline Failed:', error);

    // If we already marked this observation as 'processing', flip it to 'failed'
    // Log that this observation ID had a pipeline failure.
    // Note: processing_status/processing_error do not exist in the live schema.
    if (processingObservationId) {
      console.error('❌ ALPR pipeline failed for observation:', processingObservationId, '—', error.message);
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Internal server error',
        stack: error.stack,
      }),
      { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    );
  }
});
