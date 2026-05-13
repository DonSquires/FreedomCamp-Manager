// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { getCorsHeaders } from '../_shared/withCors.ts'
import { collectDirectOrgIds } from '../_shared/orgAccess.ts'

const INFERENCE_SERVICE_URL = (Deno.env.get('INFERENCE_SERVICE_URL') || '').replace(/\/$/, '')
const INFERENCE_API_KEY =
  Deno.env.get('INFERENCE_API_KEY') ||
  Deno.env.get('RUNPOD_ENDPOINT_API_KEY') ||
  Deno.env.get('RUNPOD_API_KEY') ||
  Deno.env.get('BOB_INFERENCE_API_KEY') ||
  ''

const ALLOWED_ROLES = new Set(['admin', 'admin_officer', 'master'])
const VIDEO_BUCKET = (Deno.env.get('VIDEO_BRIEFING_BUCKET') || 'briefing-videos').trim()

function json(req: Request, data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
  })
}

function parseUuidArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v || '').trim()).filter(Boolean)
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return parsed.map((v) => String(v || '').trim()).filter(Boolean)
    } catch {
      return value.split(',').map((v) => v.trim()).filter(Boolean)
    }
  }
  return []
}

function isRunpodServerless(url: string): boolean {
  return url.includes('runpod.io') || url.includes('/runsync')
}

function decodeBase64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function maybeCallVideoGenerator(payload: Record<string, unknown>) {
  if (!INFERENCE_SERVICE_URL) return { provider: 'mock-video', model_used: 'placeholder' }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (INFERENCE_API_KEY) {
    headers.Authorization = `Bearer ${INFERENCE_API_KEY}`
    headers['x-inference-api-key'] = INFERENCE_API_KEY
  }

  try {
    if (isRunpodServerless(INFERENCE_SERVICE_URL)) {
      const resp = await fetch(`${INFERENCE_SERVICE_URL}/runsync`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          executionTimeout: 120000,
          input: {
            action: 'generate_briefing_video',
            ...payload,
          },
        }),
      })
      if (!resp.ok) throw new Error(`runpod returned ${resp.status}`)
      const body = await resp.json()
      return body?.output || body
    }

    const resp = await fetch(`${INFERENCE_SERVICE_URL}/infer/video/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })
    if (!resp.ok) throw new Error(`inference-service returned ${resp.status}`)
    return await resp.json()
  } catch {
    return { provider: 'mock-video', model_used: 'placeholder' }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) })
  }
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.replace('Bearer ', '').trim()
  if (!token) return json(req, { error: 'Authentication required' }, 401)

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const { data: auth, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !auth?.user) return json(req, { error: 'Invalid or expired session' }, 401)

  const user = auth.user
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json(req, { error: 'Invalid JSON body' }, 400)
  }

  const { data: profile, error: profileError } = await (supabaseAdmin.from('user_profiles') as any)
    .select('role, organization_id, extra_organization_ids')
    .eq('id', user.id)
    .maybeSingle()

  if (profileError || !profile) return json(req, { error: 'User profile not found' }, 403)
  const userRole = String(profile.role || '').trim()
  if (!ALLOWED_ROLES.has(userRole)) {
    return json(req, { error: 'Insufficient role to generate briefing video' }, 403)
  }

  const requestedOrgId = String(body.org_id || '').trim()
  const primaryOrgId = String(profile.organization_id || '').trim()
  const allowedOrgIds = collectDirectOrgIds({
    organization_id: primaryOrgId || null,
    employer_organization_id: null,
    extra_organization_ids: parseUuidArray(profile.extra_organization_ids),
    authorized_work_locations: null,
  })
  const orgId = requestedOrgId || primaryOrgId

  if (!orgId || !allowedOrgIds.has(orgId)) {
    return json(req, { error: 'Organization access denied for requested org_id' }, 403)
  }

  const purpose = String(body.purpose || 'briefing').trim().toLowerCase()
  if (!['research', 'training', 'briefing'].includes(purpose)) {
    return json(req, { error: 'purpose must be one of research, training, briefing' }, 400)
  }

  const mediaLogPayload = {
    org_id: orgId,
    actor_user_id: user.id,
    media_type: 'video',
    purpose,
    source_entity_type: String(body.source_entity_type || 'incident').trim() || null,
    source_entity_id: body.source_entity_id || null,
    provider: 'pending',
    model_name: String(body.model || '').trim() || null,
    model_version: null,
    output_url: null,
    source_hash: String(body.source_hash || '').trim() || null,
    output_hash: null,
    retention_days: Number(body.retention_days || 90),
  }

  const { data: mediaLog, error: mediaInsertError } = await (supabaseAdmin.from('media_generation_log') as any)
    .insert(mediaLogPayload)
    .select('id, created_at')
    .single()

  if (mediaInsertError || !mediaLog) {
    return json(req, { error: `Unable to create media log: ${mediaInsertError?.message || 'unknown error'}` }, 500)
  }

  const quality = String(body.quality || 'medium').trim().toLowerCase()
  const format = String(body.format || 'mp4').trim().toLowerCase()
  const generationResult = await maybeCallVideoGenerator({
    org_id: orgId,
    quality,
    format,
    incident_id: body.incident_id || null,
    breach_id: body.breach_id || null,
    source_entity_type: body.source_entity_type || null,
    source_entity_id: body.source_entity_id || null,
    title: body.title || null,
    notes: body.notes || null,
  })

  let generatedOutputUrl =
    String((generationResult as Record<string, unknown>)?.output_url || '').trim() ||
    `briefings/${orgId}/${mediaLog.id}.${format}`

  const provider = String((generationResult as Record<string, unknown>)?.provider || 'mock-video').trim()
  const modelUsed = String((generationResult as Record<string, unknown>)?.model_used || body.model || 'placeholder').trim()
  const outputHash = String((generationResult as Record<string, unknown>)?.output_hash || '').trim() || null
  const durationSeconds = Number((generationResult as Record<string, unknown>)?.duration_seconds || body.duration_seconds || 0)

  const videoBase64 = String((generationResult as Record<string, unknown>)?.video_base64 || '').trim()
  const mimeType = String((generationResult as Record<string, unknown>)?.mime_type || '').trim() || 'video/mp4'

  if (videoBase64) {
    const storagePath = `briefings/${orgId}/${mediaLog.id}.${format}`
    try {
      const decoded = decodeBase64ToBytes(videoBase64)
      const { error: uploadError } = await supabaseAdmin.storage.from(VIDEO_BUCKET).upload(storagePath, decoded, {
        contentType: mimeType,
        upsert: true,
      })

      if (!uploadError) {
        const { data: publicUrlData } = supabaseAdmin.storage.from(VIDEO_BUCKET).getPublicUrl(storagePath)
        generatedOutputUrl = String(publicUrlData?.publicUrl || '').trim() || `storage://${VIDEO_BUCKET}/${storagePath}`
      }
    } catch {
      // Keep the inference output URL fallback when storage upload fails.
    }
  }

  const { error: mediaUpdateError } = await (supabaseAdmin.from('media_generation_log') as any)
    .update({
      provider,
      model_name: modelUsed || null,
      output_url: generatedOutputUrl,
      output_hash: outputHash,
      updated_at: new Date().toISOString(),
    })
    .eq('id', mediaLog.id)

  if (mediaUpdateError) {
    return json(req, { error: `Unable to finalize media log: ${mediaUpdateError.message}` }, 500)
  }

  const { data: pack, error: packInsertError } = await (supabaseAdmin.from('video_briefing_packs') as any)
    .insert({
      org_id: orgId,
      actor_user_id: user.id,
      media_log_id: mediaLog.id,
      title: String(body.title || 'Operational Briefing Pack').trim(),
      description: String(body.description || '').trim() || null,
      duration_seconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
      format,
      bitrate_tier: ['low', 'medium', 'high'].includes(quality) ? quality : 'medium',
      output_url: generatedOutputUrl,
    })
    .select('id, created_at, output_url')
    .single()

  if (packInsertError || !pack) {
    return json(req, { error: `Unable to create video briefing pack: ${packInsertError?.message || 'unknown error'}` }, 500)
  }

  return json(req, {
    success: true,
    provider,
    model_used: modelUsed,
    media_log_id: mediaLog.id,
    video_pack_id: pack.id,
    output_url: pack.output_url,
    generated_at: pack.created_at,
    note: provider === 'mock-video'
      ? 'Generation recorded in scaffold mode; hook inference endpoint for real rendering.'
      : 'Video generation completed.',
  })
})
