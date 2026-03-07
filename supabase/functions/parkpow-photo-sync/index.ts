import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { corsHeaders } from '../_shared/cors.ts';

type ScopePayload = {
  date_from?: string;
  date_to?: string;
  window_minutes?: number;
  limit?: number;
  apply?: boolean;
  require_empty_photo?: boolean;
  target_bucket?: string;
  parkpow_base_url?: string;
};

type ObsRow = Record<string, any>;

type MatchResult = {
  observation_key: string;
  plate_number: string;
  recorded_at: string;
  matched_session_id: number | null;
  matched_photo_url: string;
  delta_seconds: number;
  storage_path?: string;
  stored_photo_url?: string;
  applied?: boolean;
  error?: string;
};

const DEFAULT_WINDOW_MINUTES = 60;
const DEFAULT_LIMIT = 200;
const DEFAULT_BUCKET = 'scans';
const DEFAULT_BASE_URL = 'https://api.parkpow.com/api/v1';

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function toIsoStart(raw?: string): string | null {
  if (!raw) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00Z` : raw;
}

function toIsoEnd(raw?: string): string | null {
  if (!raw) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T23:59:59Z` : raw;
}

function safeFolder(input: string | null | undefined): string {
  const v = (input || 'parkpow-import').trim();
  return v.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64) || 'parkpow-import';
}

function extractPhotoUrl(session: any): string | null {
  return (
    session?.image_url ||
    session?.snapshot_url ||
    session?.plate_image_url ||
    session?.vehicle_image_url ||
    session?.camera_image_url ||
    session?.photo_url ||
    session?.images?.[0]?.url ||
    session?.images?.[0]?.image_url ||
    session?.images?.[0]?.snapshot_url ||
    session?.captures?.[0]?.image_url ||
    session?.captures?.[0]?.url ||
    session?.metadata?.image_url ||
    session?.metadata?.snapshot_url ||
    null
  );
}

function pickTimestamp(session: any): string | null {
  return session?.entry_time || session?.created_at || session?.time || null;
}

async function detectObservationSchema(supabase: ReturnType<typeof createClient>): Promise<{
  keyCol: 'id' | 'observation_id';
  photoCol: 'photo_url' | 'photo';
  hasParkPowSessionCol: boolean;
}> {
  const idProbe = await supabase.from('observations').select('id').limit(1);
  const keyCol: 'id' | 'observation_id' = idProbe.error ? 'observation_id' : 'id';

  const photoUrlProbe = await supabase.from('observations').select('photo_url').limit(1);
  const photoCol: 'photo_url' | 'photo' = photoUrlProbe.error ? 'photo' : 'photo_url';

  const parkpowProbe = await supabase.from('observations').select('parkpow_session_id').limit(1);
  const hasParkPowSessionCol = !parkpowProbe.error;

  return { keyCol, photoCol, hasParkPowSessionCol };
}

Deno.serve(async (req) => {
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
      return json(503, { error: 'PARKPOW_API_TOKEN not configured' });
    }

    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return json(401, { error: 'Missing authorization' });
    }

    const token = authHeader.replace('Bearer ', '');

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const supabaseAuth = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: authData, error: authError } = await supabaseAuth.auth.getUser(token);
    if (authError || !authData?.user) {
      return json(401, { error: 'Unauthorized' });
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('id, role, organization_id')
      .eq('id', authData.user.id)
      .single();

    if (profileError || !profile) {
      return json(403, { error: 'User profile not found' });
    }

    if (!['admin', 'master', 'admin_officer'].includes(profile.role)) {
      return json(403, { error: 'Insufficient permissions' });
    }

    const body = (await req.json().catch(() => ({}))) as ScopePayload;

    const dateFrom = toIsoStart(body.date_from) || toIsoStart(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
    const dateTo = toIsoEnd(body.date_to) || toIsoEnd(new Date().toISOString().slice(0, 10));
    const windowSeconds = Math.max(1, Math.min(24 * 60, body.window_minutes ?? DEFAULT_WINDOW_MINUTES)) * 60;
    const limit = Math.max(1, Math.min(1000, body.limit ?? DEFAULT_LIMIT));
    const apply = body.apply === true;
    const requireEmptyPhoto = body.require_empty_photo !== false;
    const targetBucket = body.target_bucket || DEFAULT_BUCKET;
    const parkpowBaseUrl = (body.parkpow_base_url || DEFAULT_BASE_URL).replace(/\/$/, '');

    const schema = await detectObservationSchema(supabaseAdmin);

    let selectCols = `${schema.keyCol},plate_number,recorded_at,recorded_by,${schema.photoCol}`;
    if (schema.hasParkPowSessionCol) selectCols += ',parkpow_session_id';

    let query = supabaseAdmin
      .from('observations')
      .select(selectCols)
      .not('plate_number', 'is', null)
      .order('recorded_at', { ascending: true })
      .gte('recorded_at', dateFrom!)
      .lte('recorded_at', dateTo!)
      .limit(limit);

    if (profile.role !== 'master' && profile.organization_id) {
      query = query.eq('organization_id', profile.organization_id);
    }

    if (requireEmptyPhoto) {
      query = query.is(schema.photoCol, null);
    }

    const { data: observations, error: obsError } = await query;
    if (obsError) {
      return json(500, { error: `Failed to load observations: ${obsError.message}` });
    }

    const rows = (observations ?? []) as ObsRow[];
    if (rows.length === 0) {
      return json(200, {
        success: true,
        message: 'No observations in scope',
        schema,
        scanned: 0,
        matched: 0,
        applied: 0,
      });
    }

    const matches: MatchResult[] = [];
    let parkpowLookupErrors = 0;
    let uploadErrors = 0;

    for (const obs of rows) {
      const obsKey = String(obs[schema.keyCol]);
      const plate = String(obs.plate_number || '').toUpperCase().trim();
      const recordedAt = String(obs.recorded_at || '');

      if (!obsKey || !plate || !recordedAt) continue;

      const sessionsResp = await fetch(
        `${parkpowBaseUrl}/sessions/?license_plate=${encodeURIComponent(plate)}&limit=100`,
        {
          headers: {
            Authorization: `Token ${parkpowToken}`,
            'Content-Type': 'application/json',
          },
        },
      ).catch(() => null);

      if (!sessionsResp || !sessionsResp.ok) {
        parkpowLookupErrors++;
        continue;
      }

      const sessionsData = await sessionsResp.json().catch(() => ({}));
      const sessions = Array.isArray(sessionsData?.results) ? sessionsData.results : [];
      if (sessions.length === 0) continue;

      const recEpoch = Date.parse(recordedAt);
      if (Number.isNaN(recEpoch)) continue;

      let best: any = null;
      let bestDelta = Number.MAX_SAFE_INTEGER;

      for (const session of sessions) {
        const ts = pickTimestamp(session);
        const url = extractPhotoUrl(session);
        if (!ts || !url) continue;

        const sessEpoch = Date.parse(ts);
        if (Number.isNaN(sessEpoch)) continue;

        const delta = Math.abs(Math.floor((sessEpoch - recEpoch) / 1000));
        if (delta < bestDelta) {
          bestDelta = delta;
          best = session;
        }
      }

      if (!best || bestDelta > windowSeconds) continue;

      const matchedPhotoUrl = extractPhotoUrl(best);
      if (!matchedPhotoUrl) continue;

      const match: MatchResult = {
        observation_key: obsKey,
        plate_number: plate,
        recorded_at: recordedAt,
        matched_session_id: typeof best.id === 'number' ? best.id : null,
        matched_photo_url: matchedPhotoUrl,
        delta_seconds: bestDelta,
      };

      if (apply) {
        try {
          const imageResp = await fetch(matchedPhotoUrl, {
            headers: {
              Authorization: `Token ${parkpowToken}`,
            },
          });

          if (!imageResp.ok) {
            throw new Error(`Download failed: HTTP ${imageResp.status}`);
          }

          const imageBytes = new Uint8Array(await imageResp.arrayBuffer());
          if (imageBytes.byteLength === 0) {
            throw new Error('Downloaded image was empty');
          }

          const folder = safeFolder(obs.recorded_by);
          const ts = Date.now();
          const rand = crypto.randomUUID().slice(0, 8);
          const storagePath = `${folder}/${ts}-${rand}.jpg`;

          const { error: uploadError } = await supabaseAdmin.storage
            .from(targetBucket)
            .upload(storagePath, imageBytes, {
              contentType: 'image/jpeg',
              upsert: false,
            });

          if (uploadError) {
            throw new Error(`Upload failed: ${uploadError.message}`);
          }

          const { data: publicData } = supabaseAdmin.storage
            .from(targetBucket)
            .getPublicUrl(storagePath);

          const storedPhotoUrl = publicData.publicUrl;

          const updateData: Record<string, any> = {
            [schema.photoCol]: storedPhotoUrl,
          };

          if (schema.hasParkPowSessionCol && match.matched_session_id != null) {
            updateData.parkpow_session_id = match.matched_session_id;
          }

          let updateQuery = supabaseAdmin
            .from('observations')
            .update(updateData)
            .eq(schema.keyCol, obsKey);

          if (requireEmptyPhoto) {
            updateQuery = updateQuery.is(schema.photoCol, null);
          }

          const { error: updateError } = await updateQuery;
          if (updateError) {
            throw new Error(`Observation update failed: ${updateError.message}`);
          }

          match.storage_path = storagePath;
          match.stored_photo_url = storedPhotoUrl;
          match.applied = true;
        } catch (err: any) {
          uploadErrors++;
          match.applied = false;
          match.error = err?.message || 'Apply failed';
        }
      }

      matches.push(match);
    }

    const appliedCount = matches.filter((m) => m.applied).length;
    const failedApplyCount = matches.filter((m) => m.applied === false).length;

    return json(200, {
      success: true,
      schema,
      options: {
        date_from: dateFrom,
        date_to: dateTo,
        window_minutes: Math.floor(windowSeconds / 60),
        limit,
        apply,
        require_empty_photo: requireEmptyPhoto,
        target_bucket: targetBucket,
        parkpow_base_url: parkpowBaseUrl,
      },
      scanned: rows.length,
      matched: matches.length,
      applied: appliedCount,
      apply_failed: failedApplyCount,
      parkpow_lookup_errors: parkpowLookupErrors,
      upload_or_update_errors: uploadErrors,
      sample_matches: matches.slice(0, 25),
    });
  } catch (err: any) {
    console.error('parkpow-photo-sync error:', err);
    return json(500, { error: err?.message || 'Internal server error' });
  }
});
