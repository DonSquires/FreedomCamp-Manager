import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
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

  let body: {
    orgId?: string
    channelId?: string
    transmissionId?: string
    language?: string
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

  const orgId = String(body.orgId ?? '').trim()
  const channelId = String(body.channelId ?? '').trim()
  const transmissionId = String(body.transmissionId ?? '').trim()
  const defaultLanguage = String(body.language ?? 'en').trim() || 'en'
  const segments = Array.isArray(body.segments) ? body.segments : []

  if (!orgId || !channelId || !transmissionId) {
    return json(400, { error: 'orgId, channelId, and transmissionId are required' })
  }

  if (!segments.length) {
    return json(400, { error: 'segments array is required' })
  }

  const { data: transmission, error: transmissionError } = await supabase
    .from('radio_transmissions')
    .select('id, org_id, channel_id')
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

  if (channelId && String((transmission as { channel_id?: string }).channel_id ?? '') !== channelId) {
    return json(400, { error: 'channelId does not match transmission' })
  }

  const rows = segments.map((segment, index) => ({
    org_id: orgId,
    transmission_id: transmissionId,
    sequence_num: Number(segment.sequenceNum ?? index + 1),
    segment_start_ms: Number(segment.startMs ?? 0),
    segment_end_ms: Number(segment.endMs ?? 0),
    text: String(segment.text ?? '').trim(),
    language: String(segment.language ?? defaultLanguage || 'en').trim() || 'en',
    confidence: segment.confidence == null ? null : Number(segment.confidence),
    is_final: Boolean(segment.isFinal ?? false),
  }))

  const invalidRow = rows.find((row) => (
    !row.text ||
    Number.isNaN(row.sequence_num) ||
    Number.isNaN(row.segment_start_ms) ||
    Number.isNaN(row.segment_end_ms) ||
    row.segment_end_ms < row.segment_start_ms
  ))

  if (invalidRow) {
    return json(400, {
      error: 'Invalid segment payload; ensure text, sequenceNum, startMs, endMs are valid and endMs >= startMs',
    })
  }

  const { error: insertError } = await supabase
    .from('radio_transcript_segments')
    .upsert(rows, { onConflict: 'transmission_id,sequence_num' })

  if (insertError) {
    return json(500, {
      error: 'Transcript segment write failed',
      details: insertError.message,
    })
  }

  return json(200, {
    ok: true,
    upserted: rows.length,
    transmissionId,
    channelId: String((transmission as { channel_id?: string }).channel_id ?? ''),
    phase: 'phase-0-2',
  })
})
