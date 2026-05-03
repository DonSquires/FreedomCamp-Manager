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
 *   - Per-transmission confidence rollups (top low-confidence transmissions)
 *   - Synthetic render count (phase 4 — always 0 until TTS relay ships)
 *
 * Query params:
 *   - since_hours  (default 24) — look-back window for recent stats
 */

import { withCors, jsonResponse, errorResponse } from '../_shared/withCors.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'

const ALLOWED_ROLES = new Set(['admin', 'master', 'grand_master'])
const LOW_CONFIDENCE_THRESHOLD = 0.5
const MAX_TRANSMISSION_ROLLUPS = 10

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
    { data: recentTransmissionRows, error: e7 },
    { data: recentSegmentRows, error: e8 },
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
      .lt('confidence', LOW_CONFIDENCE_THRESHOLD)
      .not('confidence', 'is', null),

    // Synthetic renders (Phase 4; expected 0 until TTS relay ships)
    supabaseAdmin
      .from('radio_tts_renders')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .gte('created_at', sinceTs),

    // Recent transmission rows for per-transmission confidence rollups.
    supabaseAdmin
      .from('radio_transmissions')
      .select('id, channel_id, speaker_name, started_at, is_emergency')
      .eq('org_id', orgId)
      .gte('started_at', sinceTs)
      .order('started_at', { ascending: false })
      .limit(500),

    // Recent segments for confidence aggregation by transmission.
    supabaseAdmin
      .from('radio_transcript_segments')
      .select('transmission_id, confidence')
      .eq('org_id', orgId)
      .gte('created_at', sinceTs)
      .order('created_at', { ascending: false })
      .limit(5000),
  ])

  if (e1 || e2 || e3 || e4 || e5 || e6 || e7 || e8) {
    console.error('radio-audit query errors', { e1, e2, e3, e4, e5, e6, e7, e8 })
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

  const recentTxRows = (recentTransmissionRows ?? []) as Array<{
    id: string
    channel_id: string
    speaker_name: string
    started_at: string
    is_emergency: boolean
  }>
  const recentSegRows = (recentSegmentRows ?? []) as Array<{
    transmission_id: string
    confidence: number | null
  }>

  const recentTxIdSet = new Set(recentTxRows.map((tx) => tx.id))
  const confidenceByTx = new Map<string, {
    segment_count: number
    scored_segment_count: number
    low_confidence_segments: number
    confidence_sum: number
  }>()

  for (const row of recentSegRows) {
    if (!recentTxIdSet.has(row.transmission_id)) continue
    const current = confidenceByTx.get(row.transmission_id) || {
      segment_count: 0,
      scored_segment_count: 0,
      low_confidence_segments: 0,
      confidence_sum: 0,
    }

    current.segment_count += 1

    const confidence = typeof row.confidence === 'number' ? row.confidence : null
    if (confidence !== null) {
      current.scored_segment_count += 1
      current.confidence_sum += confidence
      if (confidence < LOW_CONFIDENCE_THRESHOLD) {
        current.low_confidence_segments += 1
      }
    }

    confidenceByTx.set(row.transmission_id, current)
  }

  const transmissionRollups = recentTxRows
    .map((tx) => {
      const stats = confidenceByTx.get(tx.id)
      if (!stats || stats.segment_count === 0) return null

      const avgConfidence =
        stats.scored_segment_count > 0
          ? Math.round((stats.confidence_sum / stats.scored_segment_count) * 1000) / 1000
          : null
      const lowConfidencePct =
        stats.scored_segment_count > 0
          ? Math.round((stats.low_confidence_segments / stats.scored_segment_count) * 10000) / 100
          : null

      return {
        transmission_id: tx.id,
        channel_id: tx.channel_id,
        speaker_name: tx.speaker_name,
        started_at: tx.started_at,
        is_emergency: tx.is_emergency,
        segment_count: stats.segment_count,
        scored_segment_count: stats.scored_segment_count,
        avg_confidence: avgConfidence,
        low_confidence_segments: stats.low_confidence_segments,
        low_confidence_pct: lowConfidencePct,
      }
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((a, b) => {
      const pctA = a.low_confidence_pct ?? -1
      const pctB = b.low_confidence_pct ?? -1
      if (pctB !== pctA) return pctB - pctA
      if (b.low_confidence_segments !== a.low_confidence_segments) {
        return b.low_confidence_segments - a.low_confidence_segments
      }
      return b.segment_count - a.segment_count
    })
    .slice(0, MAX_TRANSMISSION_ROLLUPS)

  const transmissionsWithScoredSegments = transmissionRollups.filter((row) => row.scored_segment_count > 0).length
  const transmissionsWithLowConfidence = transmissionRollups.filter((row) => row.low_confidence_segments > 0).length

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
      confidence_rollups_recent: {
        threshold: LOW_CONFIDENCE_THRESHOLD,
        transmissions_with_scored_segments: transmissionsWithScoredSegments,
        transmissions_with_low_confidence: transmissionsWithLowConfidence,
        top_transmissions: transmissionRollups,
      },
    },
    synthetic_media: {
      // Phase 4 field — TTS renders. Always 0 until Translated Audio Relay ships.
      tts_renders_recent: syntheticRenders ?? 0,
      // All radio_tts_renders rows have is_synthetic=true enforced by CHECK constraint.
      tagging_enforced: true,
    },
  })
}))
