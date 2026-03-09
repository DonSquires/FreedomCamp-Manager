import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.');
}

function clampNumber(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

const BATCH_SIZE = clampNumber(process.env.BATCH_SIZE, 50, 1, 500);
const MAX_ROWS = clampNumber(process.env.MAX_ROWS, 0, 0, 1_000_000);
const CONCURRENCY = clampNumber(process.env.CONCURRENCY, 4, 1, 20);
const DRY_RUN = process.env.DRY_RUN !== '0';
const ORG_ID = process.env.ORG_ID?.trim() || null;
const DATE_FROM = process.env.DATE_FROM?.trim() || null;
const DATE_TO = process.env.DATE_TO?.trim() || null;
const FUNCTION_JWT = process.env.FUNCTION_JWT?.trim() || null;
const FUNCTION_API_KEY = process.env.FUNCTION_API_KEY?.trim() || null;
const INFERENCE_MODE = (process.env.INFERENCE_MODE?.trim().toLowerCase() || 'edge') as 'edge' | 'local';
const LOCAL_INFERENCE_URL = process.env.LOCAL_INFERENCE_URL?.trim() || 'http://localhost:3000';
const LOCAL_TIMEOUT_MS = clampNumber(process.env.LOCAL_TIMEOUT_MS, 60000, 1000, 300000);
const FETCHABLE_ONLY = process.env.FETCHABLE_ONLY === '1';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type Observation = {
  id?: string;
  observation_id?: string;
  plate_number: string | null;
  photo_url?: string | null;
  photo?: string | null;
  recorded_at: string;
  organization_id: string;
};

type ObservationSchema = {
  keyColumn: 'observation_id' | 'id';
  photoColumn: 'photo_url' | 'photo';
  embeddingColumn: 'vehicle_embedding' | 'embedding' | null;
  hasEmbeddingQuality: boolean;
  hasEmbeddingModelVersion: boolean;
  hasEmbeddingCreatedAt: boolean;
};

type LocalInferResponse = {
  success?: boolean;
  data?: {
    embedding?: number[];
    embedding_quality?: number | null;
    embedding_model_version?: string | null;
  };
};

function asObservationId(row: Observation): string {
  return row.observation_id || row.id || '';
}

async function detectSchema(): Promise<ObservationSchema> {
  const probeObsId = await supabase.from('observations').select('observation_id').limit(1);
  const keyColumn: 'observation_id' | 'id' = !probeObsId.error ? 'observation_id' : 'id';

  if (probeObsId.error) {
    const probeId = await supabase.from('observations').select('id').limit(1);
    if (probeId.error) {
      throw new Error('observations table has neither observation_id nor id');
    }
  }

  const probePhotoUrl = await supabase.from('observations').select('photo_url').limit(1);
  const photoColumn: 'photo_url' | 'photo' = probePhotoUrl.error ? 'photo' : 'photo_url';

  const probeEmbeddingQuality = await supabase.from('observations').select('embedding_quality').limit(1);
  const probeEmbeddingModelVersion = await supabase.from('observations').select('embedding_model_version').limit(1);
  const probeEmbeddingCreatedAt = await supabase.from('observations').select('embedding_created_at').limit(1);
  const probeVehicleEmbedding = await supabase.from('observations').select('vehicle_embedding').limit(1);
  const probeEmbedding = await supabase.from('observations').select('embedding').limit(1);

  let embeddingColumn: 'vehicle_embedding' | 'embedding' | null = null;
  if (!probeVehicleEmbedding.error) {
    embeddingColumn = 'vehicle_embedding';
  } else if (!probeEmbedding.error) {
    embeddingColumn = 'embedding';
  }

  return {
    keyColumn,
    photoColumn,
    embeddingColumn,
    hasEmbeddingQuality: !probeEmbeddingQuality.error,
    hasEmbeddingModelVersion: !probeEmbeddingModelVersion.error,
    hasEmbeddingCreatedAt: !probeEmbeddingCreatedAt.error,
  };
}

function buildBaseQuery(schema: ObservationSchema) {
  let query = supabase
    .from('observations')
    .select(`${schema.keyColumn}, plate_number, ${schema.photoColumn}, recorded_at, organization_id`, { count: 'exact' })
    .not('plate_number', 'is', null)
    .not(schema.photoColumn, 'is', null);

  if (ORG_ID) query = query.eq('organization_id', ORG_ID);
  if (DATE_FROM) query = query.gte('recorded_at', DATE_FROM);
  if (DATE_TO) query = query.lte('recorded_at', DATE_TO);

  return query;
}

function normalizePhotoUrl(raw: string): string {
  if (/^https?:\/\//i.test(raw)) return raw;
  const path = raw.replace(/^\/+/, '');
  const { data } = supabase.storage.from('evidence').getPublicUrl(path);
  return data.publicUrl;
}

function parseStorageLocation(raw: string): { bucket: string; path: string } | null {
  const input = raw.trim();
  if (!input) return null;

  // Raw DB values can be stored as evidence/<file>, /evidence/<file>, or storage URLs.
  const normalizePath = (value: string) => value.replace(/^\/+/, '');

  if (/^https?:\/\//i.test(input)) {
    try {
      const url = new URL(input);
      const path = decodeURIComponent(url.pathname);
      const match = path.match(/\/storage\/v1\/object\/(?:public|authenticated|sign)\/([^/]+)\/(.+)$/);
      if (match) {
        return {
          bucket: match[1],
          path: normalizePath(match[2]),
        };
      }

      return null;
    } catch {
      return null;
    }
  }

  const normalized = input.replace(/^\/+/, '');
  const slash = normalized.indexOf('/');
  if (slash > 0) {
    const first = normalized.slice(0, slash);
    const rest = normalized.slice(slash + 1);

    if (/^[A-Za-z0-9 _-]+$/.test(first) && rest) {
      return { bucket: first, path: normalizePath(rest) };
    }
  }

  // Fallback: legacy rows that only store object path are assumed to be in evidence bucket.
  return { bucket: 'evidence', path: normalized.replace(/^evidence\//i, '') };
}

async function downloadObservationPhoto(rawPhoto: string): Promise<{ ok: true; bytes: ArrayBuffer; mimeType: string } | { ok: false; reason: string }> {
  const storageLocation = parseStorageLocation(rawPhoto);
  if (storageLocation) {
    const { data, error } = await supabase.storage
      .from(storageLocation.bucket)
      .download(storageLocation.path);
    if (!error && data) {
      const bytes = await data.arrayBuffer();
      return { ok: true, bytes, mimeType: data.type || 'image/jpeg' };
    }

    if (FETCHABLE_ONLY) {
      return { ok: false, reason: 'skip_unfetchable_storage_object' };
    }

    // If this looked like a storage path/URL but storage download failed, surface that directly.
    if (!/^https?:\/\//i.test(rawPhoto)) {
      return { ok: false, reason: `photo_storage_download_failed:${error?.message || 'unknown'}` };
    }
  }

  if (/^https?:\/\//i.test(rawPhoto)) {
    const resp = await fetch(rawPhoto);
    if (!resp.ok) {
      return { ok: false, reason: `photo_download_http_${resp.status}` };
    }
    const bytes = await resp.arrayBuffer();
    const mimeType = resp.headers.get('content-type') || 'image/jpeg';
    return { ok: true, bytes, mimeType };
  }

  return { ok: false, reason: 'invalid_photo_path' };
}

async function processObservation(
  obs: Observation,
  schema: ObservationSchema,
): Promise<{ ok: boolean; reason?: string }> {
  const plate = String(obs.plate_number || '').trim().toUpperCase();
  const rawPhoto = String(obs.photo_url || obs.photo || '').trim();
  const observationId = asObservationId(obs);
  const photoUrl = rawPhoto ? normalizePhotoUrl(rawPhoto) : '';

  if (!plate || !photoUrl) {
    return { ok: false, reason: 'missing_plate_or_photo' };
  }

  if (DRY_RUN) {
    return { ok: true };
  }

  if (INFERENCE_MODE === 'local') {
    // 1) Download existing observation photo (HTTP URL or authenticated evidence bucket path)
    const photoDownload = await downloadObservationPhoto(rawPhoto);
    if (!photoDownload.ok) {
      if (photoDownload.reason.startsWith('skip_unfetchable_')) {
        return { ok: true };
      }
      return { ok: false, reason: photoDownload.reason };
    }

    const bytes = photoDownload.bytes;
    const fileName = `${observationId || plate || 'observation'}.jpg`;
    const mimeType = photoDownload.mimeType;

    // 2) Send to local inference-service (/infer multipart/form-data)
    const form = new FormData();
    form.append('photo', new Blob([bytes], { type: mimeType }), fileName);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LOCAL_TIMEOUT_MS);
    let inferResp: Response;
    try {
      inferResp = await fetch(`${LOCAL_INFERENCE_URL.replace(/\/$/, '')}/infer`, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!inferResp.ok) {
      const text = await inferResp.text();
      return { ok: false, reason: `local_infer_http_${inferResp.status}:${text.slice(0, 120)}` };
    }

    const inferJson = (await inferResp.json()) as LocalInferResponse;
    const embedding = inferJson?.data?.embedding;
    if (!Array.isArray(embedding) || embedding.length === 0) {
      return { ok: false, reason: 'local_infer_no_embedding' };
    }

    // 3) Update observation embedding fields
    if (!schema.embeddingColumn) {
      // Some live projects do not yet have an embedding column on observations.
      // We still run inference to backfill service activity even if persistence is unavailable.
      return { ok: true };
    }

    const updatePayload: Record<string, unknown> = {
      [schema.embeddingColumn]: embedding,
    };
    if (schema.hasEmbeddingQuality) {
      updatePayload.embedding_quality = inferJson?.data?.embedding_quality ?? null;
    }
    if (schema.hasEmbeddingModelVersion) {
      updatePayload.embedding_model_version = inferJson?.data?.embedding_model_version ?? 'yolov8n_mobilenetv3_v1.0';
    }
    if (schema.hasEmbeddingCreatedAt) {
      updatePayload.embedding_created_at = new Date().toISOString();
    }

    const keyColumn = obs.observation_id ? 'observation_id' : 'id';
    const { error: updateError } = await supabase
      .from('observations')
      .update(updatePayload)
      .eq(keyColumn, observationId);

    if (updateError) {
      return { ok: false, reason: `observation_update_failed:${updateError.message}` };
    }

    return { ok: true };
  }

  // If a user JWT is provided, call the functions endpoint directly with that token.
  // This is required when the Edge Function has verify_jwt=true.
  if (FUNCTION_JWT) {
    const url = `${SUPABASE_URL}/functions/v1/analyze-vehicle-photo`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(FUNCTION_API_KEY ? { apikey: FUNCTION_API_KEY } : {}),
        Authorization: `Bearer ${FUNCTION_JWT}`,
      },
      body: JSON.stringify({
        plateNumber: plate,
        photoUrl,
        vehicleId: plate,
      }),
    });

    if (!response.ok) {
      let message = `HTTP_${response.status}`;
      try {
        const json = await response.json();
        message = json?.message || json?.error || message;
      } catch {
        // ignore json parse errors
      }
      return { ok: false, reason: message };
    }

    return { ok: true };
  }

  const { error } = await supabase.functions.invoke('analyze-vehicle-photo', {
    body: {
      plateNumber: plate,
      photoUrl,
      vehicleId: plate,
    },
  });

  if (error) {
    return { ok: false, reason: error.message || 'invoke_failed' };
  }

  return { ok: true };
}

async function processWithConcurrency(
  rows: Observation[],
  schema: ObservationSchema,
): Promise<{ success: number; failed: number; failures: Array<{ observationId: string; reason: string }> }> {
  let success = 0;
  let failed = 0;
  const failures: Array<{ observationId: string; reason: string }> = [];

  let index = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (index < rows.length) {
      const current = rows[index++];
      const observationId = asObservationId(current);

      const result = await processObservation(current, schema);
      if (result.ok) {
        success++;
      } else {
        failed++;
        failures.push({ observationId, reason: result.reason || 'unknown_error' });
      }
    }
  });

  await Promise.all(workers);
  return { success, failed, failures };
}

async function run(): Promise<void> {
  const schema = await detectSchema();
  const { count, error: countError } = await buildBaseQuery(schema).range(0, 0);
  if (countError) throw countError;

  const totalAvailable = count || 0;
  const totalTarget = MAX_ROWS > 0 ? Math.min(MAX_ROWS, totalAvailable) : totalAvailable;

  console.log('--- Reprocess Observation Inference ---');
  console.log(`DRY_RUN=${DRY_RUN ? '1' : '0'}`);
  console.log(`ORG_ID=${ORG_ID || 'ALL'}`);
  console.log(`DATE_FROM=${DATE_FROM || 'NONE'}`);
  console.log(`DATE_TO=${DATE_TO || 'NONE'}`);
  console.log(`BATCH_SIZE=${BATCH_SIZE}`);
  console.log(`CONCURRENCY=${CONCURRENCY}`);
  console.log(`INFERENCE_MODE=${INFERENCE_MODE}`);
  if (INFERENCE_MODE === 'local') {
    console.log(`LOCAL_INFERENCE_URL=${LOCAL_INFERENCE_URL}`);
  }
  console.log(`TOTAL_AVAILABLE=${totalAvailable}`);
  console.log(`TOTAL_TARGET=${totalTarget}`);

  let processed = 0;
  let success = 0;
  let failed = 0;

  while (processed < totalTarget) {
    const remaining = totalTarget - processed;
    const currentBatchSize = Math.min(BATCH_SIZE, remaining);

    const { data, error } = await buildBaseQuery(schema)
      .order('recorded_at', { ascending: false })
      .range(processed, processed + currentBatchSize - 1);

    if (error) throw error;

    const rows = (data || []) as Observation[];
    if (rows.length === 0) break;

    const batchResult = await processWithConcurrency(rows, schema);
    processed += rows.length;
    success += batchResult.success;
    failed += batchResult.failed;

    console.log(`Batch done: processed=${processed}/${totalTarget}, success=${success}, failed=${failed}`);

    if (batchResult.failures.length > 0) {
      const sample = batchResult.failures.slice(0, 5);
      for (const failure of sample) {
        console.warn(`  failure observation=${failure.observationId} reason=${failure.reason}`);
      }
    }
  }

  console.log('--- Complete ---');
  console.log(`Processed: ${processed}`);
  console.log(`Success: ${success}`);
  console.log(`Failed: ${failed}`);
}

run().catch((error) => {
  console.error('Reprocess failed:', error);
  process.exit(1);
});
