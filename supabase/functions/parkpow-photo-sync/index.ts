/**
 * ParkPow Photo Sync Edge Function
 *
 * Matches ParkPow Snapshot Cloud photos to existing observations by
 * plate number + timestamp proximity.  For each observation that is
 * missing a photo, the function:
 *
 *   1. Queries ParkPow sessions API for the same plate.
 *   2. Selects the session whose timestamp is closest to the observation's
 *      recorded_at (within a configurable window).
 *   3. Downloads the session image, uploads it to Supabase Storage, and
 *      updates the observation row with the new photo URL (and optionally
 *      the parkpow_session_id).
 *
 * POST /functions/v1/parkpow-photo-sync
 * Body: {
 *   date_from?:             string  (ISO / YYYY-MM-DD, default 30 days ago)
 *   date_to?:               string  (ISO / YYYY-MM-DD, default now)
 *   window_minutes?:        number  (default 60)
 *   limit?:                 number  (default 200, max 1000)
 *   apply?:                 boolean (default false = dry-run)
 *   require_empty_photo?:   boolean (default true — only fill observations with no photo)
 *   target_bucket?:         string  (default "evidence")
 *   parkpow_base_url?:      string  (default "https://app.parkpow.com/api/v1")
 *   max_session_pages?:     number  (default 3, max 10)
 *   organization_id?:       string  (scope to single org — master only)
 * }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { corsHeaders } from '../_shared/cors.ts';

// ─── Types ───────────────────────────────────────────────────────────────────

type RequestPayload = {
  organization_id?: string;
  date_from?: string;
  date_to?: string;
  window_minutes?: number;
  limit?: number;
  apply?: boolean;
  require_empty_photo?: boolean;
  target_bucket?: string;
  parkpow_base_url?: string;
  max_session_pages?: number;
};

type ObsRow = Record<string, any>;

type SyncResult = {
  observation_key: string;
  plate_number: string;
  recorded_at: string;
  status: 'dry_run' | 'linked' | 'no_match' | 'skipped' | 'error';
  source?: string;
  stored_photo_url?: string;
  delta_seconds?: number;
  matched_session_id?: number | null;
  error?: string;
};

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_BASE_URL = 'https://app.parkpow.com/api/v1';
const DEFAULT_BUCKET = 'evidence';
const DEFAULT_LIMIT = 200;
const DEFAULT_WINDOW_MINUTES = 60;
const DEFAULT_MAX_SESSION_PAGES = 3;

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
  const v = (input || 'parkpow-sync').trim();
  return v.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64) || 'parkpow-sync';
}

/** Extract the best image URL from a ParkPow session object. */
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

/** Normalise relative ParkPow photo URLs to absolute. */
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

/** Pick the best timestamp field from a ParkPow session record. */
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

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function downloadPhotoBytes(
  url: string,
  parkpowToken: string,
): Promise<{ bytes: Uint8Array; contentType: string }> {
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

/** Detect whether schema uses id vs observation_id, photo_url vs photo. */
async function detectObservationSchema(
  supabase: ReturnType<typeof createClient>,
): Promise<{
  keyCol: 'id' | 'observation_id';
  photoCol: 'photo_url' | 'photo';
  hasPhotoHashCol: boolean;
  hasParkpowSessionCol: boolean;
}> {
  const idProbe = await supabase.from('observations').select('id').limit(1);
  const keyCol: 'id' | 'observation_id' = idProbe.error ? 'observation_id' : 'id';

  const photoUrlProbe = await supabase.from('observations').select('photo_url').limit(1);
  const photoCol: 'photo_url' | 'photo' = photoUrlProbe.error ? 'photo' : 'photo_url';

  const hashProbe = await supabase.from('observations').select('photo_hash').limit(1);
  const hasPhotoHashCol = !hashProbe.error;

  const sessionProbe = await supabase.from('observations').select('parkpow_session_id').limit(1);
  const hasParkpowSessionCol = !sessionProbe.error;

  return { keyCol, photoCol, hasPhotoHashCol, hasParkpowSessionCol };
}

// ─── Main Handler ────────────────────────────────────────────────────────────

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

    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      return json(500, { error: 'Supabase env vars missing' });
    }

    if (!parkpowToken) {
      return json(503, { error: 'PARKPOW_API_TOKEN not configured in Supabase secrets' });
    }

    // ── Auth ──────────────────────────────────────────────────────────────
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const authHeader = req.headers.get('Authorization') ?? '';
    let profile: { id: string; role: string; organization_id: string | null } | null = null;

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
        return json(403, { error: 'Only admin/master/admin_officer users can run photo sync' });
      }

      profile = loadedProfile;
    }

    // ── Parse body ────────────────────────────────────────────────────────
    const body = (await req.json().catch(() => ({}))) as RequestPayload;

    const dateFrom = toIsoStart(body.date_from);
    const dateTo = toIsoEnd(body.date_to);
    const windowSeconds = Math.max(60, Math.min(365 * 24 * 3600, (body.window_minutes ?? DEFAULT_WINDOW_MINUTES) * 60));
    const limit = Math.max(1, Math.min(1000, body.limit ?? DEFAULT_LIMIT));
    const apply = body.apply === true;
    const requireEmptyPhoto = body.require_empty_photo !== false; // default true
    const targetBucket = body.target_bucket || DEFAULT_BUCKET;
    const parkpowBaseUrl = (body.parkpow_base_url || DEFAULT_BASE_URL).replace(/\/$/, '');
    const maxSessionPages = Math.max(1, Math.min(10, body.max_session_pages ?? DEFAULT_MAX_SESSION_PAGES));

    const orgId: string | null = profile
      ? (profile.role === 'master' ? (body.organization_id ?? null) : (profile.organization_id ?? null))
      : (body.organization_id ?? null);

    // ── Detect schema ─────────────────────────────────────────────────────
    const schema = await detectObservationSchema(supabaseAdmin);

    console.log(`📸 parkpow-photo-sync: schema=${JSON.stringify(schema)} dateFrom=${dateFrom} dateTo=${dateTo} window=${windowSeconds}s limit=${limit} apply=${apply}`);

    // ── Load observations ─────────────────────────────────────────────────
    let selectCols = `${schema.keyCol},organization_id,plate_number,recorded_at,recorded_by,${schema.photoCol}`;
    if (schema.hasPhotoHashCol) selectCols += ',photo_hash';
    if (schema.hasParkpowSessionCol) selectCols += ',parkpow_session_id';

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

    // Filter to only observations missing photos
    const candidates = rows.filter((obs) => {
      const photoValue = String(obs[schema.photoCol] || '').trim();
      const hasPhoto = photoValue.length > 0;

      if (requireEmptyPhoto) return !hasPhoto;
      // When requireEmptyPhoto is false, sync ALL observations (re-link even existing)
      return true;
    });

    if (candidates.length === 0) {
      return json(200, {
        success: true,
        message: 'No candidate observations found for photo sync',
        schema,
        scanned: rows.length,
        candidates: 0,
        linked: 0,
        no_match: 0,
        errors: 0,
        apply,
        date_from: dateFrom,
        date_to: dateTo,
      });
    }

    // ── Deduplicate plate lookups ─────────────────────────────────────────
    // Group observations by plate to avoid querying ParkPow multiple times
    // for the same plate.
    const plateSessionsCache = new Map<string, any[]>();

    async function getSessionsForPlate(plate: string): Promise<any[]> {
      if (plateSessionsCache.has(plate)) {
        return plateSessionsCache.get(plate)!;
      }

      const sessions: any[] = [];
      let nextUrl: string | null = `${parkpowBaseUrl}/sessions/?license_plate=${encodeURIComponent(plate)}&limit=100`;
      let page = 0;

      while (nextUrl && page < maxSessionPages) {
        page++;
        const sessionsResp = await fetch(nextUrl, {
          headers: {
            Authorization: `Token ${parkpowToken}`,
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(15000),
        }).catch(() => null);

        if (!sessionsResp || !sessionsResp.ok) {
          nextUrl = null;
          break;
        }

        const sessionsData = await sessionsResp.json().catch(() => ({}));
        sessions.push(...getSessionsArray(sessionsData));
        nextUrl = getNextPageUrl(sessionsData);
      }

      plateSessionsCache.set(plate, sessions);
      return sessions;
    }

    // ── Match and sync ────────────────────────────────────────────────────
    const results: SyncResult[] = [];
    let linked = 0;
    let noMatch = 0;
    let errors = 0;

    for (const obs of candidates) {
      const obsKey = String(obs[schema.keyCol] || '');
      const plate = normalizePlate(obs.plate_number);
      const recordedAt = String(obs.recorded_at || '');
      const currentPhoto = String(obs[schema.photoCol] || '').trim();

      if (!obsKey || !plate || !recordedAt) continue;

      const result: SyncResult = {
        observation_key: obsKey,
        plate_number: plate,
        recorded_at: recordedAt,
        status: 'no_match',
      };

      // Skip observations that already have a photo (when requireEmptyPhoto)
      if (requireEmptyPhoto && currentPhoto) {
        result.status = 'skipped';
        results.push(result);
        continue;
      }

      try {
        const sessions = await getSessionsForPlate(plate);

        if (sessions.length === 0) {
          noMatch++;
          results.push(result);
          continue;
        }

        // Find best session match by timestamp proximity
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

        if (!best || bestDelta > windowSeconds) {
          noMatch++;
          result.status = 'no_match';
          result.delta_seconds = best ? bestDelta : undefined;
          results.push(result);
          continue;
        }

        const matchedPhotoUrl = normalizePhotoUrl(extractPhotoUrl(best), parkpowBaseUrl);
        if (!matchedPhotoUrl) {
          noMatch++;
          result.status = 'no_match';
          results.push(result);
          continue;
        }

        result.delta_seconds = bestDelta;
        result.matched_session_id = typeof best.id === 'number' ? best.id : null;

        if (!apply) {
          result.status = 'dry_run';
          result.source = 'parkpow';
          results.push(result);
          continue;
        }

        // Download image and upload to storage
        const { bytes: imgBytes, contentType } = await downloadPhotoBytes(matchedPhotoUrl, parkpowToken);
        const folder = safeFolder(obs.recorded_by);
        const ts = Date.now();
        const rand = crypto.randomUUID().slice(0, 8);
        const storagePath = `parkpow-sync/${folder}/${ts}-${rand}.jpg`;
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

        // Update the observation
        const updateData: Record<string, any> = { [schema.photoCol]: storedUrl };
        if (schema.hasPhotoHashCol) updateData.photo_hash = hash;
        if (schema.hasParkpowSessionCol && result.matched_session_id) {
          updateData.parkpow_session_id = result.matched_session_id;
        }

        const { error: updateError } = await supabaseAdmin
          .from('observations')
          .update(updateData)
          .eq(schema.keyCol, obsKey);

        if (updateError) {
          throw new Error(`Observation update failed: ${updateError.message}`);
        }

        result.status = 'linked';
        result.source = 'parkpow';
        result.stored_photo_url = storedUrl;
        linked++;
      } catch (err: any) {
        result.status = 'error';
        result.error = err?.message || 'Unknown error';
        errors++;
      }

      results.push(result);
    }

    return json(200, {
      success: true,
      schema,
      scanned: rows.length,
      candidates: candidates.length,
      linked,
      no_match: noMatch,
      errors,
      apply,
      date_from: dateFrom,
      date_to: dateTo,
      window_minutes: windowSeconds / 60,
      results,
    });
  } catch (err: any) {
    console.error('❌ parkpow-photo-sync error:', err);
    return json(500, { success: false, error: err?.message || 'Internal error' });
  }
});
