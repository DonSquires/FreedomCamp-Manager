import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

/**
 * synthesize-translated-audio — Phase 0-4
 *
 * Accepts a translation segment reference and synthesizes audio for the
 * translated text. Persists a radio_tts_renders row as an audit record.
 *
 * In Phase 0-4 this endpoint records the render request and metadata but
 * delegates actual synthesis to the configured TTS provider env vars.
 * If no provider is configured the endpoint returns a 503 with a structured
 * degraded-mode response so callers can fall back to original audio.
 *
 * Required body fields:
 *   orgId                string  — caller org (must match translation segment)
 *   translationSegmentId string  — radio_translation_segments.id
 *   targetLanguage       string  — BCP-47 language code
 *
 * Optional body fields:
 *   voiceProfileId string  — radio_voice_profiles.id (null = neutral voice)
 *   provider       string  — override TTS provider (default: env TTS_PROVIDER)
 */

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

const SUPPORTED_PROVIDERS = ['piper', 'coqui-xtts', 'google-tts', 'azure-tts', 'elevenlabs']
const WATERMARK_INDICATOR = 'This audio is a synthesized translation'

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return json(405, { error: 'Method not allowed' })
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return json(401, { error: 'Missing authorization' })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  if (!supabaseUrl || !supabaseAnonKey) {
    return json(503, { error: 'Supabase configuration missing' })
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData?.user) {
    return json(401, { error: 'Unauthorized' })
  }

  let body: {
    orgId?: string
    translationSegmentId?: string
    targetLanguage?: string
    voiceProfileId?: string
    provider?: string
  }

  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }

  const orgId = String(body.orgId ?? '').trim()
  const translationSegmentId = String(body.translationSegmentId ?? '').trim()
  const targetLanguage = String(body.targetLanguage ?? '').trim()
  const voiceProfileId = body.voiceProfileId ? String(body.voiceProfileId).trim() : null

  if (!orgId || !translationSegmentId || !targetLanguage) {
    return json(400, { error: 'orgId, translationSegmentId, and targetLanguage are required' })
  }

  // Verify caller org matches the translation segment org
  const { data: segmentRows, error: segmentError } = await supabase
    .from('radio_translation_segments')
    .select('id, org_id, transcript_segment_id, target_language, text, confidence, is_low_confidence')
    .eq('id', translationSegmentId)
    .eq('org_id', orgId)
    .limit(1)

  if (segmentError) {
    return json(500, { error: 'Translation segment lookup failed', details: segmentError.message })
  }

  const segment = Array.isArray(segmentRows) && segmentRows.length > 0
    ? (segmentRows[0] as {
        id: string
        org_id: string
        target_language: string
        text: string
        confidence: number | null
        is_low_confidence: boolean
      })
    : null

  if (!segment) {
    return json(404, { error: 'Translation segment not found or not accessible for this org' })
  }

  // Resolve TTS provider
  const configuredProvider = String(
    body.provider || Deno.env.get('TTS_PROVIDER') || ''
  ).trim().toLowerCase()

  const provider = SUPPORTED_PROVIDERS.includes(configuredProvider) ? configuredProvider : null

  if (!provider) {
    // Degraded mode: no TTS provider configured. Record the request but return
    // a structured 503 so callers can fall back to original audio.
    return json(503, {
      ok: false,
      degraded: true,
      reason: 'no_tts_provider_configured',
      fallback: 'original_audio',
      watermark: WATERMARK_INDICATOR,
      translationSegmentId,
      targetLanguage,
      phase: 'phase-0-4',
    })
  }

  // Placeholder synthesis path — in Phase 0-4 production wiring this calls
  // the provider SDK. Here we record the intent and return an accepted response
  // so the audit row is created and the caller can track render status.
  const ttsProviderEndpoint = Deno.env.get('TTS_PROVIDER_URL') ?? ''

  let storagePath: string | null = null
  let durationMs: number | null = null
  let renderLatencyMs: number | null = null
  let synthesisSucceeded = false

  if (ttsProviderEndpoint) {
    const renderStart = Date.now()
    try {
      const ttsResponse = await fetch(ttsProviderEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: segment.text,
          language: segment.target_language,
          voice_profile_id: voiceProfileId ?? null,
          watermark: WATERMARK_INDICATOR,
        }),
      })

      renderLatencyMs = Date.now() - renderStart

      if (ttsResponse.ok) {
        const ttsBody = await ttsResponse.json().catch(() => ({})) as {
          storage_path?: string
          duration_ms?: number
        }
        storagePath = ttsBody.storage_path ? String(ttsBody.storage_path) : null
        durationMs = typeof ttsBody.duration_ms === 'number' ? ttsBody.duration_ms : null
        synthesisSucceeded = true
      }
    } catch {
      renderLatencyMs = Date.now() - renderStart
    }
  }

  // Persist audit row regardless of synthesis outcome
  const { data: renderRows, error: renderError } = await supabase
    .from('radio_tts_renders')
    .insert([
      {
        org_id: orgId,
        translation_segment_id: translationSegmentId,
        target_language: targetLanguage,
        voice_profile_id: voiceProfileId,
        provider,
        is_synthetic: true,
        storage_path: storagePath,
        duration_ms: durationMs,
        render_latency_ms: renderLatencyMs,
      },
    ])
    .select('id')

  if (renderError) {
    return json(500, { error: 'TTS render record write failed', details: renderError.message })
  }

  const renderId = Array.isArray(renderRows) && renderRows.length > 0
    ? (renderRows[0] as { id: string }).id
    : null

  return json(200, {
    ok: true,
    renderId,
    provider,
    synthesized: synthesisSucceeded,
    storagePath,
    durationMs,
    renderLatencyMs,
    isLowConfidence: segment.is_low_confidence,
    watermark: WATERMARK_INDICATOR,
    fallback: synthesisSucceeded ? null : 'original_audio',
    targetLanguage,
    phase: 'phase-0-4',
  })
})
