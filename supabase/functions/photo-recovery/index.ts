import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { corsHeaders } from '../_shared/cors.ts';
import { alprWithBytes } from '../_shared/alpr.ts';

type RequestPayload = {
  organization_id?: string;
  date_from?: string;
  date_to?: string;
  window_minutes?: number;
  limit?: number;
  apply?: boolean;
  target_bucket?: string;
  parkpow_base_url?: string;
  max_session_pages?: number;
  enforce_alpr_match?: boolean;
  ignore_time_window?: boolean;
};

type ObsRow = Record<string, any>;

type RecoveryResult = {
  observation_key: string;
  plate_number: string;
  recorded_at: string;
  status: 'dry_run' | 'restored' | 'manual_required' | 'skipped' | 'error';
  reason?: string;
  source?: string;
  stored_photo_url?: string;
  photo_hash?: string;
  delta_seconds?: number;
  matched_session_id?: number | null;
  alpr_plate?: string;
  alpr_confidence?: number;
  error?: string;
};

const DEFAULT_BASE_URL = 'https://api.parkpow.com/api/v1';
const DEFAULT_BUCKET = 'evidence';
const DEFAULT_LIMIT = 100;
const DEFAULT_WINDOW_MINUTES = 60;
const DEFAULT_MAX_SESSION_PAGES = 3;
const NZ_TIMEZONE = 'Pacific/Auckland';

const MONTH_INDEX: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function getJwtRole(token: string): string | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]));
    return typeof payload?.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

function toIsoStart(raw?: string): string {
  if (!raw) {
    const d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    return d.toISOString();
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00Z` : raw;
}

function toIsoEnd(raw?: string): string {
  if (!raw) return new Date().toISOString();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T23:59:59Z` : raw;
}

function normalizePlate(input: string | null | undefined): string {
  return String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '').trim();
}

function timezoneOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }

  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );

  return asUtc - date.getTime();
}

function parseNzDisplayTimestamp(raw: string): string | null {
  const text = String(raw || '').trim();
  if (!text) return null;

  const m = text.match(/^([A-Za-z]+)\.?\s+(\d{1,2}),\s*(\d{4}),\s*(\d{1,2}):(\d{2})\s*([ap])\.?m\.?$/i);
  if (!m) return null;

  const monthKey = m[1].toLowerCase();
  const month = MONTH_INDEX[monthKey];
  if (month === undefined) return null;

  const day = Number(m[2]);
  const year = Number(m[3]);
  let hour = Number(m[4]);
  const minute = Number(m[5]);
  const ampm = m[6].toLowerCase();

  if (Number.isNaN(day) || Number.isNaN(year) || Number.isNaN(hour) || Number.isNaN(minute)) {
    return null;
  }

  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;

  if (ampm === 'p' && hour !== 12) hour += 12;
  if (ampm === 'a' && hour === 12) hour = 0;

  const utcGuess = Date.UTC(year, month, day, hour, minute, 0);
  let offset = timezoneOffsetMs(new Date(utcGuess), NZ_TIMEZONE);
  let utcMs = utcGuess - offset;

  // Re-evaluate once to handle DST transitions near boundary times.
  offset = timezoneOffsetMs(new Date(utcMs), NZ_TIMEZONE);
  utcMs = utcGuess - offset;

  return new Date(utcMs).toISOString();
}

function normalizeTimestamp(raw: string | null | undefined): string | null {
  const text = String(raw || '').trim();
  if (!text) return null;

  const direct = Date.parse(text);
  if (!Number.isNaN(direct)) return new Date(direct).toISOString();

  return parseNzDisplayTimestamp(text);
}

function safeFolder(input: string | null | undefined): string {
  const v = (input || 'recovery').trim();
  return v.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64) || 'recovery';
}

function extractPhotoUrl(session: Record<string, unknown>): string | null {
  const startData = session.start_data as Record<string, string> | undefined;
  const endData = session.end_data as Record<string, string> | undefined;
  const visitStartData = session.visit_start_data as Record<string, string> | undefined;
  const visitEndData = session.visit_end_data as Record<string, string> | undefined;

  return (
    (session.photo as string) ||
    (session.start_img as string) ||
    (session.end_img as string) ||
    (session.start_img_plate as string) ||
    (session.end_img_plate as string) ||
    (session.image_url as string) ||
    (session.snapshot_url as string) ||
    (session.plate_image_url as string) ||
    (session.vehicle_image_url as string) ||
    (session.camera_image_url as string) ||
    (session.vehicle_url as string) ||
    (session.source_url as string) ||
    (session.photo_url as string) ||
    startData?.source_url ||
    startData?.image_url ||
    endData?.source_url ||
    endData?.image_url ||
    visitStartData?.photo ||
    visitStartData?.image_url ||
    visitStartData?.source_url ||
    visitEndData?.photo ||
    visitEndData?.image_url ||
    visitEndData?.source_url ||
    ((session.images as Array<Record<string, string>>)?.[0]?.url) ||
    ((session.images as Array<Record<string, string>>)?.[0]?.image_url) ||
    ((session.images as Array<Record<string, string>>)?.[0]?.snapshot_url) ||
    ((session.captures as Array<Record<string, string>>)?.[0]?.image_url) ||
    ((session.captures as Array<Record<string, string>>)?.[0]?.url) ||
    (session.metadata as Record<string, string>)?.image_url ||
    (session.metadata as Record<string, string>)?.snapshot_url ||
    null
  );
}

function normalizePhotoUrl(rawUrl: string | null, parkpowBaseUrl: string): string | null {
  if (!rawUrl) return null;
  const trimmed = String(rawUrl).trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;

  try {
    const base = new URL(parkpowBaseUrl);
    return new URL(trimmed, `${base.origin}/`).toString();
  } catch {
    return null;
  }
}

function pickSessionTimestamp(session: Record<string, unknown>): string | null {
  const visitStartData = session.visit_start_data as Record<string, string> | undefined;
  const visitEndData = session.visit_end_data as Record<string, string> | undefined;

  return (
    (session.visit_timestamp as string) ||
    (session.start_date as string) ||
    (session.end_date as string) ||
    (session.last_spotted as string) ||
    (session.entry_time as string) ||
    (session.start_time as string) ||
    (session.end_time as string) ||
    visitStartData?.timestamp ||
    visitStartData?.time ||
    visitEndData?.timestamp ||
    visitEndData?.time ||
    (session.created_at as string) ||
    (session.time as string) ||
    (session.observed_at as string) ||
    (session.timestamp as string) ||
    null
  );
}

function pickSessionPlate(session: Record<string, unknown>): string | null {
  const vehicle = session.vehicle as Record<string, unknown> | undefined;
  const startData = session.start_data as Record<string, string> | undefined;
  const endData = session.end_data as Record<string, string> | undefined;
  const visitStartData = session.visit_start_data as Record<string, string> | undefined;
  return normalizePlate(
    (vehicle?.license_plate as string) ||
    (vehicle?.plate as string) ||
    startData?.plate ||
    endData?.plate ||
    (session.license_plate as string) ||
    (session.plate_number as string) ||
    (session.plate as string) ||
    (session.vehicle_tag as string) ||
    visitStartData?.license_plate ||
    visitStartData?.plate_number ||
    null,
  ) || null;
}

function getSessionsArray(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.sessions)) return payload.sessions;
  if (Array.isArray(payload?.visits)) return payload.visits;
  return [];
}

function getNextPageUrl(payload: any): string | null {
  const next = payload?.next;
  return typeof next === 'string' && next.trim() ? next.trim() : null;
}

function isSignedStorageUrl(url: string | null | undefined): boolean {
  const v = String(url || '');
  return v.includes('/storage/v1/object/sign/') && v.includes('token=');
}

function isPlaceholderPhotoUrl(url: string | null | undefined): boolean {
  const raw = String(url || '').trim();
  if (!raw) return false;

  const lower = raw.toLowerCase();
  if (lower.includes('blank%20car.jpg') || lower.includes('blank car.jpg')) return true;

  try {
    const decoded = decodeURIComponent(raw).toLowerCase();
    return decoded.includes('blank car.jpg');
  } catch {
    return false;
  }
}

function hasJpgPhotoValue(url: string | null | undefined): boolean {
  const v = String(url || '').trim().toLowerCase();
  if (!v) return false;
  return v.includes('.jpg') || v.includes('.jpeg');
}

function isAlreadyRecoveredPublicUrl(url: string | null | undefined): boolean {
  const v = String(url || '').trim().toLowerCase();
  if (!v) return false;
  return v.includes('/storage/v1/object/public/evidence/recovered/');
}

async function fetchParkPowEntriesForPlate(params: {
  plate: string;
  baseUrl: string;
  token: string;
  maxPages: number;
  recordedAt: string;
  windowSeconds: number;
}): Promise<{
  entries: any[];
  errors: number;
  attempts: number;
  errorSamples: Array<{ endpoint: string; status: number | null; detail?: string }>;
  endpointStats: Record<string, { attempts: number; okResponses: number; responsesWithResults: number; totalResults: number }>;
}> {
  const { plate, baseUrl, token, maxPages, recordedAt, windowSeconds } = params;
  const entries: any[] = [];
  let errors = 0;
  let attempts = 0;
  const errorSamples: Array<{ endpoint: string; status: number | null; detail?: string }> = [];
  const endpointStats: Record<string, { attempts: number; okResponses: number; responsesWithResults: number; totalResults: number }> = {};

  const recEpoch = Date.parse(recordedAt);
  const start = Number.isNaN(recEpoch)
    ? new Date(Date.now() - windowSeconds * 1000).toISOString()
    : new Date(recEpoch - windowSeconds * 1000).toISOString();
  const end = Number.isNaN(recEpoch)
    ? new Date(Date.now() + windowSeconds * 1000).toISOString()
    : new Date(recEpoch + windowSeconds * 1000).toISOString();

  const trimmedBase = baseUrl.replace(/\/$/, '');
  const candidates = [
    // Primary documented endpoint with exact plate filter.
    `${trimmedBase}/visit-list-large/?license_plate=${encodeURIComponent(plate)}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&page_size=100`,
    // Historical fallback without time bounds.
    `${trimmedBase}/visit-list-large/?license_plate=${encodeURIComponent(plate)}&page_size=100`,
    // Hosted docs domain fallback.
    `https://app.parkpow.com/api/v1/visit-list-large/?license_plate=${encodeURIComponent(plate)}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&page_size=100`,
    `https://app.parkpow.com/api/v1/visit-list-large/?license_plate=${encodeURIComponent(plate)}&page_size=100`,
  ];

  const urls = Array.from(new Set(candidates));

  for (const initialUrl of urls) {
    if (!endpointStats[initialUrl]) {
      endpointStats[initialUrl] = { attempts: 0, okResponses: 0, responsesWithResults: 0, totalResults: 0 };
    }

    let nextUrl: string | null = initialUrl;
    let page = 0;

    while (nextUrl && page < maxPages) {
      attempts += 1;
      endpointStats[initialUrl].attempts += 1;
      page += 1;
      let retry429 = 0;

      while (true) {
      const resp = await fetch(nextUrl, {
        headers: {
          Authorization: `Token ${token}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(15000),
      }).catch(() => null);

      if (resp && resp.status === 429 && retry429 < 2) {
        retry429 += 1;
        await new Promise((resolve) => setTimeout(resolve, 1200));
        continue;
      }

      if (!resp || !resp.ok) {
        errors += 1;
        if (errorSamples.length < 20) {
          let detail = 'network error';
          let status: number | null = null;

          if (resp) {
            status = resp.status;
            detail = (await resp.text().catch(() => '')).slice(0, 200) || `HTTP ${resp.status}`;
          }

          errorSamples.push({ endpoint: initialUrl, status, detail });
        }
        nextUrl = null;
        break;
      }

      const payload = await resp.json().catch(() => ({}));
      endpointStats[initialUrl].okResponses += 1;
      const pageEntries = getSessionsArray(payload);
      if (pageEntries.length > 0) {
        endpointStats[initialUrl].responsesWithResults += 1;
        endpointStats[initialUrl].totalResults += pageEntries.length;
      }
      entries.push(...pageEntries);
      nextUrl = getNextPageUrl(payload);
      break;
      }
    }

    if (entries.length > 0) break;
  }

  return { entries, errors, attempts, errorSamples, endpointStats };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function downloadPhotoBytes(url: string, parkpowToken: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const attempts: Array<HeadersInit | undefined> = [
    { Authorization: `Token ${parkpowToken}` },
    undefined,
  ];

  let lastError = 'Download failed';

  for (const headers of attempts) {
    const resp = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(30000),
    }).catch(() => null);

    if (!resp) {
      lastError = 'Download failed: network error';
      continue;
    }

    if (!resp.ok) {
      lastError = `Download failed: HTTP ${resp.status}`;
      continue;
    }

    const bytes = new Uint8Array(await resp.arrayBuffer());
    if (bytes.byteLength === 0) {
      lastError = 'Downloaded image was empty';
      continue;
    }

    const contentType = resp.headers.get('content-type') || 'image/jpeg';
    return { bytes, contentType };
  }

  throw new Error(lastError);
}

async function detectObservationSchema(supabase: ReturnType<typeof createClient>): Promise<{
  keyCol: 'id' | 'observation_id';
  photoCol: 'photo_url' | 'photo';
  hasPhotoHashCol: boolean;
}> {
  const idProbe = await supabase.from('observations').select('id').limit(1);
  const keyCol: 'id' | 'observation_id' = idProbe.error ? 'observation_id' : 'id';

  const photoUrlProbe = await supabase.from('observations').select('photo_url').limit(1);
  const photoCol: 'photo_url' | 'photo' = photoUrlProbe.error ? 'photo' : 'photo_url';

  const hashProbe = await supabase.from('observations').select('photo_hash').limit(1);
  const hasPhotoHashCol = !hashProbe.error;

  return { keyCol, photoCol, hasPhotoHashCol };
}

async function detectRecoveryInfra(supabase: ReturnType<typeof createClient>): Promise<{ hasQueue: boolean; hasAudit: boolean }> {
  const queueProbe = await supabase.from('missing_photo_queue').select('id').limit(1);
  const auditProbe = await supabase.from('photo_recovery_audit_log').select('id').limit(1);
  return { hasQueue: !queueProbe.error, hasAudit: !auditProbe.error };
}

async function audit(
  enabled: boolean,
  supabase: ReturnType<typeof createClient>,
  entry: {
    observation_id: string | null;
    organization_id: string | null;
    plate_number?: string | null;
    recorded_at?: string | null;
    action: string;
    source?: string;
    source_ref?: string;
    success: boolean;
    photo_url?: string | null;
    photo_hash?: string | null;
    photo_bytes?: number | null;
    error_message?: string | null;
    meta?: Record<string, unknown>;
    actor_id?: string | null;
    actor_label?: string;
  },
): Promise<void> {
  if (!enabled) return;

  const { error } = await supabase.from('photo_recovery_audit_log').insert({
    observation_id: entry.observation_id,
    organization_id: entry.organization_id,
    plate_number: entry.plate_number ?? null,
    recorded_at: entry.recorded_at ?? null,
    action: entry.action,
    source: entry.source ?? null,
    source_ref: entry.source_ref ?? null,
    success: entry.success,
    photo_url: entry.photo_url ?? null,
    photo_hash: entry.photo_hash ?? null,
    photo_bytes: entry.photo_bytes ?? null,
    error_message: entry.error_message ?? null,
    meta: entry.meta ?? null,
    actor_id: entry.actor_id ?? null,
    actor_label: entry.actor_label ?? 'system',
  });

  if (error) {
    console.error('[photo-recovery] audit insert failed:', error.message);
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const parkpowToken = Deno.env.get('PARKPOW_API_TOKEN') ?? '';
    const platerecToken = Deno.env.get('PLATERECOGNIZER_TOKEN') ?? Deno.env.get('PLATE_RECOGNIZER_TOKEN') ?? '';

    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      return json(500, { error: 'Supabase env vars missing' });
    }

    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) {
      return json(401, { error: 'Missing authorization header' });
    }
    const token = authHeader.replace('Bearer ', '');

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const body = (await req.json().catch(() => ({}))) as RequestPayload;

    const dateFrom = toIsoStart(body.date_from);
    const dateTo = toIsoEnd(body.date_to);
    const windowSeconds = Math.max(60, Math.min(24 * 3600, (body.window_minutes ?? DEFAULT_WINDOW_MINUTES) * 60));
    const limit = Math.max(1, Math.min(1000, body.limit ?? DEFAULT_LIMIT));
    const apply = body.apply === true;
    const targetBucket = body.target_bucket || DEFAULT_BUCKET;
    const parkpowBaseUrl = (body.parkpow_base_url || DEFAULT_BASE_URL).replace(/\/$/, '');
    const enforceAlprMatch = body.enforce_alpr_match === true;
    const ignoreTimeWindow = body.ignore_time_window === true;
    // This function is intentionally scoped to deleted-photo re-enrichment only.
    // Deleted data can appear as an empty URL or an expired signed storage URL.
    const requireEmptyPhoto = true;
    const maxSessionPages = Math.max(1, Math.min(10, body.max_session_pages ?? DEFAULT_MAX_SESSION_PAGES));

    let profile: { id: string; role: string; organization_id: string | null } | null = null;
    let actorLabel = 'system';

    const { data: authData, error: authError } = await supabaseUser.auth.getUser(token);
    const serviceRoleDryRun = getJwtRole(token) === 'service_role';

    if (!authError && authData?.user) {
      const { data: profileData, error: profileError } = await supabaseAdmin
        .from('user_profiles')
        .select('id, role, organization_id')
        .eq('id', authData.user.id)
        .single();

      if (profileError || !profileData) {
        return json(403, { error: 'User profile not found' });
      }

      if (!['admin', 'master', 'admin_officer'].includes(profileData.role)) {
        return json(403, { error: 'Only admin/master/admin_officer users can run photo recovery' });
      }

      profile = profileData;
      actorLabel = `admin:${authData.user.email ?? profileData.id}`;
    } else if (serviceRoleDryRun) {
      profile = { id: 'service-role', role: 'master', organization_id: null };
      actorLabel = apply ? 'system:service_role_apply' : 'system:service_role_dry_run';
    } else {
      return json(401, { error: 'Unauthorized' });
    }

    const orgId: string | null =
      profile.role === 'master'
        ? (body.organization_id ?? null)
        : (profile.organization_id ?? null);

    const schema = await detectObservationSchema(supabaseAdmin);
    const infra = await detectRecoveryInfra(supabaseAdmin);

    let selectCols = `${schema.keyCol},organization_id,plate_number,recorded_at,recorded_by,${schema.photoCol}`;
    if (schema.hasPhotoHashCol) selectCols += ',photo_hash';

    let obsQuery = supabaseAdmin
      .from('observations')
      .select(selectCols)
      .not('plate_number', 'is', null)
      .gte('recorded_at', dateFrom)
      .lte('recorded_at', dateTo)
      .order('recorded_at', { ascending: true })
      .limit(limit);

    if (orgId) {
      obsQuery = obsQuery.eq('organization_id', orgId);
    }

    const { data: observations, error: obsError } = await obsQuery;
    if (obsError) {
      return json(500, { error: `Failed to load observations: ${obsError.message}` });
    }

    const rows = (observations ?? []) as ObsRow[];

    const candidates = rows.filter((obs) => {
      const photoValue = String(obs[schema.photoCol] || '').trim();
      const hasPhoto = photoValue.length > 0;
      if (isAlreadyRecoveredPublicUrl(photoValue)) return false;
      return !hasPhoto || isPlaceholderPhotoUrl(photoValue) || isSignedStorageUrl(photoValue) || hasJpgPhotoValue(photoValue);
    });

    if (candidates.length === 0) {
      return json(200, {
        success: true,
        message: 'No candidate observations in scope',
        schema,
        infra,
        scanned: rows.length,
        detected: 0,
        auto_restored: 0,
        queued_for_review: 0,
        apply,
      });
    }

    const results: RecoveryResult[] = [];
    let autoRestored = 0;
    let queuedForReview = 0;
    let parkpowErrors = 0;
    let parkpowAttempts = 0;
    let uploadErrors = 0;
    const parkpowErrorSamples: Array<{ endpoint: string; status: number | null; detail?: string }> = [];
    const parkpowEndpointStats: Record<string, { attempts: number; okResponses: number; responsesWithResults: number; totalResults: number }> = {};
    const parkpowVisitShapeSamples: Array<Record<string, unknown>> = [];

    for (const obs of candidates) {
      const obsKey = String(obs[schema.keyCol] || '');
      const plate = normalizePlate(obs.plate_number);
      const recordedAt = String(obs.recorded_at || '');
      const currentPhoto = String(obs[schema.photoCol] || '').trim();
      const reason = !currentPhoto
        ? 'missing_photo'
        : isPlaceholderPhotoUrl(currentPhoto)
          ? 'placeholder_photo'
        : isSignedStorageUrl(currentPhoto)
          ? 'stale_signed_url'
        : hasJpgPhotoValue(currentPhoto)
          ? 'jpg_present_check'
          : 'unknown';

      if (!obsKey || !plate || !recordedAt) {
        continue;
      }

      const result: RecoveryResult = {
        observation_key: obsKey,
        plate_number: plate,
        recorded_at: recordedAt,
        status: 'manual_required',
        reason,
      };

      await audit(infra.hasAudit, supabaseAdmin, {
        observation_id: schema.keyCol === 'id' ? obsKey : null,
        organization_id: obs.organization_id ?? null,
        plate_number: plate,
        recorded_at: recordedAt,
        action: 'detect',
        source: 'system',
        success: true,
        meta: { reason, dry_run: !apply, schema },
        actor_id: profile.id,
        actor_label: actorLabel,
      });

      if (apply && infra.hasQueue && schema.keyCol === 'id') {
        const queueReason = reason === 'stale_signed_url' ? 'object_404' : 'null_url';
        await supabaseAdmin.from('missing_photo_queue').upsert(
          {
            observation_id: obsKey,
            organization_id: obs.organization_id,
            plate_number: plate,
            recorded_at: recordedAt,
            reason: queueReason,
            status: 'repairing',
            attempts: 1,
            last_attempt_at: new Date().toISOString(),
          },
          { onConflict: 'observation_id' },
        );
      }

      if (!apply) {
        result.status = 'dry_run';
        results.push(result);
        continue;
      }

      let recovered = false;

      if (parkpowToken) {
        const fetched = await fetchParkPowEntriesForPlate({
          plate,
          baseUrl: parkpowBaseUrl,
          token: parkpowToken,
          maxPages: maxSessionPages,
          recordedAt,
          windowSeconds,
        });

        const sessions = fetched.entries;
        parkpowErrors += fetched.errors;
        parkpowAttempts += fetched.attempts;
        if (fetched.errorSamples.length > 0 && parkpowErrorSamples.length < 20) {
          parkpowErrorSamples.push(...fetched.errorSamples.slice(0, 20 - parkpowErrorSamples.length));
        }
        for (const [endpoint, s] of Object.entries(fetched.endpointStats)) {
          if (!parkpowEndpointStats[endpoint]) {
            parkpowEndpointStats[endpoint] = { attempts: 0, okResponses: 0, responsesWithResults: 0, totalResults: 0 };
          }
          parkpowEndpointStats[endpoint].attempts += s.attempts;
          parkpowEndpointStats[endpoint].okResponses += s.okResponses;
          parkpowEndpointStats[endpoint].responsesWithResults += s.responsesWithResults;
          parkpowEndpointStats[endpoint].totalResults += s.totalResults;
        }

        if (sessions.length > 0) {
          const recEpoch = Date.parse(recordedAt);
          let best: any = null;
          let bestDelta = Number.MAX_SAFE_INTEGER;
          let usableVisitCandidates = 0;
          let closestDeltaAny = Number.MAX_SAFE_INTEGER;
          let exactPlateSessions = 0;

          for (const s of sessions) {
            const sessionPlate = pickSessionPlate(s);
            if (!sessionPlate || sessionPlate !== plate) continue;
            exactPlateSessions += 1;

            const ts = normalizeTimestamp(pickSessionTimestamp(s));
            const url = normalizePhotoUrl(extractPhotoUrl(s), parkpowBaseUrl);
            if (!ts || !url) continue;
            usableVisitCandidates += 1;
            const sEpoch = Date.parse(ts);
            if (Number.isNaN(sEpoch) || Number.isNaN(recEpoch)) continue;
            const delta = Math.abs(Math.floor((sEpoch - recEpoch) / 1000));
            if (delta < closestDeltaAny) {
              closestDeltaAny = delta;
            }
            if (delta < bestDelta) {
              best = s;
              bestDelta = delta;
            }
          }

          if (best && (ignoreTimeWindow || bestDelta <= windowSeconds)) {
            const matchedPhotoUrl = normalizePhotoUrl(extractPhotoUrl(best), parkpowBaseUrl);
            if (matchedPhotoUrl) {
              try {
                const { bytes: imgBytes, contentType } = await downloadPhotoBytes(matchedPhotoUrl, parkpowToken);

                let alprPlate: string | null = null;
                let alprConf: number | null = null;

                if (platerecToken) {
                  try {
                    const alpr = await alprWithBytes(imgBytes, { regions: 'nz', mmc: false });
                    alprPlate = alpr.plate;
                    alprConf = alpr.confidence;
                  } catch {
                    // ALPR verify is optional
                  }
                }

                const plateMatches =
                  !enforceAlprMatch || !alprPlate || normalizePlate(alprPlate) === plate;

                if (plateMatches) {
                  const folder = safeFolder(obs.recorded_by);
                  const ts = Date.now();
                  const rand = crypto.randomUUID().slice(0, 8);
                  const storagePath = `recovered/${folder}/${ts}-${rand}.jpg`;
                  const hash = await sha256Hex(imgBytes);

                  const { error: uploadError } = await supabaseAdmin.storage
                    .from(targetBucket)
                    .upload(storagePath, imgBytes, { contentType, upsert: false });

                  if (uploadError) {
                    throw new Error(`Storage upload failed: ${uploadError.message}`);
                  }

                  const { data: pubData } = supabaseAdmin.storage
                    .from(targetBucket)
                    .getPublicUrl(storagePath);
                  const storedUrl = pubData.publicUrl;

                  const updateData: Record<string, any> = { [schema.photoCol]: storedUrl };
                  if (schema.hasPhotoHashCol) updateData.photo_hash = hash;

                  const { error: updateError } = await supabaseAdmin
                    .from('observations')
                    .update(updateData)
                    .eq(schema.keyCol, obsKey);

                  if (updateError) {
                    throw new Error(`Observation update failed: ${updateError.message}`);
                  }

                  if (infra.hasQueue && schema.keyCol === 'id') {
                    await supabaseAdmin
                      .from('missing_photo_queue')
                      .update({
                        status: 'fixed',
                        original_photo_url: storedUrl,
                        attempted_hash: schema.hasPhotoHashCol ? hash : null,
                        repair_notes: `Auto-recovered from ParkPow session ${best.id ?? ''} (delta ${bestDelta}s)`,
                      })
                      .eq('observation_id', obsKey);
                  }

                  await audit(infra.hasAudit, supabaseAdmin, {
                    observation_id: schema.keyCol === 'id' ? obsKey : null,
                    organization_id: obs.organization_id ?? null,
                    plate_number: plate,
                    recorded_at: recordedAt,
                    action: 'photo_restored',
                    source: 'parkpow',
                    source_ref: String(best.id ?? ''),
                    success: true,
                    photo_url: storedUrl,
                    photo_hash: schema.hasPhotoHashCol ? hash : null,
                    photo_bytes: imgBytes.byteLength,
                    meta: {
                      delta_seconds: bestDelta,
                      alpr_plate: alprPlate,
                      alpr_confidence: alprConf,
                      storage_path: storagePath,
                    },
                    actor_id: profile.id,
                    actor_label: actorLabel,
                  });

                  result.status = 'restored';
                  result.source = 'parkpow';
                  result.stored_photo_url = storedUrl;
                  result.photo_hash = schema.hasPhotoHashCol ? hash : undefined;
                  result.delta_seconds = bestDelta;
                  result.matched_session_id = typeof best.id === 'number' ? best.id : null;
                  result.alpr_plate = alprPlate ?? undefined;
                  result.alpr_confidence = alprConf ?? undefined;
                  recovered = true;
                  autoRestored++;
                } else {
                  result.reason = `ALPR mismatch: detected ${alprPlate}`;
                }
              } catch (err: any) {
                uploadErrors++;
                result.error = err?.message || 'Apply failed';
              }
            }
          } else {
            if (exactPlateSessions === 0) {
              result.reason = 'No exact ParkPow plate match for observation plate';
            } else if (usableVisitCandidates === 0) {
              result.reason = 'ParkPow visits found but no usable photo/timestamp fields';
              if (sessions.length > 0 && parkpowVisitShapeSamples.length < 5) {
                const sample = sessions[0] as Record<string, unknown>;
                const startData = (sample.start_data as Record<string, unknown>) || {};
                const endData = (sample.end_data as Record<string, unknown>) || {};
                parkpowVisitShapeSamples.push({
                  plate,
                  top_level_keys: Object.keys(sample).slice(0, 40),
                  start_data_keys: Object.keys(startData).slice(0, 30),
                  end_data_keys: Object.keys(endData).slice(0, 30),
                  start_img: String(sample.start_img ?? '').slice(0, 200),
                  end_img: String(sample.end_img ?? '').slice(0, 200),
                  start_img_plate: String(sample.start_img_plate ?? '').slice(0, 200),
                  end_img_plate: String(sample.end_img_plate ?? '').slice(0, 200),
                  start_date: sample.start_date ?? null,
                  end_date: sample.end_date ?? null,
                  last_spotted: sample.last_spotted ?? null,
                  vehicle_shape: typeof sample.vehicle === 'object' && sample.vehicle
                    ? Object.keys(sample.vehicle as Record<string, unknown>).slice(0, 20)
                    : null,
                });
              }
            } else if (bestDelta > windowSeconds) {
              result.reason = `Closest ParkPow visit outside window (${bestDelta}s > ${windowSeconds}s)`;
            }
          }
        } else {
          result.reason = 'No ParkPow visits returned for plate';
        }
      }

      if (!recovered) {
        result.status = 'manual_required';
        queuedForReview++;

        if (apply && infra.hasQueue && schema.keyCol === 'id') {
          await supabaseAdmin
            .from('missing_photo_queue')
            .update({
              status: 'manual_required',
              repair_notes:
                result.reason ||
                (!parkpowToken
                  ? 'PARKPOW_API_TOKEN not configured – manual recovery required'
                  : 'No matching ParkPow session found within time window'),
              last_attempt_at: new Date().toISOString(),
            })
            .eq('observation_id', obsKey);
        }
      }

      results.push(result);
    }

    return json(200, {
      success: true,
      apply,
      schema,
      infra,
      options: {
        date_from: dateFrom,
        date_to: dateTo,
        window_minutes: Math.floor(windowSeconds / 60),
        limit,
        target_bucket: targetBucket,
        organization_id: orgId,
        require_empty_photo: requireEmptyPhoto,
        include_stale_signed_urls: true,
        enforce_alpr_match: enforceAlprMatch,
        ignore_time_window: ignoreTimeWindow,
        parkpow_available: !!parkpowToken,
        alpr_available: !!platerecToken,
      },
      scanned: rows.length,
      detected: candidates.length,
      auto_restored: autoRestored,
      queued_for_review: queuedForReview,
      parkpow_errors: parkpowErrors,
      parkpow_attempts: parkpowAttempts,
      parkpow_error_samples: parkpowErrorSamples,
      parkpow_endpoint_stats: parkpowEndpointStats,
      parkpow_visit_shape_samples: parkpowVisitShapeSamples,
      upload_errors: uploadErrors,
      sample_results: results.slice(0, 50),
    });
  } catch (err: unknown) {
    const msg = (err as Error)?.message ?? 'Internal server error';
    console.error('[photo-recovery] unhandled error:', msg);
    return json(500, { error: msg });
  }
});
