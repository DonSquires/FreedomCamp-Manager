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
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return json(503, { error: 'Supabase configuration missing' })
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData?.user) {
    return json(401, { error: 'Unauthorized' })
  }

  const admin = createClient(supabaseUrl, serviceRoleKey)

  let body: {
    orgId?: string
    transmissionId?: string
    targetLanguage?: string
    segments?: Array<{
      transcriptSegmentId?: string
      originalText?: string
      translatedText?: string
      confidence?: number
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

  // Phase 0-3 scaffold: persist translation output when table exists.
  const rows = segments.map((segment) => ({
    org_id: orgId,
    transmission_id: transmissionId,
    transcript_segment_id: segment.transcriptSegmentId ? String(segment.transcriptSegmentId) : null,
    target_language: targetLanguage,
    source_text: String(segment.originalText ?? '').trim(),
    translated_text: String(segment.translatedText ?? '').trim(),
    confidence: segment.confidence == null ? null : Number(segment.confidence),
    source: 'phase0_scaffold',
  }))

  const { error: insertError } = await admin
    .from('radio_translation_segments')
    .insert(rows)

  if (insertError) {
    return json(501, {
      error: 'Translation segment table not ready',
      details: insertError.message,
      phase: 'phase-0-3-scaffold',
    })
  }

  return json(200, {
    ok: true,
    inserted: rows.length,
    transmissionId,
    targetLanguage,
    phase: 'phase-0-3-scaffold',
  })
})
