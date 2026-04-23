/**
 * smoke-assess
 *
 * Runs Bob AI smoke complaint assessment on a submitted photo/video, persists
 * the assessment row in smoke_assessments, and returns the AI result with a
 * pre-populated officer checklist.
 *
 * POST body (JSON):
 *   {
 *     job_id?:              string  — smoke_jobs UUID (optional)
 *     image_base64:         string  — base64-encoded photo (required)
 *     video_frames?:        string[] — up to 8 base64 frames from video
 *     gps_lat?:             number
 *     gps_lng?:             number
 *     address?:             string
 *     complaint_time?:      string  — ISO timestamp of original complaint
 *     duration_reported?:   number  — minutes smoke has been observed
 *   }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { getCorsHeaders, withCors, jsonResponse, errorResponse } from '../_shared/withCors.ts'
import { requireAuth } from '../_shared/requireAuth.ts'

const BOB_SERVICE_URL  = Deno.env.get('BOB_SERVICE_URL') || Deno.env.get('INFERENCE_SERVICE_URL') || ''
const BOB_API_KEY      = Deno.env.get('BOB_INFERENCE_API_KEY') ?? ''
const SUPABASE_URL     = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

function pickKeys<T extends Record<string, unknown>>(obj: T, keys: Array<keyof T>): Partial<T> {
  const picked: Partial<T> = {}
  for (const key of keys) {
    if (obj[key] !== undefined) picked[key] = obj[key]
  }
  return picked
}

Deno.serve(withCors(async (req: Request) => {
  const authResult = await requireAuth(req)
  if (!authResult.user) {
    return new Response(
      JSON.stringify({ error: authResult.error ?? 'Unauthorized' }),
      { status: 401, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    )
  }

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', req, 405)
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('organization_id')
    .eq('id', authResult.user.id)
    .single()

  if (!profile?.organization_id) {
    return errorResponse('User profile not found', req, 403)
  }

  const body = await req.json()

  const imageBase64         = body.image_base64 ?? null
  const videoFrames         = Array.isArray(body.video_frames) ? body.video_frames : []
  const gpsLat              = body.gps_lat ?? null
  const gpsLng              = body.gps_lng ?? null
  const address             = body.address ?? ''
  const jobId               = body.job_id ?? null
  const complaintTime       = body.complaint_time ?? null
  const durationReported    = body.duration_reported ?? null

  if (!imageBase64) {
    return errorResponse('image_base64 is required', req, 400)
  }

  // ── 1. Call Bob inference service ─────────────────────────────────────────
  let aiResult: any = { success: false, reason: 'inference service not configured' }
  if (BOB_SERVICE_URL) {
    try {
      const metadata: Record<string, any> = { address }
      if (complaintTime) metadata.complaint_time = complaintTime
      if (durationReported) metadata.duration_reported_mins = durationReported

      const inferBody: Record<string, any> = {
        image_base64:        imageBase64,
        video_frames_base64: JSON.stringify(videoFrames),
        metadata:            JSON.stringify(metadata),
      }
      if (gpsLat != null) inferBody.gps_lat = gpsLat
      if (gpsLng != null) inferBody.gps_lng = gpsLng

      const inferResp = await fetch(
        /api\.runpod\.ai\/v2\/[^/]+\/?$/.test(BOB_SERVICE_URL)
          ? `${BOB_SERVICE_URL.replace(/\/+$/, '')}/runsync`
          : `${BOB_SERVICE_URL}/infer/smoke`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(/api\.runpod\.ai/.test(BOB_SERVICE_URL)
              ? { 'Authorization': `Bearer ${BOB_API_KEY}` }
              : { 'Authorization': `Bearer ${BOB_API_KEY}` }),
          },
          body: /api\.runpod\.ai\/v2\/[^/]+\/?$/.test(BOB_SERVICE_URL)
            ? JSON.stringify({ input: { action: 'assess', type: 'smoke', image_description: imageBase64 ? 'image provided' : 'no image', ...inferBody } })
            : JSON.stringify(inferBody),
          signal: AbortSignal.timeout(90_000),
        }
      )

      if (inferResp.ok) {
        const raw = await inferResp.json()
        // Unwrap RunPod /runsync envelope
        aiResult = raw?.output ?? raw
      } else {
        const errText = await inferResp.text().catch(() => '')
        console.error('smoke-assess inference error:', inferResp.status, errText.slice(0, 200))
      }
    } catch (err: any) {
      console.error('smoke-assess fetch error:', err.message)
      aiResult = { success: false, reason: err.message }
    }
  }

  const assessment = aiResult?.assessment ?? aiResult
  const weather    = aiResult?.weather ?? null

  // Auto-derive is_out_of_hours
  let isOutOfHours = false
  if (complaintTime) {
    const t = new Date(complaintTime)
    const nzHour = new Date(t.toLocaleString('en-US', { timeZone: 'Pacific/Auckland' })).getHours()
    isOutOfHours = nzHour < 7 || nzHour >= 22
  }

  // ── 2. Persist assessment row ─────────────────────────────────────────────
  const assessData: Record<string, any> = {
    organization_id:               profile.organization_id,
    officer_id:                    authResult.user.id,
    smoke_job_id:                  jobId,
    address:                       address || '',
    gps_lat:                       gpsLat,
    gps_lng:                       gpsLng,
    smoke_opacity:                 assessment?.smoke_opacity ?? null,
    smoke_color:                   assessment?.smoke_color ?? null,
    smoke_continuous:              assessment?.smoke_continuous ?? null,
    fire_type:                     assessment?.fire_type ?? null,
    prohibited_materials_suspected: assessment?.prohibited_materials_suspected ?? false,
    materials_checklist:           assessment?.materials_checklist ?? null,
    odor_description:              assessment?.odor_category ?? null,
    odor_offensive:                assessment?.offensive_objectionable_rating
                                     ? assessment.offensive_objectionable_rating >= 3
                                     : null,
    wind_direction:                assessment?.wind_direction_visible ?? weather?.wind_direction ?? null,
    wind_speed_kmh:                weather?.wind_speed_kmh ?? null,
    smoke_affecting_neighbors:     assessment?.smoke_affecting_neighbors ?? null,
    smoke_affecting_road:          assessment?.smoke_affecting_road ?? null,
    weather_conditions:            weather ?? null,
    ai_assessment:                 assessment,
    ai_confidence:                 assessment?.confidence ?? null,
    ai_recommendation:             assessment?.recommended_action ?? null,
    checklist_responses:           assessment?.checklist_prefill ?? null,
    recommended_action:            assessment?.recommended_action ?? null,
    photos:                        body.photo_url ? [body.photo_url] : [],
  }

  const safeAssessData = pickKeys(assessData, [
    'organization_id', 'officer_id', 'smoke_job_id', 'address', 'gps_lat', 'gps_lng',
    'smoke_opacity', 'smoke_color', 'smoke_continuous', 'fire_type',
    'prohibited_materials_suspected', 'materials_checklist', 'odor_description', 'odor_offensive',
    'wind_direction', 'wind_speed_kmh', 'smoke_affecting_neighbors', 'smoke_affecting_road',
    'weather_conditions', 'ai_assessment', 'ai_confidence', 'ai_recommendation',
    'checklist_responses', 'recommended_action', 'photos',
  ])

  const { data: assessRow, error: insertErr } = await supabase
    .from('smoke_assessments')
    .insert(safeAssessData)
    .select('id')
    .single()

  if (insertErr) {
    console.error('smoke_assessments insert error:', insertErr)
  }

  // Update job is_out_of_hours if job_id provided
  if (jobId && complaintTime) {
    await supabase
      .from('smoke_jobs')
      .update({ is_out_of_hours: isOutOfHours })
      .eq('id', jobId)
  }

  return jsonResponse({
    success: true,
    assessment_id: assessRow?.id ?? null,
    assessment,
    weather,
    checklist_prefill: assessment?.checklist_prefill ?? null,
    recommended_action: assessment?.recommended_action ?? null,
    offensive_rating: assessment?.offensive_objectionable_rating ?? null,
    ai_caution: assessment?.ai_caution ?? 'AI assessment is a screening aid. Officer professional judgment governs.',
  }, req)
}))
