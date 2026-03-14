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
  require_empty_photo?: boolean;
  include_stale_signed_urls?: boolean;
  max_session_pages?: number;
  snapshot_dashboard_url?: string;
  snapshot_prefetch_pages?: number;
};

type ObsRow = Record<string, any>;

type RecoveryResult = {
  observation_key: string;
  plate_number: string;
  recorded_at: string;
  existing_photo_url?: string;
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

const DEFAULT_BASE_URL = 'https://app.parkpow.com/api/v1';
const DEFAULT_BUCKET = 'evidence';
const DEFAULT_LIMIT = 100;
const DEFAULT_WINDOW_MINUTES = 60;
const DEFAULT_MAX_SESSION_PAGES = 3;
const MAX_WINDOW_SECONDS = 365 * 24 * 3600;
const DEFAULT_SNAPSHOT_DASHBOARD_URL = 'https://app.platerecognizer.com/service/snapshot-cloud/dashboard/';
const DEFAULT_SNAPSHOT_PREFETCH_PAGES = 5;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
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
  return String(input || '').toUpperCase().replace(/\s+/g, '').trim();
}

function safeFolder(input: string | null | undefined): string {
  const v = (input || 'recovery').trim();
  return v.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64) || 'recovery';
}

function extractPhotoUrl(session: Record<string, unknown>): string | null {
  return (
    (session.image_url as string) ||
    (session.snapshot_url as string) ||
    (session.plate_image_url as string) ||
    (session.vehicle_image_url as string) ||
    (session.camera_image_url as string) ||
    (session.photo_url as string) ||
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
  return (
    (session.entry_time as string) ||
    (session.created_at as string) ||
    (session.time as string) ||
    (session.observed_at as string) ||
    (session.timestamp as string) ||
    null
  );
}

function getSessionsArray(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.sessions)) return payload.sessions;
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

async function downloadPublicPhotoBytes(url: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(30000),
  }).catch(() => null);

  if (!resp || !resp.ok) {
    throw new Error(`Download failed: ${resp ? `HTTP ${resp.status}` : 'network error'}`);
  }

  const bytes = new Uint8Array(await resp.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw new Error('Downloaded image was empty');
  }

  return {
    bytes,
    contentType: resp.headers.get('content-type') || 'image/jpeg',
  };
}

function parseSetCookieValue(setCookieHeader: string | null, cookieName: string): string | null {
  if (!setCookieHeader) return null;
  const parts = setCookieHeader.split(/,\s*(?=[^;]+=[^;]+)/g);
  for (const c of parts) {
    const m = c.match(new RegExp(`${cookieName}=([^;]+)`));
    if (m?.[1]) return m[1];
  }
  return null;
}

function normalizeSnapshotTime(input: string): string {
  return input
    .replace(/\u00a0/g, ' ')
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseSnapshotTime(input: string): number | null {
  const normalized = normalizeSnapshotTime(input)
    .replace(/\ba\s*m\b/i, 'AM')
    .replace(/\bp\s*m\b/i, 'PM');
  const epoch = Date.parse(normalized);
  return Number.isNaN(epoch) ? null : epoch;
}

type SnapshotListingMatch = {
  imageUrl: string;
  imagePath: string;
  rowTimeText: string;
  deltaSeconds: number;
};

type SnapshotSession = {
  origin: string;
  csrftoken: string;
  sessionId: string;
};

type SnapshotCatalogItem = {
  imageUrl: string;
  imagePath: string;
  rowTimeText: string;
  rowEpoch: number | null;
};

async function loginSnapshotSession(
  dashboardUrl: string,
  email: string,
  password: string,
): Promise<SnapshotSession> {
  const dashboard = new URL(dashboardUrl);
  const loginUrl = `${dashboard.origin}/accounts/login/?next=/service/snapshot-cloud/dashboard/`;

  const loginGet = await fetch(loginUrl, {
    signal: AbortSignal.timeout(20000),
  }).catch(() => null);

  if (!loginGet || !loginGet.ok) {
    throw new Error('Snapshot login page unavailable');
  }

  const loginHtml = await loginGet.text();
  const csrfMatch = loginHtml.match(/name="csrfmiddlewaretoken"\s+value="([^"]+)"/i);
  const csrf = csrfMatch?.[1] ?? null;
  const csrftoken = parseSetCookieValue(loginGet.headers.get('set-cookie'), 'csrftoken');
  if (!csrf || !csrftoken) {
    throw new Error('Snapshot login CSRF not found');
  }

  const form = new URLSearchParams();
  form.set('csrfmiddlewaretoken', csrf);
  form.set('login', email);
  form.set('password', password);
  form.set('next', '/service/snapshot-cloud/dashboard/');

  const loginPost = await fetch(loginUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: loginUrl,
      Cookie: `csrftoken=${csrftoken}`,
    },
    body: form.toString(),
    redirect: 'manual',
    signal: AbortSignal.timeout(20000),
  }).catch(() => null);

  if (!loginPost) {
    throw new Error('Snapshot login failed: network error');
  }

  const sessionId = parseSetCookieValue(loginPost.headers.get('set-cookie'), 'sessionid');
  if (!sessionId) {
    throw new Error('Snapshot login failed: no session');
  }

  return {
    origin: dashboard.origin,
    csrftoken,
    sessionId,
  };
}

function parseSnapshotCatalogFromHtml(html: string, origin: string): SnapshotCatalogItem[] {
  const rows: SnapshotCatalogItem[] = [];
  const rowRe = /<tr>[\s\S]*?<td>([^<]+)<\/td>[\s\S]*?<a href="(\/object-storage\/[^"\n]+)"[\s\S]*?<\/tr>/gi;

  for (const m of html.matchAll(rowRe)) {
    const rowTimeText = String(m[1] || '').trim();
    const imagePath = String(m[2] || '').trim();
    if (!rowTimeText || !imagePath) continue;
    rows.push({
      imageUrl: new URL(imagePath, `${origin}/`).toString(),
      imagePath,
      rowTimeText,
      rowEpoch: parseSnapshotTime(rowTimeText),
    });
  }

  return rows;
}

async function fetchSnapshotCatalog(
  dashboardUrl: string,
  session: SnapshotSession,
  maxPages: number,
): Promise<SnapshotCatalogItem[]> {
  const out: SnapshotCatalogItem[] = [];
  const seenUrls = new Set<string>();

  for (let page = 1; page <= maxPages; page++) {
    const pageUrl = new URL(dashboardUrl);
    if (page > 1) pageUrl.searchParams.set('page', String(page));

    const resp = await fetch(pageUrl.toString(), {
      headers: {
        Cookie: `csrftoken=${session.csrftoken}; sessionid=${session.sessionId}`,
      },
      signal: AbortSignal.timeout(20000),
    }).catch(() => null);

    if (!resp || !resp.ok) break;
    const html = await resp.text();
    const rows = parseSnapshotCatalogFromHtml(html, session.origin);
    if (rows.length === 0) break;

    let added = 0;
    for (const r of rows) {
      if (seenUrls.has(r.imageUrl)) continue;
      seenUrls.add(r.imageUrl);
      out.push(r);
      added++;
    }

    if (added === 0) break;
  }

  return out;
}

async function lookupSnapshotImageByPlate(
  dashboardUrl: string,
  session: SnapshotSession,
  plate: string,
  recordedAtIso: string,
  windowSeconds: number,
): Promise<SnapshotListingMatch | null> {
  const dashboard = new URL(dashboardUrl);
  dashboard.searchParams.set('result', plate.toLowerCase());
  const dashboardResp = await fetch(dashboard.toString(), {
    headers: {
      Cookie: `csrftoken=${session.csrftoken}; sessionid=${session.sessionId}`,
    },
    signal: AbortSignal.timeout(20000),
  }).catch(() => null);

  if (!dashboardResp || !dashboardResp.ok) {
    throw new Error(`Snapshot dashboard lookup failed${dashboardResp ? `: HTTP ${dashboardResp.status}` : ': network error'}`);
  }

  const html = await dashboardResp.text();
  const rowRe = /<tr>[\s\S]*?<td>([^<]+)<\/td>[\s\S]*?<a href="(\/object-storage\/[^"\n]+)"[\s\S]*?<\/tr>/gi;

  const recEpoch = Date.parse(recordedAtIso);
  if (Number.isNaN(recEpoch)) return null;

  let best: SnapshotListingMatch | null = null;
  for (const m of html.matchAll(rowRe)) {
    const rowTimeText = String(m[1] || '').trim();
    const imagePath = String(m[2] || '').trim();
    if (!rowTimeText || !imagePath) continue;

    const rowEpoch = parseSnapshotTime(rowTimeText);
    if (!rowEpoch) continue;
    const deltaSeconds = Math.abs(Math.floor((rowEpoch - recEpoch) / 1000));
    if (deltaSeconds > windowSeconds) continue;

    const imageUrl = new URL(imagePath, `${dashboard.origin}/`).toString();
    if (!best || deltaSeconds < best.deltaSeconds) {
      best = { imageUrl, imagePath, rowTimeText, deltaSeconds };
    }
  }

  return best;
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
    const snapshotLoginEmail = Deno.env.get('SNAPSHOT_LOGIN_EMAIL') ?? '';
    const snapshotLoginPassword = Deno.env.get('SNAPSHOT_LOGIN_PASSWORD') ?? '';

    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      return json(500, { error: 'Supabase env vars missing' });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const authHeader = req.headers.get('Authorization') ?? '';
    let profile: { id: string; role: string; organization_id: string | null } | null = null;
    let actorLabel = 'system:no-auth';

    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '');
      const supabaseUser = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });

      const { data: authData, error: authError } = await supabaseUser.auth.getUser(token);
      if (authError || !authData?.user) {
        return json(401, { error: 'Unauthorized' });
      }

      const { data: loadedProfile, error: profileError } = await supabaseAdmin
        .from('user_profiles')
        .select('id, role, organization_id')
        .eq('id', authData.user.id)
        .single();

      if (profileError || !loadedProfile) {
        return json(403, { error: 'User profile not found' });
      }

      if (!['admin', 'master', 'admin_officer'].includes(loadedProfile.role)) {
        return json(403, { error: 'Only admin/master/admin_officer users can run photo recovery' });
      }

      profile = loadedProfile;
      actorLabel = `admin:${authData.user.email ?? loadedProfile.id}`;
    }

    const body = (await req.json().catch(() => ({}))) as RequestPayload;

    const dateFrom = toIsoStart(body.date_from);
    const dateTo = toIsoEnd(body.date_to);
    const windowSeconds = Math.max(60, Math.min(MAX_WINDOW_SECONDS, (body.window_minutes ?? DEFAULT_WINDOW_MINUTES) * 60));
    const limit = Math.max(1, Math.min(1000, body.limit ?? DEFAULT_LIMIT));
    const apply = body.apply === true;
    const targetBucket = body.target_bucket || DEFAULT_BUCKET;
    const parkpowBaseUrl = (body.parkpow_base_url || DEFAULT_BASE_URL).replace(/\/$/, '');
    const requireEmptyPhoto = body.require_empty_photo === true;
    const includeStaleSignedUrls = body.include_stale_signed_urls !== false;
    const maxSessionPages = Math.max(1, Math.min(10, body.max_session_pages ?? DEFAULT_MAX_SESSION_PAGES));
    const snapshotDashboardUrl = (body.snapshot_dashboard_url || DEFAULT_SNAPSHOT_DASHBOARD_URL).trim();
    const snapshotPrefetchPages = Math.max(1, Math.min(30, body.snapshot_prefetch_pages ?? DEFAULT_SNAPSHOT_PREFETCH_PAGES));

    const orgId: string | null = profile
      ? (profile.role === 'master' ? (body.organization_id ?? null) : (profile.organization_id ?? null))
      : (body.organization_id ?? null);

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
      const hasHash = schema.hasPhotoHashCol ? String(obs.photo_hash || '').trim().length > 0 : true;
      const missingAny = !hasPhoto || !hasHash;
      const staleSigned = includeStaleSignedUrls && hasPhoto && isSignedStorageUrl(photoValue);

      if (requireEmptyPhoto) return !hasPhoto;
      return missingAny || staleSigned;
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
    let uploadErrors = 0;
    let snapshotCatalogCount = 0;

    let snapshotSession: SnapshotSession | null = null;
    let snapshotCatalog: SnapshotCatalogItem[] = [];
    const snapshotAlprCache = new Map<string, { plate: string | null; confidence: number | null }>();

    if (apply && snapshotLoginEmail && snapshotLoginPassword) {
      try {
        snapshotSession = await loginSnapshotSession(snapshotDashboardUrl, snapshotLoginEmail, snapshotLoginPassword);
        snapshotCatalog = await fetchSnapshotCatalog(snapshotDashboardUrl, snapshotSession, snapshotPrefetchPages);
        snapshotCatalogCount = snapshotCatalog.length;
      } catch (err: any) {
        console.error('[photo-recovery] snapshot prefetch init failed:', err?.message || String(err));
      }
    }

    for (const obs of candidates) {
      const obsKey = String(obs[schema.keyCol] || '');
      const plate = normalizePlate(obs.plate_number);
      const recordedAt = String(obs.recorded_at || '');
      const currentPhoto = String(obs[schema.photoCol] || '').trim();
      const hasHash = schema.hasPhotoHashCol ? String(obs.photo_hash || '').trim().length > 0 : true;
      const reason = (!currentPhoto ? 'missing_photo' : !hasHash ? 'missing_hash' : isSignedStorageUrl(currentPhoto) ? 'stale_signed_url' : 'unknown');

      if (!obsKey || !plate || !recordedAt) {
        continue;
      }

      const result: RecoveryResult = {
        observation_key: obsKey,
        plate_number: plate,
        recorded_at: recordedAt,
        existing_photo_url: currentPhoto || undefined,
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
        actor_id: profile?.id ?? null,
        actor_label: actorLabel,
      });

      if (apply && infra.hasQueue && schema.keyCol === 'id') {
        const queueReason = reason === 'stale_signed_url' ? 'object_404' : reason === 'missing_hash' ? 'null_hash' : 'null_url';
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
      let parkpowLookupFailure: string | null = null;

      if (parkpowToken) {
        const sessions: any[] = [];
        let nextUrl: string | null = `${parkpowBaseUrl}/sessions/?license_plate=${encodeURIComponent(plate)}&limit=100`;
        let page = 0;

        while (nextUrl && page < maxSessionPages) {
          page += 1;
          const sessionsResp = await fetch(nextUrl, {
            headers: {
              Authorization: `Token ${parkpowToken}`,
              'Content-Type': 'application/json',
            },
            signal: AbortSignal.timeout(15000),
          }).catch(() => null);

          if (!sessionsResp || !sessionsResp.ok) {
            parkpowErrors++;
            parkpowLookupFailure = !sessionsResp
              ? 'network_error'
              : `http_${sessionsResp.status}`;
            nextUrl = null;
            break;
          }

          const sessionsData = await sessionsResp.json().catch(() => ({}));
          sessions.push(...getSessionsArray(sessionsData));
          nextUrl = getNextPageUrl(sessionsData);
        }

        if (sessions.length > 0) {
          const recEpoch = Date.parse(recordedAt);
          let best: any = null;
          let bestDelta = Number.MAX_SAFE_INTEGER;

          for (const s of sessions) {
            const ts = pickSessionTimestamp(s);
            const url = normalizePhotoUrl(extractPhotoUrl(s), parkpowBaseUrl);
            if (!ts || !url) continue;
            const sEpoch = Date.parse(ts);
            if (Number.isNaN(sEpoch) || Number.isNaN(recEpoch)) continue;
            const delta = Math.abs(Math.floor((sEpoch - recEpoch) / 1000));
            if (delta < bestDelta) {
              best = s;
              bestDelta = delta;
            }
          }

          if (best && bestDelta <= windowSeconds) {
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
                  !alprPlate || normalizePlate(alprPlate) === plate;

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
                    actor_id: profile?.id ?? null,
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
          }
        }
      }

      // Fallback source: Snapshot Cloud dashboard listing by plate.
      if (!recovered && snapshotSession) {
        try {
          const snapshotMatch = await lookupSnapshotImageByPlate(
            snapshotDashboardUrl,
            snapshotSession,
            plate,
            recordedAt,
            windowSeconds,
          );

          if (snapshotMatch) {
            const { bytes: imgBytes, contentType } = await downloadPublicPhotoBytes(snapshotMatch.imageUrl);

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

            const plateMatches = !alprPlate || normalizePlate(alprPlate) === plate;
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

              await audit(infra.hasAudit, supabaseAdmin, {
                observation_id: schema.keyCol === 'id' ? obsKey : null,
                organization_id: obs.organization_id ?? null,
                plate_number: plate,
                recorded_at: recordedAt,
                action: 'photo_restored',
                source: 'snapshot_dashboard',
                source_ref: snapshotMatch.imagePath,
                success: true,
                photo_url: storedUrl,
                photo_hash: schema.hasPhotoHashCol ? hash : null,
                photo_bytes: imgBytes.byteLength,
                meta: {
                  delta_seconds: snapshotMatch.deltaSeconds,
                  row_time_text: snapshotMatch.rowTimeText,
                  source_url: snapshotMatch.imageUrl,
                  alpr_plate: alprPlate,
                  alpr_confidence: alprConf,
                  storage_path: storagePath,
                },
                actor_id: profile?.id ?? null,
                actor_label: actorLabel,
              });

              result.status = 'restored';
              result.source = 'snapshot_dashboard';
              result.stored_photo_url = storedUrl;
              result.photo_hash = schema.hasPhotoHashCol ? hash : undefined;
              result.delta_seconds = snapshotMatch.deltaSeconds;
              result.alpr_plate = alprPlate ?? undefined;
              result.alpr_confidence = alprConf ?? undefined;
              recovered = true;
              autoRestored++;
            } else {
              result.reason = `ALPR mismatch (snapshot): detected ${alprPlate}`;
            }
          }
        } catch (err: any) {
          result.error = err?.message || 'Snapshot fallback failed';
        }
      }

      // Alternate snapshot strategy: prefetch images, download to bytes, and match by ALPR + timestamp window.
      if (!recovered && snapshotCatalog.length > 0 && platerecToken) {
        const recEpoch = Date.parse(recordedAt);
        if (!Number.isNaN(recEpoch)) {
          const byTime = snapshotCatalog
            .filter((s) => s.rowEpoch && Math.abs(Math.floor(((s.rowEpoch as number) - recEpoch) / 1000)) <= windowSeconds)
            .map((s) => ({
              ...s,
              deltaSeconds: Math.abs(Math.floor(((s.rowEpoch as number) - recEpoch) / 1000)),
            }))
            .sort((a, b) => a.deltaSeconds - b.deltaSeconds)
            .slice(0, 5);

          for (const cand of byTime) {
            try {
              const { bytes: imgBytes, contentType } = await downloadPublicPhotoBytes(cand.imageUrl);

              let cached = snapshotAlprCache.get(cand.imageUrl);
              if (!cached) {
                const alpr = await alprWithBytes(imgBytes, { regions: 'nz', mmc: false });
                cached = {
                  plate: alpr.plate ? normalizePlate(alpr.plate) : null,
                  confidence: alpr.confidence ?? null,
                };
                snapshotAlprCache.set(cand.imageUrl, cached);
              }

              if (!cached.plate || cached.plate !== plate) continue;

              const folder = safeFolder(obs.recorded_by);
              const ts = Date.now();
              const rand = crypto.randomUUID().slice(0, 8);
              const storagePath = `recovered/${folder}/${ts}-${rand}.jpg`;
              const hash = await sha256Hex(imgBytes);

              const { error: uploadError } = await supabaseAdmin.storage
                .from(targetBucket)
                .upload(storagePath, imgBytes, { contentType, upsert: false });
              if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

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
              if (updateError) throw new Error(`Observation update failed: ${updateError.message}`);

              await audit(infra.hasAudit, supabaseAdmin, {
                observation_id: schema.keyCol === 'id' ? obsKey : null,
                organization_id: obs.organization_id ?? null,
                plate_number: plate,
                recorded_at: recordedAt,
                action: 'photo_restored',
                source: 'snapshot_prefetch',
                source_ref: cand.imagePath,
                success: true,
                photo_url: storedUrl,
                photo_hash: schema.hasPhotoHashCol ? hash : null,
                photo_bytes: imgBytes.byteLength,
                meta: {
                  delta_seconds: cand.deltaSeconds,
                  row_time_text: cand.rowTimeText,
                  source_url: cand.imageUrl,
                  alpr_plate: cached.plate,
                  alpr_confidence: cached.confidence,
                  storage_path: storagePath,
                },
                actor_id: profile?.id ?? null,
                actor_label: actorLabel,
              });

              result.status = 'restored';
              result.source = 'snapshot_prefetch';
              result.stored_photo_url = storedUrl;
              result.photo_hash = schema.hasPhotoHashCol ? hash : undefined;
              result.delta_seconds = cand.deltaSeconds;
              result.alpr_plate = cached.plate ?? undefined;
              result.alpr_confidence = cached.confidence ?? undefined;
              recovered = true;
              autoRestored++;
              break;
            } catch {
              // keep trying nearby prefetch candidates
            }
          }
        }
      }

      if (!recovered) {
        result.status = 'manual_required';
        if (parkpowLookupFailure) {
          result.reason = `parkpow_lookup_failed:${parkpowLookupFailure}`;
          result.error = `ParkPow lookup failed (${parkpowLookupFailure})`;
        }
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
        include_stale_signed_urls: includeStaleSignedUrls,
        parkpow_available: !!parkpowToken,
        alpr_available: !!platerecToken,
        snapshot_available: !!(snapshotLoginEmail && snapshotLoginPassword),
        snapshot_dashboard_url: snapshotDashboardUrl,
        snapshot_prefetch_pages: snapshotPrefetchPages,
        snapshot_prefetch_catalog_count: snapshotCatalogCount,
      },
      scanned: rows.length,
      detected: candidates.length,
      auto_restored: autoRestored,
      queued_for_review: queuedForReview,
      parkpow_errors: parkpowErrors,
      upload_errors: uploadErrors,
      sample_results: results.slice(0, 50),
    });
  } catch (err: unknown) {
    const msg = (err as Error)?.message ?? 'Internal server error';
    console.error('[photo-recovery] unhandled error:', msg);
    return json(500, { error: msg });
  }
});
