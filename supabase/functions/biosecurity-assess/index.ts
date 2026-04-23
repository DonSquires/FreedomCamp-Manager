/**
 * biosecurity-assess
 *
 * Runs Bob AI plant identification on a submitted photo/video, persists the
 * assessment row in biosecurity_assessments, and returns the AI result with
 * a pre-populated officer checklist.
 *
 * POST body (JSON):
 *   {
 *     job_id?:         string  — biosecurity_jobs UUID (optional)
 *     image_base64:    string  — base64-encoded photo (required if no photo_url)
 *     photo_url?:      string  — already-uploaded photo URL
 *     video_frames?:   string[] — up to 8 base64 frames from video
 *     gps_lat?:        number
 *     gps_lng?:        number
 *     address?:        string
 *     context?:        object  — {region, address, notes}
 *   }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { getCorsHeaders, withCors, jsonResponse, errorResponse } from '../_shared/withCors.ts'
import { requireAuth } from '../_shared/requireAuth.ts'

const BOB_SERVICE_URL   = Deno.env.get('BOB_SERVICE_URL') || Deno.env.get('INFERENCE_SERVICE_URL') || ''
const BOB_API_KEY       = Deno.env.get('BOB_INFERENCE_API_KEY') ?? ''
const SUPABASE_URL      = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

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

  // Get the officer's org
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('organization_id')
    .eq('id', authResult.user.id)
    .single()

  if (!profile?.organization_id) {
    return errorResponse('User profile not found', req, 403)
  }

  const body = await req.json()

  const imageBase64   = body.image_base64 ?? null
  const videoFrames   = Array.isArray(body.video_frames) ? body.video_frames : []
  const gpsLat        = body.gps_lat ?? null
  const gpsLng        = body.gps_lng ?? null
  const address       = body.address ?? ''
  const jobId         = body.job_id ?? null
  const context       = body.context ?? {}

  if (!imageBase64) {
    return errorResponse('image_base64 is required', req, 400)
  }

  // ── 1. Call Bob inference service ─────────────────────────────────────────
  let aiResult: any = { success: false, reason: 'inference service not configured' }
  if (BOB_SERVICE_URL) {
    try {
      const formBody: Record<string, string> = {
        image_base64:       imageBase64,
        video_frames_base64: JSON.stringify(videoFrames),
        context:            JSON.stringify(context),
      }
      if (gpsLat != null) formBody.gps_lat = String(gpsLat)
      if (gpsLng != null) formBody.gps_lng = String(gpsLng)

      const inferResp = await fetch(
        /api\.runpod\.ai\/v2\/[^/]+\/?$/.test(BOB_SERVICE_URL)
          ? `${BOB_SERVICE_URL.replace(/\/+$/, '')}/runsync`
          : `${BOB_SERVICE_URL}/infer/biosecurity`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${BOB_API_KEY}`,
          },
          body: /api\.runpod\.ai\/v2\/[^/]+\/?$/.test(BOB_SERVICE_URL)
            ? JSON.stringify({ input: { action: 'assess', type: 'biosecurity', image_description: imageBase64 ? 'image provided' : 'no image', ...formBody } })
            : JSON.stringify(formBody),
          signal: AbortSignal.timeout(90_000),
        }
      )

      if (inferResp.ok) {
        const raw = await inferResp.json()
        aiResult = raw?.output ?? raw
      } else {
        const errText = await inferResp.text().catch(() => '')
        console.error('biosecurity-assess inference error:', inferResp.status, errText.slice(0, 200))
      }
    } catch (err: any) {
      console.error('biosecurity-assess fetch error:', err.message)
      aiResult = { success: false, reason: err.message }
    }
  }

  const identification = aiResult?.identification ?? aiResult
  const weather        = aiResult?.weather ?? null

  // ── 2. Persist assessment row ─────────────────────────────────────────────
  const assessmentData: Record<string, any> = {
    organization_id:           profile.organization_id,
    officer_id:                authResult.user.id,
    biosecurity_job_id:        jobId,
    address:                   address || '',
    gps_lat:                   gpsLat,
    gps_lng:                   gpsLng,
    // AI-populated fields
    plant_species:             identification?.dominant_species ?? null,
    species_list:              identification?.species ?? null,
    density_estimate:          identification?.total_density_per_m2 ?? null,
    density_category:          identification?.checklist_prefill?.density_category ?? null,
    infestation_stage:         identification?.infestation_stage ?? identification?.checklist_prefill?.infestation_stage ?? null,
    seed_heads_present:        identification?.seed_heads_present ?? null,
    basal_seeds_present:       identification?.basal_seeds_visible ?? null,
    cleistogenes_present:      identification?.checklist_prefill?.cleistogenes_present ?? null,
    leaf_texture_harsh:        identification?.leaf_texture_harsh ?? null,
    awn_visible:               identification?.awn_visible ?? null,
    location_type:             identification?.location_type ?? null,
    buffer_zone_breached:      identification?.buffer_zone_risk ?? null,
    stock_welfare_risk:        identification?.stock_welfare_risk ?? null,
    weather_conditions:        weather ?? null,
    ai_species_identification: identification,
    ai_confidence:             identification?.confidence ?? null,
    ai_recommendation:         identification?.recommended_action ?? null,
    checklist_responses:       identification?.checklist_prefill ?? null,
    recommended_action:        identification?.recommended_action ?? null,
    photos:                    body.photo_url ? [body.photo_url] : [],
  }

  const safeAssessmentData = pickKeys(assessmentData, [
    'organization_id', 'officer_id', 'biosecurity_job_id', 'address', 'gps_lat', 'gps_lng',
    'plant_species', 'species_list', 'density_estimate', 'density_category', 'infestation_stage',
    'seed_heads_present', 'basal_seeds_present', 'cleistogenes_present', 'leaf_texture_harsh',
    'awn_visible', 'location_type', 'buffer_zone_breached', 'stock_welfare_risk',
    'weather_conditions', 'ai_species_identification', 'ai_confidence', 'ai_recommendation',
    'checklist_responses', 'recommended_action', 'photos',
  ])

  const { data: assessment, error: insertErr } = await supabase
    .from('biosecurity_assessments')
    .insert(safeAssessmentData)
    .select('id')
    .single()

  if (insertErr) {
    console.error('biosecurity_assessments insert error:', insertErr)
    // Return AI result even if DB insert fails — officer can still use checklist
  }

  return jsonResponse({
    success: true,
    assessment_id: assessment?.id ?? null,
    identification,
    weather,
    checklist_prefill: identification?.checklist_prefill ?? null,
    recommended_action: identification?.recommended_action ?? null,
    ai_caution: identification?.ai_caution ?? 'AI identification is a screening aid. Officer must confirm species before issuing notices.',
  }, req)
}))
