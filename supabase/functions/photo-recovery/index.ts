// ============================================================================
// photo-recovery  Edge Function
// ============================================================================
// Recover and relink vehicle/plate photos accidentally deleted from the
// evidence storage bucket.
//
// Flow per observation in scope:
//   1. Detect observations with null photo_url or photo_hash
//   2. Search ParkPow sessions by plate + recorded_at timestamp (±window)
//   3. If candidate found: download image → upload to evidence bucket →
//      run Plate Recognizer to verify plate → update observation
//   4. If plate doesn't match or no ParkPow session found: add to
//      missing_photo_queue with status = 'manual_required'
//   5. Log every action to photo_recovery_audit_log (chain-of-custody)
//
// POST body (all optional):
//   {
//     organization_id?: string,     // restrict to one org (master only if omitted)
//     date_from?:       string,     // ISO date or datetime (default: 30 days ago)
//     date_to?:         string,     // ISO date or datetime (default: now)
//     window_minutes?:  number,     // ParkPow timestamp match window (default: 60)
//     limit?:           number,     // max observations to process (default: 100, max: 500)
//     apply?:           boolean,    // false = dry-run (default: false)
//     target_bucket?:   string,     // storage bucket for restored photos (default: 'evidence')
//     parkpow_base_url?: string,
//   }
//
// Returns:
//   { success, scanned, detected, auto_restored, queued_for_review,
//     parkpow_errors, upload_errors, sample_results[] }
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { corsHeaders } from '../_shared/cors.ts';
import { alprWithBytes } from '../_shared/alpr.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RequestPayload = {
  organization_id?: string;
  date_from?: string;
  date_to?: string;
  window_minutes?: number;
  limit?: number;
  apply?: boolean;
  target_bucket?: string;
  parkpow_base_url?: string;
};

type ObservationRow = {
  id: string;
  organization_id: string;
  plate_number: string;
  recorded_at: string;
  photo_url: string | null;
  photo_hash: string | null;
  gps_latitude: number | null;
  gps_longitude: number | null;
  recorded_by: string;
};

type RecoveryResult = {
  observation_id: string;
  plate_number: string;
  recorded_at: string;
  status: 'dry_run' | 'restored' | 'manual_required' | 'skipped' | 'error';
  source?: string;
  stored_photo_url?: string;
  photo_hash?: string;
  delta_seconds?: number;
  alpr_plate?: string;
  alpr_confidence?: number;
  reason?: string;
  error?: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function pickSessionTimestamp(session: Record<string, unknown>): string | null {
  return (
    (session.entry_time as string) ||
    (session.created_at as string) ||
    (session.time as string) ||
    null
  );
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// Audit logger
// ---------------------------------------------------------------------------

async function audit(
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
  const { error } = await supabase.from('photo_recovery_audit_log').insert({
    observation_id:  entry.observation_id,
    organization_id: entry.organization_id,
    plate_number:    entry.plate_number ?? null,
    recorded_at:     entry.recorded_at ?? null,
    action:          entry.action,
    source:          entry.source ?? null,
    source_ref:      entry.source_ref ?? null,
    success:         entry.success,
    photo_url:       entry.photo_url ?? null,
    photo_hash:      entry.photo_hash ?? null,
    photo_bytes:     entry.photo_bytes ?? null,
    error_message:   entry.error_message ?? null,
    meta:            entry.meta ?? null,
    actor_id:        entry.actor_id ?? null,
    actor_label:     entry.actor_label ?? 'system',
  });
  if (error) {
    // Audit failures are non-fatal but must be surfaced in logs
    console.error('[photo-recovery] audit insert failed:', error.message);
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  try {
    const supabaseUrl      = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const anonKey          = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const parkpowToken     = Deno.env.get('PARKPOW_API_TOKEN') ?? '';
    const platerecToken    = Deno.env.get('PLATERECOGNIZER_TOKEN') ?? Deno.env.get('PLATE_RECOGNIZER_TOKEN') ?? '';

    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      return json(500, { error: 'Supabase env vars missing' });
    }

    // ----- Auth -----
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) {
      return json(401, { error: 'Missing authorization header' });
    }
    const token = authHeader.replace('Bearer ', '');

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const supabaseUser  = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: authData, error: authError } = await supabaseUser.auth.getUser(token);
    if (authError || !authData?.user) {
      return json(401, { error: 'Unauthorized' });
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('id, role, organization_id, first_name, last_name')
      .eq('id', authData.user.id)
      .single();

    if (profileError || !profile) {
      return json(403, { error: 'User profile not found' });
    }

    if (!['admin', 'master'].includes(profile.role)) {
      return json(403, { error: 'Only admin and master users can run photo recovery' });
    }

    const actorLabel = `admin:${authData.user.email ?? profile.id}`;

    // ----- Parse body -----
    const body = (await req.json().catch(() => ({}))) as RequestPayload;

    const dateFrom       = toIsoStart(body.date_from);
    const dateTo         = toIsoEnd(body.date_to);
    const windowSeconds  = Math.max(60, Math.min(24 * 3600, (body.window_minutes ?? 60) * 60));
    const limit          = Math.max(1, Math.min(500, body.limit ?? 100));
    const apply          = body.apply === true;
    const targetBucket   = body.target_bucket || 'evidence';
    const parkpowBaseUrl = (body.parkpow_base_url || 'https://api.parkpow.com/api/v1').replace(/\/$/, '');

    // Org scoping: non-master users are locked to their own org
    const orgId: string | null =
      profile.role === 'master'
        ? (body.organization_id ?? null)
        : (profile.organization_id ?? null);

    // ----- Phase 1: Detect missing photos -----
    let obsQuery = supabaseAdmin
      .from('observations')
      .select('id, organization_id, plate_number, recorded_at, photo_url, photo_hash, gps_latitude, gps_longitude, recorded_by')
      .gte('recorded_at', dateFrom)
      .lte('recorded_at', dateTo)
      .order('recorded_at', { ascending: true })
      .limit(limit);

    if (orgId) {
      obsQuery = obsQuery.eq('organization_id', orgId);
    }

    // Find observations where either photo_url or photo_hash is null
    obsQuery = obsQuery.or('photo_url.is.null,photo_hash.is.null');

    const { data: observations, error: obsError } = await obsQuery;
    if (obsError) {
      return json(500, { error: `Failed to load observations: ${obsError.message}` });
    }

    const rows = (observations ?? []) as ObservationRow[];

    if (rows.length === 0) {
      return json(200, {
        success: true,
        message: 'No observations with missing photos found in scope',
        scanned: 0,
        detected: 0,
        auto_restored: 0,
        queued_for_review: 0,
        apply,
      });
    }

    // ----- Process each observation -----
    const results: RecoveryResult[] = [];
    let autoRestored      = 0;
    let queuedForReview   = 0;
    let parkpowErrors     = 0;
    let uploadErrors      = 0;

    for (const obs of rows) {
      const result: RecoveryResult = {
        observation_id: obs.id,
        plate_number:   obs.plate_number,
        recorded_at:    obs.recorded_at,
        status:         'manual_required',
      };

      // Log detection
      await audit(supabaseAdmin, {
        observation_id:  obs.id,
        organization_id: obs.organization_id,
        plate_number:    obs.plate_number,
        recorded_at:     obs.recorded_at,
        action:          'detect',
        source:          'system',
        success:         true,
        meta: {
          has_url:  obs.photo_url !== null,
          has_hash: obs.photo_hash !== null,
          dry_run:  !apply,
        },
        actor_id:    profile.id,
        actor_label: actorLabel,
      });

      // Upsert into missing_photo_queue
      if (apply) {
        const reason =
          obs.photo_url === null && obs.photo_hash === null ? 'null_both'
          : obs.photo_url  === null ? 'null_url'
          : 'null_hash';

        await supabaseAdmin.from('missing_photo_queue').upsert(
          {
            observation_id:  obs.id,
            organization_id: obs.organization_id,
            plate_number:    obs.plate_number,
            recorded_at:     obs.recorded_at,
            reason,
            status:          'repairing',
            attempts:        1,
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

      // ----- Phase 2: ParkPow search -----
      let recovered = false;

      if (parkpowToken) {
        await audit(supabaseAdmin, {
          observation_id:  obs.id,
          organization_id: obs.organization_id,
          plate_number:    obs.plate_number,
          recorded_at:     obs.recorded_at,
          action:          'parkpow_search',
          source:          'parkpow',
          success:         false, // updated below
          meta:            { plate: obs.plate_number, window_seconds: windowSeconds },
          actor_id:        profile.id,
          actor_label:     actorLabel,
        });

        try {
          const sessResp = await fetch(
            `${parkpowBaseUrl}/sessions/?license_plate=${encodeURIComponent(obs.plate_number.toUpperCase())}&limit=100`,
            {
              headers: {
                Authorization: `Token ${parkpowToken}`,
                'Content-Type': 'application/json',
              },
              signal: AbortSignal.timeout(15000),
            },
          );

          if (sessResp.ok) {
            const sessData = await sessResp.json();
            const sessions: Array<Record<string, unknown>> = Array.isArray(sessData?.results)
              ? sessData.results
              : [];

            const recEpoch = Date.parse(obs.recorded_at);
            let bestSession: Record<string, unknown> | null = null;
            let bestDelta = Number.MAX_SAFE_INTEGER;

            for (const s of sessions) {
              const ts = pickSessionTimestamp(s);
              const url = extractPhotoUrl(s);
              if (!ts || !url) continue;
              const sEpoch = Date.parse(ts);
              if (Number.isNaN(sEpoch)) continue;
              const delta = Math.abs(Math.floor((sEpoch - recEpoch) / 1000));
              if (delta < bestDelta) {
                bestDelta = delta;
                bestSession = s;
              }
            }

            if (bestSession && bestDelta <= windowSeconds) {
              const candidateUrl = extractPhotoUrl(bestSession);
              const sessionId    = bestSession.id ?? null;

              if (candidateUrl) {
                // ----- Phase 3: Download + ALPR verify -----
                const imgResp = await fetch(candidateUrl, {
                  headers: { Authorization: `Token ${parkpowToken}` },
                  signal: AbortSignal.timeout(30000),
                }).catch(() => null);

                if (imgResp?.ok) {
                  const imgBytes = new Uint8Array(await imgResp.arrayBuffer());

                  if (imgBytes.byteLength > 0) {
                    // Optionally verify plate via Plate Recognizer
                    let alprPlate: string | null = null;
                    let alprConf: number | null = null;

                    if (platerecToken) {
                      try {
                        const alprResult = await alprWithBytes(imgBytes, { regions: 'nz', mmc: false });
                        alprPlate = alprResult.plate;
                        alprConf  = alprResult.confidence;

                        await audit(supabaseAdmin, {
                          observation_id:  obs.id,
                          organization_id: obs.organization_id,
                          plate_number:    obs.plate_number,
                          recorded_at:     obs.recorded_at,
                          action:          'platerecognizer',
                          source:          'platerecognizer',
                          source_ref:      candidateUrl,
                          success:         alprPlate !== null,
                          meta:            { alpr_plate: alprPlate, alpr_confidence: alprConf },
                          actor_id:        profile.id,
                          actor_label:     actorLabel,
                        });
                      } catch (alprErr: unknown) {
                        console.warn('[photo-recovery] ALPR verify failed:', (alprErr as Error).message);
                      }
                    }

                    // Accept the photo if ALPR matches or ALPR not available
                    const plateMatches =
                      !alprPlate ||
                      alprPlate.replace(/\s/g, '').toUpperCase() ===
                        obs.plate_number.replace(/\s/g, '').toUpperCase();

                    if (plateMatches) {
                      // ----- Upload to storage -----
                      const folder = safeFolder(obs.recorded_by);
                      const ts     = Date.now();
                      const rand   = crypto.randomUUID().slice(0, 8);
                      const storagePath = `recovered/${folder}/${ts}-${rand}.jpg`;
                      const hash   = await sha256Hex(imgBytes);

                      const { error: uploadError } = await supabaseAdmin.storage
                        .from(targetBucket)
                        .upload(storagePath, imgBytes, { contentType: 'image/jpeg', upsert: false });

                      if (!uploadError) {
                        const { data: pubData } = supabaseAdmin.storage
                          .from(targetBucket)
                          .getPublicUrl(storagePath);

                        const storedUrl = pubData.publicUrl;

                        // Update observation – always set both fields atomically.
                        // If only one field was missing we still set both to ensure
                        // the observation is in a fully consistent state.
                        const { error: updateError } = await supabaseAdmin
                          .from('observations')
                          .update({ photo_url: storedUrl, photo_hash: hash })
                          .eq('id', obs.id);

                        if (!updateError) {
                          // Mark queue item as fixed
                          await supabaseAdmin
                            .from('missing_photo_queue')
                            .update({
                              status:            'fixed',
                              original_photo_url: storedUrl,
                              attempted_hash:    hash,
                              repair_notes:      `Auto-recovered from ParkPow session ${sessionId} (delta ${bestDelta}s)`,
                            })
                            .eq('observation_id', obs.id);

                          // Audit: photo restored
                          await audit(supabaseAdmin, {
                            observation_id:  obs.id,
                            organization_id: obs.organization_id,
                            plate_number:    obs.plate_number,
                            recorded_at:     obs.recorded_at,
                            action:          'photo_restored',
                            source:          'parkpow',
                            source_ref:      String(sessionId ?? ''),
                            success:         true,
                            photo_url:       storedUrl,
                            photo_hash:      hash,
                            photo_bytes:     imgBytes.byteLength,
                            meta: {
                              delta_seconds:     bestDelta,
                              alpr_plate:        alprPlate,
                              alpr_confidence:   alprConf,
                              storage_path:      storagePath,
                            },
                            actor_id:        profile.id,
                            actor_label:     actorLabel,
                          });

                          // Audit: observation updated
                          await audit(supabaseAdmin, {
                            observation_id:  obs.id,
                            organization_id: obs.organization_id,
                            plate_number:    obs.plate_number,
                            recorded_at:     obs.recorded_at,
                            action:          'observation_updated',
                            source:          'parkpow',
                            success:         true,
                            photo_url:       storedUrl,
                            photo_hash:      hash,
                            meta:            { fields_updated: ['photo_url', 'photo_hash'] },
                            actor_id:        profile.id,
                            actor_label:     actorLabel,
                          });

                          result.status          = 'restored';
                          result.source          = 'parkpow';
                          result.stored_photo_url = storedUrl;
                          result.photo_hash      = hash;
                          result.delta_seconds   = bestDelta;
                          result.alpr_plate      = alprPlate ?? undefined;
                          result.alpr_confidence = alprConf  ?? undefined;
                          recovered = true;
                          autoRestored++;
                        } else {
                          uploadErrors++;
                          result.error = `Observation update failed: ${updateError.message}`;
                        }
                      } else {
                        uploadErrors++;
                        result.error = `Storage upload failed: ${uploadError.message}`;

                        await audit(supabaseAdmin, {
                          observation_id:  obs.id,
                          organization_id: obs.organization_id,
                          plate_number:    obs.plate_number,
                          recorded_at:     obs.recorded_at,
                          action:          'photo_restored',
                          source:          'parkpow',
                          success:         false,
                          error_message:   uploadError.message,
                          actor_id:        profile.id,
                          actor_label:     actorLabel,
                        });
                      }
                    } else {
                      // ALPR plate mismatch – do not auto-apply
                      result.reason = `ALPR plate mismatch: detected "${alprPlate}", expected "${obs.plate_number}"`;
                      await audit(supabaseAdmin, {
                        observation_id:  obs.id,
                        organization_id: obs.organization_id,
                        plate_number:    obs.plate_number,
                        recorded_at:     obs.recorded_at,
                        action:          'parkpow_search',
                        source:          'parkpow',
                        source_ref:      String(sessionId ?? ''),
                        success:         false,
                        meta: {
                          reason:         'plate_mismatch',
                          alpr_plate:     alprPlate,
                          expected_plate: obs.plate_number,
                          delta_seconds:  bestDelta,
                        },
                        actor_id:        profile.id,
                        actor_label:     actorLabel,
                      });
                    }
                  }
                }
              }
            }
          } else {
            parkpowErrors++;
          }
        } catch (parkpowErr: unknown) {
          parkpowErrors++;
          console.error('[photo-recovery] ParkPow error:', (parkpowErr as Error).message);
        }
      }

      // ----- Phase 4: Queue for manual review if not auto-recovered -----
      if (!recovered) {
        result.status = 'manual_required';
        queuedForReview++;

        const repairNotes = result.reason
          ? result.reason
          : !parkpowToken
          ? 'PARKPOW_API_TOKEN not configured – manual recovery required'
          : 'No matching ParkPow session found within time window';

        await supabaseAdmin
          .from('missing_photo_queue')
          .update({
            status:       'manual_required',
            repair_notes: repairNotes,
            last_attempt_at: new Date().toISOString(),
          })
          .eq('observation_id', obs.id);

        await audit(supabaseAdmin, {
          observation_id:  obs.id,
          organization_id: obs.organization_id,
          plate_number:    obs.plate_number,
          recorded_at:     obs.recorded_at,
          action:          'queue_updated',
          source:          'system',
          success:         true,
          meta:            { new_status: 'manual_required', repair_notes: repairNotes },
          actor_id:        profile.id,
          actor_label:     actorLabel,
        });
      }

      results.push(result);
    }

    return json(200, {
      success:            true,
      apply,
      options: {
        date_from:        dateFrom,
        date_to:          dateTo,
        window_minutes:   Math.floor(windowSeconds / 60),
        limit,
        target_bucket:    targetBucket,
        organization_id:  orgId,
        parkpow_available: !!parkpowToken,
        alpr_available:    !!platerecToken,
      },
      scanned:            rows.length,
      detected:           rows.length,
      auto_restored:      autoRestored,
      queued_for_review:  queuedForReview,
      parkpow_errors:     parkpowErrors,
      upload_errors:      uploadErrors,
      sample_results:     results.slice(0, 50),
    });
  } catch (err: unknown) {
    const msg = (err as Error)?.message ?? 'Internal server error';
    console.error('[photo-recovery] unhandled error:', msg);
    return json(500, { error: msg });
  }
});
