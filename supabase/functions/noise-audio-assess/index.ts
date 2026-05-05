/**
 * noise-audio-assess
 *
 * Runs Bob's field-audio noise assessment and returns matrix-prefill values
 * for the Noise Officer portal form.
 */

import { getCorsHeaders, withCors, jsonResponse, errorResponse } from '../_shared/withCors.ts'
import { requireAuth } from '../_shared/requireAuth.ts'
import { bobAssess } from '../_shared/bobInfer.ts'

function normalizeBaseUrl(raw?: string | null): string {
  return String(raw ?? '').trim().replace(/\/+$/, '')
}

const BOB_SERVICE_URL = normalizeBaseUrl(Deno.env.get('BOB_SERVICE_URL') || Deno.env.get('INFERENCE_SERVICE_URL') || '')

Deno.serve(withCors(async (req: Request) => {
  const authResult = await requireAuth(req)
  if (!authResult.user) {
    return new Response(
      JSON.stringify({ error: authResult.error ?? 'Unauthorized' }),
      { status: 401, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
    )
  }

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', req, 405)
  }

  if (!BOB_SERVICE_URL) {
    return errorResponse('BOB_SERVICE_URL or INFERENCE_SERVICE_URL is not configured', req, 503)
  }

  const body = await req.json().catch(() => ({}))

  // Validate: require at least audio or transcript
  const hasAudio = !!body?.audio_base64
  const hasTranscript = !!body?.transcript
  if (!hasAudio && !hasTranscript) {
    return errorResponse('Missing required field: audio_base64 or transcript', req, 400)
  }

  const payload = {
    transcript: body?.transcript ?? '',
    observed_db: body?.observed_db ?? null,
    time_category: body?.time_category ?? 'night',
    location_context: body?.location_context ?? '',
    complaint_address: body?.complaint_address ?? '',
    audio_base64: body?.audio_base64 ?? '',
    audio_mime_type: body?.audio_mime_type ?? 'audio/wav',
    matrix: body?.matrix && typeof body.matrix === 'object' ? body.matrix : {},
  }

  try {
    const result = await bobAssess({
      type: 'noise',
      description: payload.transcript || payload.location_context,
      context: payload,
    })
    
    // Normalize the response to ensure matrix fields are present
    const assessment = result.assessment ?? result
    const response = typeof assessment === 'object' ? assessment : { summary: String(assessment) }
    
    // Ensure expected fields for matrix prefill
    const normalized = {
      ...response,
      // Ensure matrix fields if not present
      volume_score: response.volume_score ?? response.volume ?? null,
      time_score: response.time_score ?? response.time ?? null,
      tone_score: response.tone_score ?? response.tone ?? null,
      noise_type: response.noise_type ?? response.type ?? 'unknown',
      noise_source: response.noise_source ?? response.source ?? null,
      exceeds_district_plan: response.exceeds_district_plan ?? response.exceeds ?? null,
      rationale: response.rationale ?? response.reasoning ?? response.summary ?? '',
    }
    
    return jsonResponse(normalized, req)
  } catch (err: any) {
    console.error('noise-audio-assess fetch error:', err?.message || String(err))
    return errorResponse(err?.message || 'Noise audio assessment unavailable', req, 502)
  }
}))
