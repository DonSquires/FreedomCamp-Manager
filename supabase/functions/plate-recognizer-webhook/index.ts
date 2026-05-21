import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3';
import { getCorsHeaders } from '../_shared/withCors.ts';

type AnyObj = Record<string, unknown>;
type ResolvedImage = { bytes: Uint8Array; contentType: string; source: string };

function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
  });
}

function sanitize(value: string, fallback: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[_\-.]+|[_\-.]+$/g, '');
  return (cleaned || fallback).slice(0, 80);
}

function base64ToBytes(raw: string): Uint8Array {
  const binary = atob(raw);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function parseDataUri(value: string): { bytes: Uint8Array; contentType: string } | null {
  const m = value.match(/^data:([^;]+);base64,(.+)$/i);
  if (!m) return null;
  return { bytes: base64ToBytes(m[2]), contentType: m[1] || 'image/jpeg' };
}

function looksLikeBase64(value: string): boolean {
  if (value.length < 128) return false;
  return /^[A-Za-z0-9+/=\s]+$/.test(value);
}

function firstString(obj: AnyObj, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function extractPlate(payload: AnyObj): string {
  const direct = firstString(payload, ['plate', 'license_plate', 'plate_number']);
  if (direct) return direct.toUpperCase().replace(/\s+/g, '');

  const results = payload.results;
  if (Array.isArray(results) && results.length > 0) {
    const first = results[0];
    if (first && typeof first === 'object') {
      const plate = firstString(first as AnyObj, ['plate', 'license_plate']);
      if (plate) return plate.toUpperCase().replace(/\s+/g, '');
    }
  }

  return 'UNKNOWN';
}

function extractTimestamp(payload: AnyObj): string {
  const raw = firstString(payload, ['timestamp', 'created_at', 'created', 'time']);
  if (!raw) return new Date().toISOString();
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function extractLatLon(payload: AnyObj): { lat: number | null; lon: number | null } {
  const candidates: Array<[unknown, unknown]> = [
    [payload['gps_latitude'], payload['gps_longitude']],
    [payload['latitude'], payload['longitude']],
  ];

  const location = payload['location'];
  if (location && typeof location === 'object') {
    const loc = location as AnyObj;
    candidates.push([loc['latitude'], loc['longitude']]);
    candidates.push([loc['lat'], loc['lng']]);
  }

  for (const [latRaw, lonRaw] of candidates) {
    const lat = typeof latRaw === 'number' ? latRaw : Number(latRaw);
    const lon = typeof lonRaw === 'number' ? lonRaw : Number(lonRaw);
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
  }

  return { lat: null, lon: null };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function resolveImage(payload: AnyObj): Promise<ResolvedImage | null> {
  const imageField = firstString(payload, ['upload', 'image', 'upload_url', 'image_url', 'snapshot_url', 'photo_url']);
  if (!imageField) return null;

  const asDataUri = parseDataUri(imageField);
  if (asDataUri) return { ...asDataUri, source: 'data-uri' };

  if (imageField.startsWith('http://') || imageField.startsWith('https://')) {
    const resp = await fetch(imageField, { signal: AbortSignal.timeout(30000) }).catch(() => null);
    if (!resp || !resp.ok) return null;
    const bytes = new Uint8Array(await resp.arrayBuffer());
    if (!bytes.byteLength) return null;
    return {
      bytes,
      contentType: resp.headers.get('content-type') || 'image/jpeg',
      source: 'remote-url',
    };
  }

  if (looksLikeBase64(imageField)) {
    try {
      return { bytes: base64ToBytes(imageField.replace(/\s+/g, '')), contentType: 'image/jpeg', source: 'base64' };
    } catch {
      return null;
    }
  }

  return null;
}

async function parsePayload(req: Request): Promise<{ payload: AnyObj; preloadedImage: ResolvedImage | null }> {
  const contentType = req.headers.get('content-type') || '';

  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData();
    const payload: AnyObj = {};
    let preloadedImage: ResolvedImage | null = null;

    for (const [key, value] of form.entries()) {
      if (value instanceof File) {
        if ((key === 'upload' || key === 'image') && value.size > 0) {
          preloadedImage = {
            bytes: new Uint8Array(await value.arrayBuffer()),
            contentType: value.type || 'image/jpeg',
            source: 'multipart-file',
          };
        }
        payload[key] = value.name;
      } else {
        payload[key] = String(value);
      }
    }

    const config = payload['config'];
    if (typeof config === 'string') {
      try {
        payload['config'] = JSON.parse(config);
      } catch {
        // Keep original string if not valid JSON.
      }
    }

    return { payload, preloadedImage };
  }

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const body = await req.text();
    const params = new URLSearchParams(body);
    const payload: AnyObj = {};
    for (const [k, v] of params.entries()) payload[k] = v;
    return { payload, preloadedImage: null };
  }

  const jsonBody = await req.json().catch(() => null);
  if (jsonBody && typeof jsonBody === 'object') {
    return { payload: jsonBody as AnyObj, preloadedImage: null };
  }

  return { payload: {}, preloadedImage: null };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'Method not allowed' });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const webhookSecret = Deno.env.get('PLATE_RECOGNIZER_WEBHOOK_SECRET') ?? '';

    if (!supabaseUrl || !serviceRoleKey) return json(req, 500, { error: 'Supabase env vars missing' });

    if (webhookSecret) {
      const authHeader = req.headers.get('authorization') ?? '';
      const provided = authHeader.replace(/^Bearer\s+/i, '').trim() || (req.headers.get('x-webhook-secret') ?? '').trim();
      if (provided !== webhookSecret) return json(req, 401, { error: 'Unauthorized' });
    }

    const { payload, preloadedImage } = await parsePayload(req);
    if (!payload || typeof payload !== 'object' || Object.keys(payload).length === 0) {
      return json(req, 400, { error: 'Invalid or empty payload' });
    }

    const organizationId =
      (req.headers.get('x-org-id') ?? '').trim() ||
      String(payload['organization_id'] ?? '').trim() ||
      (Deno.env.get('DEFAULT_ORG_ID') ?? '').trim() ||
      (Deno.env.get('BOB_ORG_ID') ?? '').trim();

    if (!organizationId) {
      return json(req, 400, { error: 'organization_id missing (send x-org-id header, payload.organization_id, or set DEFAULT_ORG_ID)' });
    }

    const image = preloadedImage || (await resolveImage(payload));
    if (!image) return json(req, 400, { error: 'No usable image found in payload' });

    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

    const plate = extractPlate(payload);
    const ts = extractTimestamp(payload);
    const recordId = String(payload['uuid'] ?? payload['id'] ?? crypto.randomUUID());
    const dt = new Date(ts);
    const month = Number.isNaN(dt.getTime()) ? 'unknown' : dt.toISOString().slice(0, 7);
    const stamp = Number.isNaN(dt.getTime()) ? Date.now().toString() : dt.toISOString().replace(/[:.]/g, '').replace(/[-]/g, '').slice(0, 15) + 'Z';

    const ext = image.contentType.includes('png') ? '.png' : image.contentType.includes('webp') ? '.webp' : '.jpg';
    const storagePath = `snapshot-webhook/${month}/${stamp}_${sanitize(plate, 'unknown')}_${sanitize(recordId, 'record')}${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('evidence')
      .upload(storagePath, image.bytes, { contentType: image.contentType, upsert: false });
    if (uploadError) return json(req, 500, { error: `Storage upload failed: ${uploadError.message}` });

    const hash = await sha256Hex(image.bytes);
    const { lat, lon } = extractLatLon(payload);

    const record: AnyObj = {
      organization_id: organizationId,
      storage_path: storagePath,
      storage_bucket: 'evidence',
      file_hash: hash,
      file_size: image.bytes.byteLength,
      exif_capture_timestamp: ts,
      gps_latitude: lat,
      gps_longitude: lon,
      inferred_region: null,
      inferred_branch_id: null,
      inferred_loi_id: null,
      priority_band: lat !== null && lon !== null ? 'P0' : 'P2',
      ingest_action: lat !== null && lon !== null ? 'ingest_to_branch_pipeline' : 'run_ocr_and_filename_enrichment',
      ingest_status: 'queued',
      indexed_at: new Date().toISOString(),
      source_system: 'plate_recognizer_webhook',
      source_record_id: recordId,
      source_metadata: payload,
    };

    let { error: insertError } = await supabase.from('evidence_index').insert(record);
    let metadataMode: 'evidence_index' | 'storage_sidecar' = 'evidence_index';
    if (insertError) {
      // Backward compatibility where source_* columns are not present yet.
      const fallback: AnyObj = {
        ...record,
        ingestion_error_message: JSON.stringify({
          source_system: 'plate_recognizer_webhook',
          source_record_id: recordId,
          source_metadata: payload,
        }),
      };
      delete fallback.source_system;
      delete fallback.source_record_id;
      delete fallback.source_metadata;
      const retry = await supabase.from('evidence_index').insert(fallback);
      insertError = retry.error;
    }

    if (insertError) {
      const message = String(insertError.message || '');
      const evidenceTableMissing = message.includes("Could not find the table 'public.evidence_index'")
        || message.includes('relation "public.evidence_index" does not exist')
        || message.includes('schema cache');

      if (!evidenceTableMissing) {
        return json(req, 500, { error: `Evidence index insert failed: ${insertError.message}` });
      }

      // As a safe fallback, keep full metadata in storage even when evidence_index is not available.
      const sidecarPath = storagePath.replace(/\.[A-Za-z0-9]+$/, '') + '.metadata.json';
      const sidecarPayload = {
        organization_id: organizationId,
        storage_path: storagePath,
        storage_bucket: 'evidence',
        source_system: 'plate_recognizer_webhook',
        source_record_id: recordId,
        plate,
        captured_at: ts,
        gps_latitude: lat,
        gps_longitude: lon,
        payload,
      };

      const { error: sidecarError } = await supabase.storage
        .from('evidence')
        .upload(sidecarPath, new TextEncoder().encode(JSON.stringify(sidecarPayload, null, 2)), {
          contentType: 'application/json',
          upsert: true,
        });

      if (sidecarError) {
        return json(req, 500, {
          error: `Evidence index missing and sidecar metadata upload failed: ${sidecarError.message}`,
        });
      }

      metadataMode = 'storage_sidecar';
    }

    return json(req, 200, {
      success: true,
      storage_path: storagePath,
      metadata_mode: metadataMode,
      organization_id: organizationId,
      plate,
      source_record_id: recordId,
      image_source: image.source,
      bytes: image.bytes.byteLength,
    });
  } catch (err: any) {
    console.error('❌ plate-recognizer-webhook error:', err);
    return json(req, 500, { success: false, error: err?.message || 'Internal error' });
  }
});
