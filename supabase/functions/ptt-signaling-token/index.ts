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
const PROXY_SECRET =
  Deno.env.get('PTT_PROXY_SECRET') ||
  Deno.env.get('PROXY_SECRET') ||
  Deno.env.get('PROXY_SERVER_SECRET') ||
  Deno.env.get('NZSCV_PROXY_SECRET') ||
  ''

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '')
}

function toWsUrl(baseHttpUrl: string): string {
  const normalized = normalizeBaseUrl(baseHttpUrl)
  if (normalized.startsWith('https://')) {
    return normalized.replace('https://', 'wss://') + '/ws'
  }
  if (normalized.startsWith('http://')) {
    return normalized.replace('http://', 'ws://') + '/ws'
  }
  return normalized + '/ws'
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) })
  }

  try {
    // Validate PTT server is configured
    if (!PTT_SERVER_URL) {
      return new Response(
        JSON.stringify({
          error: 'PTT server not configured',
          message: 'PTT_SERVER_URL environment variable is not set',
        }),
        { status: 503, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    if (!PROXY_SECRET) {
      return new Response(
        JSON.stringify({
          error: 'PTT proxy secret not configured',
          message: 'Set one of: PTT_PROXY_SECRET, PROXY_SECRET, PROXY_SERVER_SECRET, or NZSCV_PROXY_SECRET',
        }),
        { status: 503, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    // Get auth token from request
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized', message: 'Missing or invalid Authorization header' }),
        { status: 401, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    const accessToken = authHeader.replace('Bearer ', '')

    // Initialize Supabase client with user's token
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    if (!supabaseUrl || !supabaseAnonKey) {
      return new Response(
        JSON.stringify({
          error: 'Supabase config missing',
          message: 'SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_SERVICE_ROLE_KEY) are required',
        }),
        { status: 503, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    })

    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser(accessToken)
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized', message: 'Invalid user token' }),
        { status: 401, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    // Get user profile for role and org
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('id, first_name, last_name, role, organization_id')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      return new Response(
        JSON.stringify({ error: 'Profile not found', message: 'User profile does not exist' }),
        { status: 404, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    // Parse request body
    let channelScope: string
    try {
      const body = await req.json()
      channelScope = body.channelScope
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid request', message: 'Request body must be JSON with channelScope' }),
        { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    // Validate channel scope format - now supports org, incident, direct, team, deployment
    const validScopePattern = /^(org|incident|direct|team|deployment):[a-f0-9-]+$/
    if (!channelScope || !validScopePattern.test(channelScope)) {
      return new Response(
        JSON.stringify({
          error: 'Invalid channelScope',
          message: 'channelScope must be org:<uuid>, incident:<uuid>, direct:<uuid>, team:<uuid>, or deployment:<uuid>',
        }),
        { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    const [scopeType, scopeId] = channelScope.split(':')
    const isPrivilegedRole = ['master', 'grand_master'].includes(profile.role)

    // Resolve effective organization context. For master/grand_master users who
    // may have organization_id = null, derive org context from channel scope.
    let effectiveOrganizationId: string | null = profile.organization_id ?? null

    if (!effectiveOrganizationId && !isPrivilegedRole) {
      return new Response(
        JSON.stringify({ error: 'No organization', message: 'User is not assigned to an organization' }),
        { status: 403, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }
    
    if (scopeType === 'org') {
      // Only allow access to user's own org unless privileged role.
      if (!isPrivilegedRole && scopeId !== profile.organization_id) {
        return new Response(
          JSON.stringify({ error: 'Forbidden', message: 'Cannot access channels in other organizations' }),
          { status: 403, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        )
      }

      effectiveOrganizationId = scopeId
    } else if (scopeType === 'incident') {
      // Verify incident belongs to user's org
      const { data: incident } = await supabase
        .from('incidents')
        .select('organization_id')
        .eq('id', scopeId)
        .single()

      if (!incident) {
        return new Response(
          JSON.stringify({ error: 'Incident not found', message: 'The specified incident does not exist' }),
          { status: 404, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        )
      }

      if (incident.organization_id !== profile.organization_id && !isPrivilegedRole) {
        return new Response(
          JSON.stringify({ error: 'Forbidden', message: 'Cannot access incident channels in other organizations' }),
          { status: 403, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        )
      }

      effectiveOrganizationId = incident.organization_id
    } else if (scopeType === 'team' || scopeType === 'deployment') {
      // Team/deployment scopes are used for independent PTT channel UUIDs.
      // Resolve organization from ptt_channels first when possible.
      const { data: pttChannel } = await supabase
        .from('ptt_channels')
        .select('organization_id')
        .eq('id', scopeId)
        .single()

      if (pttChannel?.organization_id) {
        if (!isPrivilegedRole && pttChannel.organization_id !== profile.organization_id) {
          return new Response(
            JSON.stringify({ error: 'Forbidden', message: 'Cannot access team/deployment channels in other organizations' }),
            { status: 403, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
          )
        }
        effectiveOrganizationId = pttChannel.organization_id
      } else if (!effectiveOrganizationId) {
        return new Response(
          JSON.stringify({
            error: 'Organization context required',
            message: 'Unable to resolve organization context for team/deployment channel scope',
          }),
          { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        )
      }
    } else if (scopeType === 'direct') {
      // Direct channel: scopeId is target user ID
      // Verify target user exists and is in same org
      const { data: targetProfile } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', scopeId)
        .single()

      if (!targetProfile) {
        return new Response(
          JSON.stringify({ error: 'User not found', message: 'Target user does not exist' }),
          { status: 404, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        )
      }

      if (targetProfile.organization_id !== profile.organization_id && !isPrivilegedRole) {
        return new Response(
          JSON.stringify({ error: 'Forbidden', message: 'Cannot create direct channels with users in other organizations' }),
          { status: 403, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        )
      }

      effectiveOrganizationId = targetProfile.organization_id
    }

    if (!effectiveOrganizationId) {
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

    const mintResponse = await fetch(`${normalizedPttServerUrl}/api/token/mint`, {
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

    const tokenData = await mintResponse.json()

    // Upsert presence record
    await supabase
      .from('ptt_presence')
      .upsert({
        user_id: user.id,
        organization_id: effectiveOrganizationId,
        channel: channelScope,
        status: 'online',
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })

    return new Response(
      JSON.stringify({
        ...tokenData,
        wsUrl: toWsUrl(normalizedPttServerUrl),
      }),
      { status: 200, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    console.error('PTT token error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal error', message: error.message }),
      { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    )
  }
})
