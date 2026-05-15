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
    transmissionId?: string
    targetLanguage?: string
    segments?: Array<{
      transcriptSegmentId?: string
      sequenceNum?: number
      translatedText?: string
      text?: string
      confidence?: number
      provider?: string
    }>
  }

  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }

  const orgId = String(body.orgId ?? '').trim()
  const transmissionId = String(body.transmissionId ?? '').trim()
  const targetLanguage = String(body.targetLanguage ?? '').trim()
  const segments = Array.isArray(body.segments) ? body.segments : []

  if (!orgId || !transmissionId || !targetLanguage) {
    return json(400, { error: 'orgId, transmissionId, and targetLanguage are required' })
  }

  if (!segments.length) {
    return json(400, { error: 'segments array is required' })
  }

  const { data: transcriptRows, error: transcriptLookupError } = await supabase
    .from('radio_transcript_segments')
    .select('id, org_id, transmission_id, sequence_num')
    .eq('org_id', orgId)
    .eq('transmission_id', transmissionId)

  if (transcriptLookupError) {
    return json(500, {
      error: 'Could not load transcript segments for translation',
      details: transcriptLookupError.message,
    })
  }

  if (!Array.isArray(transcriptRows) || transcriptRows.length === 0) {
    return json(404, { error: 'No transcript segments found for transmission' })
  }

  const idBySequence = new Map<number, string>()
  for (const row of transcriptRows as Array<{ id: string; sequence_num: number }>) {
    idBySequence.set(Number(row.sequence_num), String(row.id))
  }

  const resolved = segments.map((segment) => {
    const explicitId = segment.transcriptSegmentId ? String(segment.transcriptSegmentId).trim() : ''
    const bySequence = Number.isFinite(Number(segment.sequenceNum))
      ? idBySequence.get(Number(segment.sequenceNum))
      : undefined

    return {
      transcriptSegmentId: explicitId || bySequence || '',
      text: String(segment.translatedText ?? segment.text ?? '').trim(),
      confidence: segment.confidence == null ? null : Number(segment.confidence),
      provider: segment.provider ? String(segment.provider) : null,
    }
  })

  const invalid = resolved.find((row) => !row.transcriptSegmentId || !row.text)
  if (invalid) {
    return json(400, {
      error: 'Each translation segment needs translated text and transcriptSegmentId or sequenceNum',
    })
  }

  const rows = resolved.map((segment) => ({
    org_id: orgId,
    transmission_id: transmissionId,
    transcript_segment_id: segment.transcriptSegmentId,
    target_language: targetLanguage,
    text: segment.text,
    confidence: segment.confidence,
    provider: segment.provider,
  }))

  // `transmission_id` is useful in API request/response but is not a column in
  // radio_translation_segments, so remove it before write.
  const writeRows = rows.map(({ transmission_id: _unusedTransmissionId, ...rest }) => rest)

  const { error: insertError } = await supabase
    .from('radio_translation_segments')
    .upsert(writeRows, { onConflict: 'transcript_segment_id,target_language' })

  if (insertError) {
    return json(500, {
      error: 'Translation segment write failed',
      details: insertError.message,
    })
  }

  return json(200, {
    ok: true,
    upserted: writeRows.length,
    transmissionId,
    targetLanguage,
    phase: 'phase-0-3',
  })
})
