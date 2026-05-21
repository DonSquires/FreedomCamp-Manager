import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3';
import { getCorsHeaders } from '../_shared/withCors.ts';

type ArchiveRequest = {
  organization_id: string;
  source?: 'sessions' | 'visits' | 'vehicles' | 'snapshot';
  bucket?: string;
  since?: string;
  until?: string;
  since_param?: string;
  until_param?: string;
  base_url?: string;
  max_pages?: number;
  page_size?: number;
  apply?: boolean;
  upsert?: boolean;
};

type ArchiveSummary = {
  success: boolean;
  source: string;
  bucket: string;
  apply: boolean;
  scanned: number;
  with_images: number;
  uploaded: number;
  indexed: number;
  skipped_existing: number;
  skipped_no_image: number;
  failed: number;
  errors: Array<{ record_id?: string; error: string }>;
};

const DEFAULT_PARKPOW_BASE_URL = 'https://app.parkpow.com/api/v1';
const DEFAULT_BUCKET = 'evidence';
const DEFAULT_SOURCE = 'snapshot';
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 25;

function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
  });
}

function extractPhotoUrl(row: Record<string, unknown>): string | null {
  const direct = [
    'image_url',
    'snapshot_url',
    'photo_url',
    'vehicle_image_url',
    'plate_image_url',
    'camera_image_url',
  ];
  for (const key of direct) {
    const v = row[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }

  const listKeys = ['images', 'captures', 'snapshots'];
  for (const listKey of listKeys) {
    const arr = row[listKey];
    if (Array.isArray(arr)) {
      for (const item of arr) {
        if (item && typeof item === 'object') {
          const candidate = item as Record<string, unknown>;
          for (const key of ['url', 'image_url', 'snapshot_url', 'photo_url']) {
            const v = candidate[key];
            if (typeof v === 'string' && v.trim()) return v.trim();
          }
        }
      }
    }
  }

  const meta = row['metadata'];
  if (meta && typeof meta === 'object') {
    const candidate = meta as Record<string, unknown>;
    for (const key of ['image_url', 'snapshot_url', 'photo_url']) {
      const v = candidate[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
  }

  return null;
}

function getTimestamp(row: Record<string, unknown>): string {
  for (const key of ['entry_time', 'created', 'created_at', 'time', 'timestamp']) {
    const v = row[key];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return new Date().toISOString();
}

function sanitize(value: string, fallback: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[_\-.]+|[_\-.]+$/g, '');
  return (cleaned || fallback).slice(0, 80);
}

function extFromContentType(url: string, contentType: string): string {
  const match = url.match(/\.(jpg|jpeg|png|webp|gif|bmp)(\?|$)/i);
  if (match?.[1]) return `.${match[1].toLowerCase()}`;
  const ct = contentType.toLowerCase();
  if (ct.includes('png')) return '.png';
  if (ct.includes('webp')) return '.webp';
  if (ct.includes('gif')) return '.gif';
  return '.jpg';
}

function normalizePhotoUrl(rawUrl: string): string {
  const baseUrl = (Deno.env.get('PARKPOW_BASE_URL') || DEFAULT_PARKPOW_BASE_URL).replace(/\/$/, '');
  if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) return rawUrl;
  return new URL(rawUrl, `${baseUrl}/`).toString();
}

function resolveSourcePath(source: string): string {
  if (source === 'snapshot') return 'plate-reader/';
  if (source === 'sessions') return 'sessions/';
  if (source === 'visits') return 'visits/';
  if (source === 'vehicles') return 'vehicles/';
  return `${source.replace(/^\/+|\/+$/g, '')}/`;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function downloadPhoto(url: string, parkpowToken: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const attempts: Array<HeadersInit | undefined> = [
    { Authorization: `Token ${parkpowToken}` },
    undefined,
  ];

  let lastError = 'Download failed';
  for (const headers of attempts) {
    const resp = await fetch(url, { headers, signal: AbortSignal.timeout(30000) }).catch(() => null);
    if (!resp) {
      lastError = 'Network error downloading photo';
      continue;
    }
    if (!resp.ok) {
      lastError = `HTTP ${resp.status} downloading photo`;
      continue;
    }
    const bytes = new Uint8Array(await resp.arrayBuffer());
    if (!bytes.byteLength) {
      lastError = 'Downloaded image was empty';
      continue;
    }
    const contentType = resp.headers.get('content-type') || 'image/jpeg';
    return { bytes, contentType };
  }

  throw new Error(lastError);
}

async function fetchPage(url: string, parkpowToken: string): Promise<{ results: Array<Record<string, unknown>>; next: string | null }> {
  const resp = await fetch(url, {
    headers: {
      Authorization: `Token ${parkpowToken}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(30000),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`ParkPow API ${resp.status}: ${body.slice(0, 400)}`);
  }

  const payload = await resp.json().catch(() => ({}));
  const results = Array.isArray(payload?.results)
    ? payload.results.filter((r: unknown) => r && typeof r === 'object') as Array<Record<string, unknown>>
    : [];
  const nextValue = typeof payload?.next === 'string' && payload.next.trim() ? payload.next.trim() : null;
  const next = nextValue ? new URL(nextValue, url).toString() : null;
  return { results, next };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) });
  }
  if (req.method !== 'POST') {
    return json(req, 405, { error: 'Method not allowed' });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const parkpowToken = Deno.env.get('PARKPOW_API_TOKEN') ?? '';

    if (!supabaseUrl || !serviceRoleKey) {
      return json(req, 500, { error: 'Supabase env vars missing' });
    }
    if (!parkpowToken) {
      return json(req, 503, { error: 'PARKPOW_API_TOKEN not configured in Supabase secrets' });
    }
    const body = (await req.json().catch(() => ({}))) as ArchiveRequest;
    const organizationId = String(body.organization_id || '').trim();
    if (!organizationId) {
      return json(req, 400, { error: 'organization_id is required' });
    }

    const source = body.source || DEFAULT_SOURCE;
    const bucket = body.bucket || DEFAULT_BUCKET;
    const apply = body.apply === true;
    const upsert = body.upsert === true;
    const pageSize = Math.max(1, Math.min(200, body.page_size ?? DEFAULT_PAGE_SIZE));
    const maxPages = Math.max(1, Math.min(200, body.max_pages ?? DEFAULT_MAX_PAGES));

    const sinceParam = body.since_param || (source === 'snapshot' ? 'timestamp__gt' : 'created__gt');
    const untilParam = body.until_param || (source === 'snapshot' ? 'timestamp__lte' : 'created__lte');

    const params = new URLSearchParams({ limit: String(pageSize) });
    if (body.since) params.set(sinceParam, body.since);
    if (body.until) params.set(untilParam, body.until);
    const baseUrl = (body.base_url || Deno.env.get('PARKPOW_BASE_URL') || DEFAULT_PARKPOW_BASE_URL).replace(/\/$/, '');
    const sourcePath = resolveSourcePath(source);
    let pageUrl = `${baseUrl}/${sourcePath}?${params.toString()}`;

    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

    const summary: ArchiveSummary = {
      success: true,
      source,
      bucket,
      apply,
      scanned: 0,
      with_images: 0,
      uploaded: 0,
      indexed: 0,
      skipped_existing: 0,
      skipped_no_image: 0,
      failed: 0,
      errors: [],
    };

    let page = 0;
    while (pageUrl && page < maxPages) {
      page += 1;
      const { results, next } = await fetchPage(pageUrl, parkpowToken);
      pageUrl = next;

      for (const row of results) {
        summary.scanned += 1;

        const photoUrlRaw = extractPhotoUrl(row);
        if (!photoUrlRaw) {
          summary.skipped_no_image += 1;
          continue;
        }
        summary.with_images += 1;

        const recordId = String(row['id'] ?? 'unknown');
        const plate = sanitize(String(row['license_plate'] ?? 'unknown'), 'unknown');
        const timestamp = getTimestamp(row);
        const dt = new Date(timestamp);
        const month = Number.isNaN(dt.getTime()) ? 'unknown' : dt.toISOString().slice(0, 7);

        try {
          const photoUrl = normalizePhotoUrl(photoUrlRaw);
          const { bytes, contentType } = await downloadPhoto(photoUrl, parkpowToken);
          const hash = await sha256Hex(bytes);
          const ext = extFromContentType(photoUrl, contentType);
          const stamp = Number.isNaN(dt.getTime()) ? Date.now().toString() : dt.toISOString().replace(/[:.]/g, '').replace(/[-]/g, '').slice(0, 15) + 'Z';
          const storagePath = `parkpow-archive/${source}/${month}/${stamp}_${plate}_${sanitize(recordId, 'record')}${ext}`;

          const { data: existing } = await supabase
            .from('evidence_index')
            .select('id')
            .eq('storage_path', storagePath)
            .maybeSingle();

          if (existing) {
            summary.skipped_existing += 1;
            continue;
          }

          if (!apply) {
            continue;
          }

          const { error: uploadError } = await supabase.storage
            .from(bucket)
            .upload(storagePath, bytes, {
              contentType,
              upsert,
            });

          if (uploadError) {
            throw new Error(`Storage upload failed: ${uploadError.message}`);
          }

          summary.uploaded += 1;

          const gpsLat = row['gps_latitude'] ?? row['latitude'] ?? null;
          const gpsLon = row['gps_longitude'] ?? row['longitude'] ?? null;
          const hasGps = typeof gpsLat === 'number' && typeof gpsLon === 'number';

          const indexRecord = {
            organization_id: organizationId,
            storage_path: storagePath,
            storage_bucket: bucket,
            file_hash: hash,
            file_size: bytes.byteLength,
            exif_capture_timestamp: Number.isNaN(dt.getTime()) ? null : dt.toISOString(),
            gps_latitude: hasGps ? gpsLat : null,
            gps_longitude: hasGps ? gpsLon : null,
            inferred_region: null,
            inferred_branch_id: null,
            inferred_loi_id: null,
            priority_band: hasGps ? 'P0' : 'P2',
            ingest_action: hasGps ? 'ingest_to_branch_pipeline' : 'run_ocr_and_filename_enrichment',
            ingest_status: 'queued',
            indexed_at: new Date().toISOString(),
            source_system: 'parkpow',
            source_record_id: recordId,
            source_metadata: row,
          };

          let { error: insertError } = await supabase.from('evidence_index').insert(indexRecord);
          if (insertError) {
            // Fallback for environments that do not yet have source_* metadata columns.
            const legacyRecord = {
              ...indexRecord,
              ingestion_error_message: JSON.stringify({
                source_system: 'parkpow',
                source_record_id: recordId,
                source_metadata: row,
              }),
            } as Record<string, unknown>;
            delete legacyRecord.source_system;
            delete legacyRecord.source_record_id;
            delete legacyRecord.source_metadata;

            const retry = await supabase.from('evidence_index').insert(legacyRecord);
            insertError = retry.error;
          }

          if (insertError) {
            throw new Error(`Evidence index insert failed: ${insertError.message}`);
          }

          summary.indexed += 1;
        } catch (err: any) {
          summary.failed += 1;
          if (summary.errors.length < 50) {
            summary.errors.push({ record_id: recordId, error: err?.message || 'Unknown error' });
          }
        }
      }
    }

    return json(req, 200, summary);
  } catch (err: any) {
    console.error('❌ parkpow-photo-archive error:', err);
    return json(req, 500, { success: false, error: err?.message || 'Internal error' });
  }
});
