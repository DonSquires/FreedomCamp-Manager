/**
 * radio-audit Edge Function
 *
 * Phase 1 Group E — Trust and Operations
 *
 * Returns org-scoped radio transmission audit statistics. Restricted to
 * admin and master roles. Provides:
 *   - Total transmissions (all-time and last 24h)
 *   - Emergency transmission count
 *   - Transcript coverage (transmissions with at least one segment)
 *   - Low-confidence segments (confidence < 0.5)
 *   - Synthetic render count (phase 4 — always 0 until TTS relay ships)
 *
 * Query params:
 *   - since_hours  (default 24) — look-back window for recent stats
 */

import { withCors, jsonResponse, errorResponse } from '../_shared/withCors.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'

const ALLOWED_ROLES = new Set(['admin', 'master', 'grand_master'])

Deno.serve(withCors(async (req: Request) => {
  if (req.method !== 'GET') {
    return errorResponse('Method not allowed', 405)
  }

  // ── Auth ─────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return errorResponse('Missing authorization', 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return errorResponse('Unauthorized', 401)
  }

  // ── Profile + role check ──────────────────────────────────────────────────
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    return errorResponse('Profile not found', 403)
  }

  if (!ALLOWED_ROLES.has(profile.role)) {
    return errorResponse('Insufficient role — admin or master required', 403)
  }

  const orgId: string = profile.organization_id

  // ── Query params ──────────────────────────────────────────────────────────
  const url = new URL(req.url)
  const sinceHours = Math.min(
    720, // cap at 30 days
    Math.max(1, parseInt(url.searchParams.get('since_hours') || '24', 10) || 24)
  )
  const sinceTs = new Date(Date.now() - sinceHours * 3600 * 1000).toISOString()

  // ── Service-role client for aggregate queries ─────────────────────────────
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

  // ── Fetch transmission stats ──────────────────────────────────────────────
  const [
    { count: totalTransmissions, error: e1 },
    { count: recentTransmissions, error: e2 },
    { count: emergencyTransmissions, error: e3 },
    { data: coverageRows, error: e4 },
    { count: lowConfidenceSegments, error: e5 },
    { count: syntheticRenders, error: e6 },
  ] = await Promise.all([
    // Total transmissions for this org
    supabaseAdmin
      .from('radio_transmissions')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', orgId),

    // Recent transmissions (within look-back window)
    supabaseAdmin
      .from('radio_transmissions')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .gte('started_at', sinceTs),

    // Emergency transmissions (recent)
    supabaseAdmin
      .from('radio_transmissions')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('is_emergency', true)
      .gte('started_at', sinceTs),

    // Transmissions with at least 1 transcript segment (for coverage ratio)
    supabaseAdmin
      .from('radio_transcript_segments')
      .select('transmission_id')
      .eq('org_id', orgId)
      .gte('created_at', sinceTs),

    // Low-confidence transcript segments (confidence < 0.5 and not null)
    supabaseAdmin
      .from('radio_transcript_segments')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .gte('created_at', sinceTs)
      .lt('confidence', 0.5)
      .not('confidence', 'is', null),

    // Synthetic renders (Phase 4; expected 0 until TTS relay ships)
    supabaseAdmin
      .from('radio_tts_renders')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .gte('created_at', sinceTs),
  ])

  if (e1 || e2 || e3 || e4 || e5 || e6) {
    console.error('radio-audit query errors', { e1, e2, e3, e4, e5, e6 })
    return errorResponse('Audit query failed', 500)
  }

  // Unique transmissions covered by at least one transcript segment
  const coveredTransmissionIds = new Set<string>(
    (coverageRows ?? []).map((r: { transmission_id: string }) => r.transmission_id)
  )
  const transcriptCoveredCount = coveredTransmissionIds.size
  const coveragePct =
    (recentTransmissions ?? 0) > 0
      ? Math.round((transcriptCoveredCount / (recentTransmissions as number)) * 10000) / 100
      : null

  return jsonResponse({
    org_id: orgId,
    window_hours: sinceHours,
    since: sinceTs,
    generated_at: new Date().toISOString(),
    transmissions: {
      total_all_time: totalTransmissions ?? 0,
      recent: recentTransmissions ?? 0,
      emergency_recent: emergencyTransmissions ?? 0,
    },
    transcript_pipeline: {
      covered_recent: transcriptCoveredCount,
      coverage_pct: coveragePct,
      low_confidence_segments_recent: lowConfidenceSegments ?? 0,
    },
    synthetic_media: {
      // Phase 4 field — TTS renders. Always 0 until Translated Audio Relay ships.
      tts_renders_recent: syntheticRenders ?? 0,
      // All radio_tts_renders rows have is_synthetic=true enforced by CHECK constraint.
      tagging_enforced: true,
    },
  })
}))
