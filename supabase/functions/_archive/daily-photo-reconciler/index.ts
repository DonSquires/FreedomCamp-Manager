// ============================================================================
// daily-photo-reconciler  Edge Function
// ============================================================================
// Continuous photo integrity monitoring and automated repair for the
// FieldOps Manager evidence storage.
//
// Runs daily (scheduled via cron or manual POST trigger) to:
//   1. Detect new observations with missing photo_url or photo_hash
//   2. HEAD-check storage for observations that have a URL (detect 404s)
//   3. Alert on aged pending repairs (> 24 h without resolution)
//   4. Cleanup expired scan_idempotency_keys
//   5. Return a health summary for dashboards / alerting
//
// POST body (all optional):
//   {
//     check_storage_head?: boolean,  // perform HEAD checks (default: true, capped at 200)
//     storage_head_limit?: number,   // max storage HEAD checks (default: 200)
//     date_from?:          string,   // restrict detection window (default: 7 days ago)
//     date_to?:            string,   // restrict detection window (default: now)
//     cleanup_idempotency?: boolean, // delete expired idempotency keys (default: true)
//   }
//
// This function uses the service role key so it MUST only be called from:
//   - A scheduled cron job authenticated with a service role token, or
//   - An authenticated admin/master user session.
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3';
import { withCors, jsonResponse, errorResponse, getCorsHeaders } from '../_shared/withCors.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RequestPayload = {
  check_storage_head?: boolean;
  storage_head_limit?: number;
  date_from?: string;
  date_to?: string;
  cleanup_idempotency?: boolean;
};

type StorageCheckResult = {
  observation_id: string;
  photo_url: string;
  status: 'ok' | 'not_found' | 'error';
  http_status?: number;
  error?: string;
};

type ReconcilerSummary = {
  run_at: string;
  newly_detected: number;
  already_queued: number;
  storage_checks: number;
  storage_404s: number;
  aged_pending: number;
  idempotency_keys_cleaned: number;
  queue_breakdown: Record<string, number>;
  integrity_health: {
    total_observations: number;
    with_photo: number;
    missing_any: number;
    photo_coverage_pct: number;
    slo_status: string;
  };
  storage_anomalies: StorageCheckResult[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
  });
}

function toIso(raw?: string, offsetDays?: number): string {
  if (!raw) {
    const d = new Date();
    if (offsetDays) d.setDate(d.getDate() + offsetDays);
    return d.toISOString();
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00Z` : raw;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) });
  }
  if (req.method !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  try {
    const supabaseUrl    = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const anonKey        = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      return json(500, { error: 'Supabase env vars missing' });
    }

    // ----- Auth -----
    const authHeader = req.headers.get('Authorization') ?? '';

    // Accept service-role direct calls (no Bearer user token) OR admin user sessions
    let callerLabel = 'system';
    let isServiceRole = false;

    if (authHeader === `Bearer ${serviceRoleKey}`) {
      // Direct service-role call (cron job)
      isServiceRole = true;
      callerLabel = 'cron-system';
    } else if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '');
      const supabaseUser = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: authData, error: authErr } = await supabaseUser.auth.getUser(token);
      if (authErr || !authData?.user) {
        return json(401, { error: 'Unauthorized' });
      }

      const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
      const { data: profile } = await supabaseAdmin
        .from('user_profiles')
        .select('role')
        .eq('id', authData.user.id)
        .single();

      if (!['admin', 'master'].includes(profile?.role ?? '')) {
        return json(403, { error: 'Only admin and master users may trigger the reconciler' });
      }
      callerLabel = `admin:${authData.user.email ?? authData.user.id}`;
    } else {
      return json(401, { error: 'Missing authorization header' });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // ----- Parse body -----
    const body = (await req.json().catch(() => ({}))) as RequestPayload;

    const checkStorageHead    = body.check_storage_head !== false;
    const storageHeadLimit    = Math.max(1, Math.min(500, body.storage_head_limit ?? 200));
    const dateFrom            = toIso(body.date_from, -7);
    const dateTo              = toIso(body.date_to);
    const cleanupIdempotency  = body.cleanup_idempotency !== false;

    const runAt = new Date().toISOString();
    console.log(`[daily-photo-reconciler] Starting run at ${runAt} caller=${callerLabel}`);

    // -----------------------------------------------------------------------
    // Step 1: Detect new observations missing photos
    // -----------------------------------------------------------------------
    const { data: detectResult, error: detectError } = await supabase.rpc(
      'detect_missing_photos',
      { p_date_from: dateFrom, p_date_to: dateTo },
    );

    const newlyDetected = detectError ? 0 : (detectResult?.[0]?.inserted_count ?? 0);
    const alreadyQueued = detectError ? 0 : (detectResult?.[0]?.already_queued ?? 0);

    if (detectError) {
      console.error('[daily-photo-reconciler] detect_missing_photos failed:', detectError.message);
    } else {
      console.log(`[daily-photo-reconciler] Detected: new=${newlyDetected} already_queued=${alreadyQueued}`);
    }

    // Log detection to audit log
    if (newlyDetected > 0) {
      await supabase.from('photo_recovery_audit_log').insert({
        observation_id:  null,
        organization_id: null,
        action:          'detect',
        source:          'daily-reconciler',
        success:         true,
        meta: {
          newly_detected:  newlyDetected,
          already_queued:  alreadyQueued,
          date_from:       dateFrom,
          date_to:         dateTo,
          caller:          callerLabel,
        },
        actor_label: callerLabel,
        occurred_at: runAt,
      });
    }

    // -----------------------------------------------------------------------
    // Step 2: HEAD check – find 404s for observations that have a photo_url
    // -----------------------------------------------------------------------
    const storageAnomalies: StorageCheckResult[] = [];
    let storageChecks = 0;

    if (checkStorageHead) {
      // Fetch observations in the last 7 days that have a photo_url
      const { data: toCheck } = await supabase
        .from('observations')
        .select('observation_id, organization_id, photo_url')
        .not('photo_url', 'is', null)
        .gte('recorded_at', dateFrom)
        .lte('recorded_at', dateTo)
        .limit(storageHeadLimit);

      const checkRows = toCheck ?? [];
      storageChecks = checkRows.length;

      console.log(`[daily-photo-reconciler] Storage HEAD checks: ${storageChecks}`);

      for (const row of checkRows) {
        try {
          const headResp = await fetch(row.photo_url, {
            method: 'HEAD',
            signal: AbortSignal.timeout(10000),
          });

          if (headResp.status === 404 || headResp.status === 403) {
            storageAnomalies.push({
              observation_id: row.observation_id,
              photo_url:      row.photo_url,
              status:         'not_found',
              http_status:    headResp.status,
            });

            // Add to missing_photo_queue
            await supabase.from('missing_photo_queue').upsert(
              {
                observation_id:  row.observation_id,
                organization_id: row.organization_id,
                reason:          'object_404',
                status:          'repairing',
                last_attempt_at: runAt,
                repair_notes:    `Storage HEAD check returned HTTP ${headResp.status} at ${runAt}`,
              },
              { onConflict: 'observation_id' },
            );

            // Audit
            await supabase.from('photo_recovery_audit_log').insert({
              observation_id:  row.observation_id,
              organization_id: row.organization_id,
              action:          'detect',
              source:          'storage-head-check',
              success:         true,
              error_message:   `HTTP ${headResp.status}`,
              meta:            { photo_url: row.photo_url, http_status: headResp.status },
              actor_label:     callerLabel,
              occurred_at:     runAt,
            });
          }
        } catch (headErr: unknown) {
          storageAnomalies.push({
            observation_id: row.observation_id,
            photo_url:      row.photo_url,
            status:         'error',
            error:          (headErr as Error).message,
          });
        }
      }

      console.log(`[daily-photo-reconciler] Storage 404s: ${storageAnomalies.length}`);
    }

    // -----------------------------------------------------------------------
    // Step 3: Alert on aged pending repairs (> 24 h)
    // -----------------------------------------------------------------------
    const agedThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Use a direct count query to avoid fragile head-query type inference
    const { data: agedPendingRows } = await supabase
      .from('missing_photo_queue')
      .select('id')
      .eq('status', 'pending')
      .lt('created_at', agedThreshold);

    const agedPendingCount = agedPendingRows?.length ?? 0;

    if (agedPendingCount > 0) {
      console.warn(`[daily-photo-reconciler] ${agedPendingCount} repairs aged > 24h`);

      await supabase.from('photo_recovery_audit_log').insert({
        observation_id:  null,
        organization_id: null,
        action:          'queue_updated',
        source:          'daily-reconciler',
        success:         false,
        error_message:   `${agedPendingCount} pending repairs aged > 24 hours`,
        meta:            { aged_pending: agedPendingCount, threshold: agedThreshold },
        actor_label:     callerLabel,
        occurred_at:     runAt,
      });
    }

    // -----------------------------------------------------------------------
    // Step 4: Queue status breakdown
    // -----------------------------------------------------------------------
    const { data: queueRows } = await supabase
      .from('missing_photo_queue')
      .select('status');

    const queueBreakdown: Record<string, number> = {};
    for (const row of queueRows ?? []) {
      queueBreakdown[row.status] = (queueBreakdown[row.status] ?? 0) + 1;
    }

    // -----------------------------------------------------------------------
    // Step 5: Photo integrity health summary
    // -----------------------------------------------------------------------
    const { data: obsStats } = await supabase
      .from('observations')
      .select('observation_id, photo_url, photo_hash', { count: 'exact' });

    const totalObs = obsStats?.length ?? 0;
    const withPhoto = (obsStats ?? []).filter(
      (o: { photo_url: string | null; photo_hash: string | null }) =>
        o.photo_url !== null && o.photo_hash !== null,
    ).length;
    const missingAny  = totalObs - withPhoto;
    const coveragePct = totalObs > 0 ? Math.round((100 * withPhoto) / totalObs * 100) / 100 : 100;
    const sloStatus =
      coveragePct >= 99.95 ? '✅ MEETS SLO'
      : coveragePct >= 99.0 ? '⚠️ AT RISK'
      : '❌ BELOW SLO';

    console.log(`[daily-photo-reconciler] Coverage: ${coveragePct}% (${sloStatus})`);

    // -----------------------------------------------------------------------
    // Step 6: Cleanup expired scan_idempotency_keys
    // -----------------------------------------------------------------------
    let idempotencyKeysCleaned = 0;
    if (cleanupIdempotency) {
      // scan_idempotency_keys may not exist in all deployments – use try/catch
      try {
        const { error: cleanupError, count } = await supabase
          .from('scan_idempotency_keys')
          .delete({ count: 'exact' })
          .lt('expires_at', runAt);

        if (!cleanupError) {
          idempotencyKeysCleaned = count ?? 0;
          console.log(`[daily-photo-reconciler] Cleaned ${idempotencyKeysCleaned} expired idempotency keys`);
        }
      } catch {
        // Table may not exist – not fatal
      }
    }

    // -----------------------------------------------------------------------
    // Build summary
    // -----------------------------------------------------------------------
    const summary: ReconcilerSummary = {
      run_at:                  runAt,
      newly_detected:          Number(newlyDetected),
      already_queued:          Number(alreadyQueued),
      storage_checks:          storageChecks,
      storage_404s:            storageAnomalies.length,
      aged_pending:            agedPendingCount,
      idempotency_keys_cleaned: idempotencyKeysCleaned,
      queue_breakdown:         queueBreakdown,
      integrity_health: {
        total_observations:   totalObs,
        with_photo:           withPhoto,
        missing_any:          missingAny,
        photo_coverage_pct:   coveragePct,
        slo_status:           sloStatus,
      },
      storage_anomalies: storageAnomalies.slice(0, 25),
    };

    // Final summary audit entry
    await supabase.from('photo_recovery_audit_log').insert({
      observation_id:  null,
      organization_id: null,
      action:          'detect',
      source:          'daily-reconciler',
      success:         missingAny === 0 && storageAnomalies.length === 0,
      meta:            summary as unknown as Record<string, unknown>,
      actor_label:     callerLabel,
      occurred_at:     runAt,
    });

    console.log('[daily-photo-reconciler] Run complete:', JSON.stringify({
      newly_detected:   summary.newly_detected,
      storage_404s:     summary.storage_404s,
      coverage_pct:     coveragePct,
      slo:              sloStatus,
    }));

    return json(200, { success: true, ...summary });
  } catch (err: unknown) {
    const msg = (err as Error)?.message ?? 'Internal server error';
    console.error('[daily-photo-reconciler] unhandled error:', msg);
    return json(500, { error: msg });
  }
});
