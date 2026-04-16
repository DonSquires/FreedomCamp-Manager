/**
 * PTT Signaling Token Edge Function
 * 
 * Mints short-lived JWT tokens for PTT channel access.
 * Validates user auth and org membership before calling the PTT signaling server.
 * 
 * Request body:
 *   { channelScope: 'org:<uuid>' | 'incident:<uuid>' | 'direct:<uuid>' }
 * 
 * Response:
 *   { token, channelScope, expiresIn, iceServers }
 *
 * CORS note:
 *   Origin matching and headers are provided via getCorsHeaders from _shared/withCors.ts.
 */

import { withCors, jsonResponse, errorResponse, getCorsHeaders } from '../_shared/withCors.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const PTT_SERVER_URL =
  Deno.env.get('PTT_SERVER_URL') ||
  Deno.env.get('PTT_SERVICE_URL') ||
  Deno.env.get('PPT_SERVER_URL') ||
  Deno.env.get('PPT_SURVER_URL') ||
  ''
const PROXY_SECRET = Deno.env.get('PTT_PROXY_SECRET') || ''

interface PTTTokenRequest {
  channelScope: string
}

interface PTTTokenResponse {
  token: string
  channelScope: string
  expiresIn: number
  wsUrl: string
  iceServers: any[]
}

/**
 * Normalize base URL: ensure it has a protocol and no trailing slash
 */
function normalizeBaseUrl(url: string): string {
  if (!url) return ''
  const trimmed = url.trim()
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return `https://${trimmed}`.replace(/\/$/, '')
  }
  return trimmed.replace(/\/$/, '')
}

async function handleRequest(req: Request) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) })
  }

  // Only allow POST
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    )
  }

  // Validate environment
  if (!PTT_SERVER_URL) {
    console.error('PTT_SERVER_URL not configured')
    return new Response(
      JSON.stringify({
        error: 'Service misconfigured',
        message: 'PTT service not configured. Contact administrator.',
      }),
      { status: 503, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    )
  }

  if (!PROXY_SECRET) {
    console.error('PROXY_SECRET not configured')
    return new Response(
      JSON.stringify({
        error: 'Service misconfigured',
        message: 'PTT authentication not configured. Contact administrator.',
      }),
      { status: 503, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    )
  }

  try {
    // Parse request body
    let body: PTTTokenRequest
    try {
      body = await req.json()
    } catch {
      return new Response(
        JSON.stringify({
          error: 'Invalid request',
          message: 'Request body must be valid JSON',
        }),
        { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    const { channelScope } = body
    if (!channelScope || typeof channelScope !== 'string') {
      return new Response(
        JSON.stringify({
          error: 'Invalid request',
          message: 'channelScope is required and must be a string',
        }),
        { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    // Get auth token from request
    const authHeader = req.headers.get('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({
          error: 'Unauthorized',
          message: 'Authorization header required',
        }),
        { status: 401, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    const token = authHeader.slice(7)
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Supabase configuration missing')
      return new Response(
        JSON.stringify({
          error: 'Service misconfigured',
          message: 'Backend not configured properly',
        }),
        { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    // Create Supabase clients
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const userSupabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') || '', {
      global: {
        headers: {
          authorization: `Bearer ${token}`,
        },
      },
    })

    // Verify user session
    const { data: userData, error: userError } = await userSupabase.auth.getUser()
    if (userError || !userData?.user) {
      console.warn('User auth failed:', userError?.message)
      return new Response(
        JSON.stringify({
          error: 'Unauthorized',
          message: 'Invalid or expired session',
        }),
        { status: 401, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    const user = userData.user
    console.log(`🎤 PTT token request for user ${user.id} channel ${channelScope}`)

    // Get user profile (with organization info)
    const { data: profileData, error: profileError } = await supabase
      .from('user_profiles')
      .select('id, first_name, last_name, role, organization_id')
      .eq('id', user.id)
      .single()

    if (profileError || !profileData) {
      console.warn('Profile lookup failed:', profileError?.message)
      return new Response(
        JSON.stringify({
          error: 'User not found',
          message: 'User profile not configured',
        }),
        { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    const profile = profileData

    // Resolve organization context
    let effectiveOrganizationId = profile.organization_id

    // For master/grand_master users, extract org from channel scope if needed
    if (!effectiveOrganizationId && (profile.role === 'master' || profile.role === 'grand_master')) {
      const scopeParts = channelScope.split(':')
      if (scopeParts[0] === 'org' && scopeParts[1]) {
        effectiveOrganizationId = scopeParts[1]
      }
    }

    if (!effectiveOrganizationId) {
      console.warn(`No organization context for user ${user.id}`)
      return new Response(
        JSON.stringify({
          error: 'Organization context required',
          message: 'Unable to resolve organization context for this channel scope',
        }),
        { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    // Call PTT server to mint token
    const normalizedPttServerUrl = normalizeBaseUrl(PTT_SERVER_URL)
    if (!normalizedPttServerUrl.startsWith('http://') && !normalizedPttServerUrl.startsWith('https://')) {
      return new Response(
        JSON.stringify({
          error: 'PTT server URL invalid',
          message: 'PTT_SERVER_URL must start with http:// or https://',
        }),
        { status: 503, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    let mintResponse: Response
    try {
      mintResponse = await fetch(`${normalizedPttServerUrl}/api/token/mint`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-proxy-secret': PROXY_SECRET,
        },
        body: JSON.stringify({
          userId: user.id,
          userRole: profile.role,
          organizationId: effectiveOrganizationId,
          channelScope,
          firstName: profile.first_name,
          lastName: profile.last_name,
        }),
      })
    } catch (fetchError: any) {
      console.error('PTT server fetch failed:', fetchError.message || fetchError)
      return new Response(
        JSON.stringify({
          error: 'PTT server unreachable',
          message: fetchError?.message || 'Failed to reach PTT server mint endpoint',
        }),
        { status: 502, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    if (!mintResponse.ok) {
      const errorText = await mintResponse.text()
      console.error('PTT server error:', mintResponse.status, errorText)
      return new Response(
        JSON.stringify({
          error: 'PTT server error',
          message: 'Failed to mint channel token',
          details: errorText.slice(0, 200),
        }),
        { status: 502, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    let tokenData: any
    try {
      tokenData = await mintResponse.json()
    } catch (parseError: any) {
      const fallbackBody = await mintResponse.text().catch(() => '')
      console.error('PTT server JSON parse failed:', parseError, fallbackBody)
      return new Response(
        JSON.stringify({
          error: 'PTT server response invalid',
          message: 'PTT server did not return valid JSON for token mint',
          details: fallbackBody.slice(0, 200),
        }),
        { status: 502, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    // Upsert presence record (non-blocking)
    const presenceInsert = supabase
      .from('ppt_presence')
      .upsert({
        user_id: user.id,
        organization_id: effectiveOrganizationId,
        first_name: profile.first_name,
        last_name: profile.last_name,
        role: profile.role,
        last_seen: new Date().toISOString(),
        is_online: true,
      })
      .single()

    presenceInsert.catch((error: any) => {
      console.warn(`Failed to upsert presence for user ${user.id}:`, error.message)
    })

    console.log(`✅ PTT token minted for ${user.id} scope ${channelScope}`)

    return new Response(
      JSON.stringify({
        token: tokenData.token,
        channelScope,
        expiresIn: tokenData.expiresIn || 600,
        wsUrl: normalizedPttServerUrl.replace(/^https?:/, 'wss:').replace(/^http:/, 'ws:') + '/ws',
        iceServers: tokenData.iceServers || [],
      }),
      { status: 200, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    console.error('Unexpected error in ppt-signaling-token:', err.message || err)
    return new Response(
      JSON.stringify({
        error: 'Internal error',
        message: 'An unexpected error occurred while minting token',
        details: err.message || 'Unknown error',
      }),
      { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    )
  }
}

export default withCors(handleRequest)
