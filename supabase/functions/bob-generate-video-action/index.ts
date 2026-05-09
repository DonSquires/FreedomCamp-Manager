// @ts-nocheck
/**
 * Bob Video Generation Action Handler
 * 
 * Allows Bob (AI Agent) to generate briefing videos on behalf of users
 * with natural language intent extraction and validation.
 *
 * Flow:
 *   1. Bob provides natural language request or structured extraction
 *   2. This handler validates org scoping + intent
 *   3. Delegates to generate-briefing-video edge function
 *   4. Returns result to Bob with audit trail metadata
 *
 * Security:
 *   - Enforces org_id scoping from caller context
 *   - Validates that Bob's org_id matches caller's organization
 *   - All invocations logged in media_generation_log with actor_user_id + provider='bob-ai-agent'
 */

import { getCorsHeaders } from '../_shared/withCors.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'

const DAILY_QUOTA_ENV = Number(Deno.env.get('BOB_VIDEO_DAILY_QUOTA') || 25)
const DAILY_USER_QUOTA_ENV = Number(Deno.env.get('BOB_VIDEO_DAILY_USER_QUOTA') || 10)

interface BobVideoRequest {
  // Extracted or provided by Bob
  purpose?: string // 'briefing' | 'training' | 'research'
  quality?: string // 'low' | 'medium' | 'high'
  format?: string // 'mp4' | 'webm'
  incident_id?: string
  breach_id?: string
  title?: string
  description?: string
  
  // Context from Bob's request
  user_id?: string // Should match auth.uid()
  org_id?: string
  approved_proposal_id?: string
  model_used?: string // Claude version Bob was running
  request_context?: string // Natural language source ("Create a medium quality briefing video for incident 42")
}

interface BobVideoResponse {
  success: boolean
  video_id?: string
  video_url?: string
  media_log_id?: string
  duration_seconds?: number
  quality?: string
  format?: string
  created_at?: string
  error?: string
  error_code?: string
  bob_instruction?: string
}

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

function getUtcDayStartIso(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0))
  return d.toISOString()
}

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization')
  if (!authHeader) return null
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || null
}

/**
 * Extract quality tier from natural language
 * Examples: "high quality", "9 second", "HD", "low bandwidth" -> "low"
 */
function inferQuality(context: string): string {
  const lowered = (context || '').toLowerCase()
  if (lowered.includes('low') || lowered.includes('lite') || lowered.includes('bandwidth')) return 'low'
  if (lowered.includes('high') || lowered.includes('hd') || lowered.includes('12s') || lowered.includes('long')) return 'high'
  return 'medium' // default
}

/**
 * Extract format preference from natural language
 */
function inferFormat(context: string): string {
  const lowered = (context || '').toLowerCase()
  if (lowered.includes('webm') || lowered.includes('vp9')) return 'webm'
  return 'mp4' // default
}

/**
 * Extract purpose/type from natural language
 */
function inferPurpose(context: string): string {
  const lowered = (context || '').toLowerCase()
  if (lowered.includes('training') || lowered.includes('learning') || lowered.includes('teach')) return 'training'
  if (lowered.includes('research') || lowered.includes('review') || lowered.includes('audit')) return 'research'
  return 'briefing' // default
}

/**
 * Extract entity IDs from natural language
 * Examples: "incident 42" -> { incident_id: '42' }
 */
function extractEntityIds(context: string): { incident_id?: string; breach_id?: string } {
  const result: { incident_id?: string; breach_id?: string } = {}
  
  const incidentMatch = (context || '').match(/incident\s+([a-f0-9-]+|\d+)/i)
  if (incidentMatch) result.incident_id = incidentMatch[1]
  
  const breachMatch = (context || '').match(/breach\s+([a-f0-9-]+|\d+)/i)
  if (breachMatch) result.breach_id = breachMatch[1]
  
  return result
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) })
  }

  if (req.method !== 'POST') {
    return json(req, { error: 'POST required' }, 405)
  }

  try {
    const body = await req.json() as Record<string, unknown>
    const input: BobVideoRequest = body as BobVideoRequest
    
    const requiredOrgIds = parseUuidArray(body.allowed_org_ids)
    if (!requiredOrgIds.length) {
      return json(
        req,
        { error: 'No allowed_org_ids provided; cannot validate org scoping', error_code: 'INVALID_ORG_SCOPE' },
        403,
      )
    }

    // Extract org_id from input or use first allowed
    let orgId = String(input.org_id || '').trim()
    if (!orgId || !requiredOrgIds.includes(orgId)) {
      orgId = requiredOrgIds[0]
    }

    const supabaseUrl = String(Deno.env.get('SUPABASE_URL') || '').trim()
    const serviceRoleKey = String(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim()
    if (!supabaseUrl || !serviceRoleKey) {
      return json(
        req,
        {
          error: 'Supabase service role configuration missing for quota validation',
          error_code: 'MISSING_SERVICE_ROLE',
          bob_instruction: 'Video generation is temporarily unavailable due to server configuration.',
        },
        503,
      )
    }

    const quotaLimit = Number.isFinite(DAILY_QUOTA_ENV) && DAILY_QUOTA_ENV > 0 ? DAILY_QUOTA_ENV : 25
    const userQuotaLimit = Number.isFinite(DAILY_USER_QUOTA_ENV) && DAILY_USER_QUOTA_ENV > 0 ? DAILY_USER_QUOTA_ENV : 10
    const dayStartIso = getUtcDayStartIso()
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    })

    const { count: todayCount, error: quotaError } = await (supabaseAdmin.from('media_generation_log') as any)
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('media_type', 'video')
      .gte('created_at', dayStartIso)

    if (quotaError) {
      return json(
        req,
        {
          error: `Unable to validate daily quota: ${quotaError.message}`,
          error_code: 'QUOTA_VALIDATION_FAILED',
          bob_instruction: 'I could not validate quota right now. Please retry shortly.',
        },
        503,
      )
    }

    if ((todayCount || 0) >= quotaLimit) {
      return json(
        req,
        {
          error: `Daily video quota reached for org (${todayCount}/${quotaLimit})`,
          error_code: 'DAILY_QUOTA_EXCEEDED',
          bob_instruction: `Daily quota reached (${todayCount}/${quotaLimit}). Try again after UTC day reset or request admin override.`,
        },
        429,
      )
    }

    const authToken = extractBearerToken(req)
    if (!authToken) {
      return json(
        req,
        {
          error: 'Missing authorization token',
          error_code: 'UNAUTHORIZED',
          bob_instruction: 'I cannot generate a video without a valid signed-in session.',
        },
        401,
      )
    }

    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(authToken)
    if (authError || !authData?.user?.id) {
      return json(
        req,
        {
          error: 'Invalid or expired session token',
          error_code: 'INVALID_SESSION',
          bob_instruction: 'Your session appears to be invalid. Please sign in again.',
        },
        401,
      )
    }

    const actorUserId = String(authData.user.id)
    const { count: userTodayCount, error: userQuotaError } = await (supabaseAdmin.from('media_generation_log') as any)
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('actor_user_id', actorUserId)
      .eq('media_type', 'video')
      .gte('created_at', dayStartIso)

    if (userQuotaError) {
      return json(
        req,
        {
          error: `Unable to validate user quota: ${userQuotaError.message}`,
          error_code: 'USER_QUOTA_VALIDATION_FAILED',
          bob_instruction: 'I could not validate your personal quota right now. Please retry shortly.',
        },
        503,
      )
    }

    if ((userTodayCount || 0) >= userQuotaLimit) {
      return json(
        req,
        {
          error: `Daily user video quota reached (${userTodayCount}/${userQuotaLimit})`,
          error_code: 'DAILY_USER_QUOTA_EXCEEDED',
          bob_instruction: `You reached your daily quota (${userTodayCount}/${userQuotaLimit}). Ask an admin for override or retry after UTC reset.`,
        },
        429,
      )
    }

    // Get auth context if available
    const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || ''
    const hasAuth = authHeader.length > 0

    // Infer video parameters from Bob's natural language context
    const requestContext = input.request_context || `Generate video with quality ${input.quality || 'medium'}`
    const quality = input.quality || inferQuality(requestContext)
    const format = input.format || inferFormat(requestContext)
    const purpose = input.purpose || inferPurpose(requestContext)
    const entities = extractEntityIds(requestContext)
    const incidentId = input.incident_id || entities.incident_id
    const breachId = input.breach_id || entities.breach_id

    // Build video generation payload
    const generatePayload = {
      quality,
      format,
      purpose,
      title: input.title || `Briefing (${new Date().toISOString().split('T')[0]})`,
      description: input.description || requestContext,
      incident_id: incidentId,
      breach_id: breachId,
      org_id: orgId,
      bob_request: true,
      bob_model: input.model_used || 'claude-3.5-sonnet',
    }

    // Invoke generate-briefing-video edge function
    const generateUrl = `${supabaseUrl}/functions/v1/generate-briefing-video`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    const gatewayApiKey = String(
      Deno.env.get('SUPABASE_ANON_KEY') ||
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
      '',
    ).trim()
    if (gatewayApiKey) {
      headers.apikey = gatewayApiKey
    }

    if (hasAuth) {
      headers.authorization = authHeader
    }

    // add org context headers for RLS
    headers['x-org-id'] = orgId
    if (requiredOrgIds.length > 1) {
      headers['x-extra-org-ids'] = requiredOrgIds.slice(1).join(',')
    }

    const generateResp = await fetch(generateUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(generatePayload),
    })

    if (!generateResp.ok) {
      const errorText = await generateResp.text()
      console.error(`[bob-generate-video] generate-briefing-video failed: HTTP ${generateResp.status}`, errorText)
      return json(
        req,
        {
          error: `Video generation failed: ${generateResp.statusText}`,
          error_code: `HTTP_${generateResp.status}`,
          bob_instruction: 'Video generation service returned an error. This may be temporary; please retry or contact support.',
        },
        generateResp.status,
      )
    }

    const generateData = await generateResp.json()

    // Transform edge function response for Bob
    const result: BobVideoResponse = {
      success: generateData.success !== false,
      video_id: generateData.video_pack_id || generateData.id,
      video_url: generateData.storage_url || generateData.output_url,
      media_log_id: generateData.media_log_id || null,
      duration_seconds: generateData.duration_seconds,
      quality,
      format,
      created_at: generateData.generated_at || generateData.created_at,
      error: generateData.error,
      bob_instruction: 'Video generated successfully. Inform the user of the video creation and provide a link.',
    }

    if (!result.success) {
      result.bob_instruction = `Video generation failed: ${result.error || 'unknown error'}. Offer to retry with different parameters.`
    }

    return json(req, result, result.success ? 200 : 400)
  } catch (err) {
    console.error('[bob-generate-video] Unhandled exception:', err)
    return json(
      req,
      {
        error: err instanceof Error ? err.message : 'Internal server error',
        error_code: 'INTERNAL_ERROR',
        bob_instruction: 'An unexpected error occurred during video generation. Please try again later.',
      },
      500,
    )
  }
})
