import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const MAX_SEGMENTS_PER_REQUEST = 200
const STT_PROVIDER_NAMES = ['google', 'azure', 'whisper', 'custom'] as const

type SttProviderName = typeof STT_PROVIDER_NAMES[number]

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function normalizeProviderName(value: unknown): SttProviderName {
  const raw = String(value ?? 'custom').trim().toLowerCase()
  return STT_PROVIDER_NAMES.includes(raw as SttProviderName)
    ? (raw as SttProviderName)
    : 'custom'
}

function providerConfigured(provider: SttProviderName): boolean {
  if (provider === 'google') {
    return Boolean(
      Deno.env.get('GOOGLE_CLOUD_PROJECT')
      && (Deno.env.get('GOOGLE_APPLICATION_CREDENTIALS') || Deno.env.get('GOOGLE_APPLICATION_CREDENTIALS_JSON')),
    )
  }

  if (provider === 'azure') {
    return Boolean(Deno.env.get('AZURE_SPEECH_KEY') && Deno.env.get('AZURE_SPEECH_REGION'))
  }

  if (provider === 'whisper') {
    return Boolean(Deno.env.get('WHISPER_ENDPOINT') || Deno.env.get('OPENAI_API_KEY') || Deno.env.get('OLLAMA_BASE_URL'))
  }

  return Boolean(Deno.env.get('STT_PROVIDER_ENDPOINT') || Deno.env.get('INFERENCE_SERVICE_URL'))
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

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

  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('organization_id')
    .eq('id', authData.user.id)
    .maybeSingle()

  if (profileError || !profile?.organization_id) {
    return json(403, { error: 'Profile missing organization context' })
  }

  let body: {
    action?: string
    healthCheck?: boolean
    orgId?: string
    channelId?: string
    transmissionId?: string
    language?: string
    source?: string
    provider?: {
      name?: string
      requestId?: string
      model?: string
      region?: string
      latencyMs?: number
      pipeline?: string
    }
    segments?: Array<{
      sequenceNum?: number
      startMs?: number
      endMs?: number
      text?: string
      confidence?: number
      language?: string
      isFinal?: boolean
    }>
  }

  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }

  const orgId = String(body.orgId ?? (body as Record<string, unknown>).org_id ?? '').trim()
  const channelId = String(body.channelId ?? (body as Record<string, unknown>).channel_id ?? '').trim()
  const transmissionId = String(body.transmissionId ?? (body as Record<string, unknown>).transmission_id ?? '').trim()
  const defaultLanguage = String(body.language ?? 'en').trim() || 'en'
  const source = String(body.source ?? 'livekit_egress').trim() || 'livekit_egress'
  const providerName = normalizeProviderName(body.provider?.name)
  const providerRequestId = String(body.provider?.requestId ?? '').trim() || null
  const providerModel = String(body.provider?.model ?? '').trim() || null
  const providerRegion = String(body.provider?.region ?? '').trim() || null
  const providerPipeline = String(body.provider?.pipeline ?? '').trim() || null
  const providerLatencyMs = body.provider?.latencyMs == null ? null : Number(body.provider?.latencyMs)
  const action = String(body.action ?? (body as Record<string, unknown>).mode ?? '').trim().toLowerCase()
  const healthOnly = body.healthCheck === true
    || (body as Record<string, unknown>).health_check === true
    || action === 'health'
  const segments = Array.isArray(body.segments) ? body.segments : []

  if (providerLatencyMs != null && (Number.isNaN(providerLatencyMs) || providerLatencyMs < 0)) {
    return json(400, { error: 'provider.latencyMs must be a non-negative number when provided' })
  }

  if (healthOnly) {
    return json(200, {
      ok: true,
      phase: 'phase-0-2',
      mode: 'health',
      health: {
        provider: providerName,
        providerConfigured: providerConfigured(providerName),
        source,
        timestamp: new Date().toISOString(),
      },
    })
  }

  if (!orgId || !transmissionId) {
    return json(400, { error: 'orgId and transmissionId are required' })
  }

  if (!segments.length) {
    return json(400, { error: 'segments array is required' })
  }

  if (segments.length > MAX_SEGMENTS_PER_REQUEST) {
    return json(413, {
      error: 'Too many segments in a single request',
      maxSegmentsPerRequest: MAX_SEGMENTS_PER_REQUEST,
    })
  }

  const { data: transmission, error: transmissionError } = await supabase
    .from('radio_transmissions')
    .select('id, org_id, channel_id, metadata')
    .eq('id', transmissionId)
    .maybeSingle()

  if (transmissionError) {
    return json(500, {
      error: 'Could not verify transmission',
      details: transmissionError.message,
    })
  }

  if (!transmission) {
    return json(404, { error: 'Transmission not found' })
  }

  if (String((transmission as { org_id?: string }).org_id ?? '') !== orgId) {
    return json(403, { error: 'orgId does not match transmission scope' })
  }

  if (String(profile.organization_id) !== orgId) {
    return json(403, { error: 'Authenticated user cannot ingest segments for this orgId' })
  }

  const transmissionChannelId = String((transmission as { channel_id?: string }).channel_id ?? '')
  const resolvedChannelId = channelId || transmissionChannelId

  if (channelId && transmissionChannelId && transmissionChannelId !== channelId) {
    return json(400, { error: 'channelId does not match transmission' })
  }

  const normalizedRows = segments.map((segment, index) => ({
    org_id: orgId,
    channel_id: resolvedChannelId,
    transmission_id: transmissionId,
    sequence_num: Number(segment.sequenceNum ?? (segment as Record<string, unknown>).sequence_num ?? index + 1),
    segment_start_ms: Number(segment.startMs ?? (segment as Record<string, unknown>).start_ms ?? 0),
    segment_end_ms: Number(segment.endMs ?? (segment as Record<string, unknown>).end_ms ?? 0),
    text: String(segment.text ?? '').trim(),
    language: String(segment.language ?? (defaultLanguage || 'en')).trim() || 'en',
    confidence: segment.confidence == null ? null : Number(segment.confidence),
    is_final: Boolean(segment.isFinal ?? false),
  }))

  const invalidRow = normalizedRows.find((row) => (
    !row.text ||
    row.sequence_num < 1 ||
    Number.isNaN(row.sequence_num) ||
    Number.isNaN(row.segment_start_ms) ||
    Number.isNaN(row.segment_end_ms) ||
    row.segment_start_ms < 0 ||
    row.segment_end_ms < row.segment_start_ms ||
    (row.confidence != null && (Number.isNaN(row.confidence) || row.confidence < 0 || row.confidence > 1))
  ))

  if (invalidRow) {
    return json(400, {
      error: 'Invalid segment payload; ensure text, sequenceNum, startMs, endMs are valid and endMs >= startMs',
    })
  }

  // Last-write-wins per sequence_num inside the same request to ensure deterministic upserts.
  const dedupedBySequence = new Map<number, (typeof normalizedRows)[number]>()
  for (const row of normalizedRows) {
    dedupedBySequence.set(row.sequence_num, row)
  }
  const rows = Array.from(dedupedBySequence.values()).sort((a, b) => a.sequence_num - b.sequence_num)

  const { error: insertError } = await supabase
    .from('radio_transcript_segments')
    .upsert(rows, { onConflict: 'transmission_id,sequence_num' })

  if (insertError) {
    return json(500, {
      error: 'Transcript segment write failed',
      details: insertError.message,
    })
  }

  const sequenceMin = rows[0]?.sequence_num ?? null
  const sequenceMax = rows[rows.length - 1]?.sequence_num ?? null
  const existingMetadata = toRecord((transmission as { metadata?: unknown }).metadata)
  const existingStt = toRecord(existingMetadata.stt)
  const existingIngested = Number(existingStt.total_segments_ingested ?? 0)

  const nextMetadata = {
    ...existingMetadata,
    stt: {
      ...existingStt,
      provider: providerName,
      source,
      model: providerModel,
      region: providerRegion,
      pipeline: providerPipeline,
      last_request_id: providerRequestId,
      last_latency_ms: providerLatencyMs,
      last_ingest_at: new Date().toISOString(),
      total_segments_ingested: Number.isFinite(existingIngested) ? existingIngested + rows.length : rows.length,
      max_sequence_ingested: sequenceMax,
    },
  }

  const { error: metadataUpdateError } = await supabase
    .from('radio_transmissions')
    .update({ metadata: nextMetadata })
    .eq('id', transmissionId)

  if (metadataUpdateError) {
    console.warn('ingest-transcript-segments: metadata update failed', metadataUpdateError.message)
  }

  return json(200, {
    ok: true,
    upserted: rows.length,
    received: segments.length,
    transmissionId,
    channelId: resolvedChannelId,
    trace: {
      provider: providerName,
      providerRequestId,
      source,
      sequenceMin,
      sequenceMax,
      providerConfigured: providerConfigured(providerName),
    },
    phase: 'phase-0-2',
  })
})
