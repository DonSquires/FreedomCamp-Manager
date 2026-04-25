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
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { fetchWithRetry } from '../_shared/fetchWithRetry.ts'

const PTT_SERVER_URL =
  Deno.env.get('PTT_SERVER_URL') ||
  Deno.env.get('PTT_SERVICE_URL') ||
  ''
const PTT_WS_URL =
  Deno.env.get('PTT_WS_URL') ||
  Deno.env.get('PTT_SIGNALING_WS_URL') ||
  ''
const PROXY_SECRET = Deno.env.get('PTT_PROXY_SECRET') || ''
const PTT_ALLOW_INSECURE_HTTP = ['1', 'true', 'yes', 'on'].includes(
  (Deno.env.get('PTT_ALLOW_INSECURE_HTTP') || '').toLowerCase(),
)

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
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

function normalizeWsUrl(value: string): string {
  const normalized = normalizeBaseUrl(value)
  if (normalized.startsWith('ws://') || normalized.startsWith('wss://')) return normalized
  return ''
}

function isProductionRuntime(): boolean {
  const nodeEnv = (Deno.env.get('NODE_ENV') || '').toLowerCase()
  return nodeEnv === 'production' || !!Deno.env.get('DENO_DEPLOYMENT_ID')
}

const PTT_AUTHORIZATION_ERROR = 'Not authorized for this channel. PTT access is limited to your employer organization and explicitly authorized organizations.'

function buildAllowedOrgIds(profile: {
  organization_id?: string | null
  employer_organization_id?: string | null
  authorized_work_locations?: string[] | null
  extra_organization_ids?: string[] | null
}): Set<string> {
  const allowed = new Set<string>()

  const add = (value?: string | null) => {
    if (typeof value === 'string' && value.length > 0) allowed.add(value)
  }

  add(profile.organization_id)
  add(profile.employer_organization_id)
  for (const orgId of profile.authorized_work_locations ?? []) add(orgId)
  for (const orgId of profile.extra_organization_ids ?? []) add(orgId)

  return allowed
}

function canAccessChannelOrg(profile: {
  organization_id?: string | null
  employer_organization_id?: string | null
  authorized_work_locations?: string[] | null
  extra_organization_ids?: string[] | null
}, channelOrgId: string): boolean {
  return buildAllowedOrgIds(profile).has(channelOrgId)
}

function hasExplicitChannelScopeAccess(profile: {
  ptt_channel_access?: string[] | null
}, channelScope: string): boolean {
  return Array.isArray(profile.ptt_channel_access) && profile.ptt_channel_access.includes(channelScope)
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
          message: 'Set PTT_PROXY_SECRET on the Supabase project secrets.',
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
      .select('id, first_name, last_name, role, organization_id, employer_organization_id, authorized_work_locations, extra_organization_ids, ptt_channel_access')
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
    const requiresExplicitScope = !isPrivilegedRole && scopeType !== 'org'

    if (requiresExplicitScope && !hasExplicitChannelScopeAccess(profile, channelScope)) {
      return new Response(
        JSON.stringify({
          error: 'PTT channel not assigned',
          message: 'You are not assigned to this PTT channel scope.',
        }),
        { status: 403, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

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
      const canAccess = canAccessChannelOrg(profile, scopeId)
      if (!canAccess) {
        return new Response(
          JSON.stringify({ 
            error: PTT_AUTHORIZATION_ERROR,
          }),
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

      const canAccess = canAccessChannelOrg(profile, incident.organization_id)
      if (!canAccess) {
        return new Response(
          JSON.stringify({
            error: PTT_AUTHORIZATION_ERROR,
          }),
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
        const canAccess = canAccessChannelOrg(profile, pttChannel.organization_id)
        if (!canAccess) {
          return new Response(
            JSON.stringify({
              error: PTT_AUTHORIZATION_ERROR,
            }),
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
        .select('organization_id, employer_organization_id')
        .eq('id', scopeId)
        .single()

      if (!targetProfile) {
        return new Response(
          JSON.stringify({ error: 'User not found', message: 'Target user does not exist' }),
          { status: 404, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        )
      }

      const directScopeCandidates = [
        targetProfile.employer_organization_id,
        targetProfile.organization_id,
      ].filter(Boolean) as string[]

      let matchedDirectOrgId: string | null = null
      for (const candidateOrgId of directScopeCandidates) {
        const canAccess = canAccessChannelOrg(profile, candidateOrgId)
        if (canAccess) {
          matchedDirectOrgId = candidateOrgId
          break
        }
      }

      if (!matchedDirectOrgId) {
        return new Response(
          JSON.stringify({
            error: PTT_AUTHORIZATION_ERROR,
          }),
          { status: 403, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        )
      }

      effectiveOrganizationId = matchedDirectOrgId
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
    if (!normalizedPttServerUrl.startsWith('http://') && !normalizedPttServerUrl.startsWith('https://')) {
      return new Response(
        JSON.stringify({
          error: 'PTT server URL invalid',
          message: 'PTT_SERVER_URL must start with http:// or https://',
        }),
        { status: 503, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    if (isProductionRuntime() && !PTT_ALLOW_INSECURE_HTTP && normalizedPttServerUrl.startsWith('http://')) {
      return new Response(
        JSON.stringify({
          error: 'PTT server URL insecure',
          message: 'PTT_SERVER_URL must use https:// in production. Set PTT_ALLOW_INSECURE_HTTP=true only for controlled local testing.',
        }),
        { status: 503, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    let mintResponse: Response
    try {
      mintResponse = await fetchWithRetry(`${normalizedPttServerUrl}/api/token/mint`, {
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
      }, {
        retries: 2,
        timeoutMs: 8_000,
        backoffMs: 500,
      })
    } catch (fetchError: any) {
      console.error('PTT server fetch failed:', fetchError)
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

      let upstreamMessage = 'Failed to mint channel token'
      let retryAfter: number | null = null

      try {
        const parsed = JSON.parse(errorText)
        if (typeof parsed?.message === 'string' && parsed.message.trim()) {
          upstreamMessage = parsed.message.trim()
        }
        if (typeof parsed?.retryAfter === 'number' && Number.isFinite(parsed.retryAfter) && parsed.retryAfter > 0) {
          retryAfter = Math.ceil(parsed.retryAfter)
        }
      } catch {
        if (errorText.trim()) {
          upstreamMessage = errorText.trim().slice(0, 200)
        }
      }

      const status = mintResponse.status === 429 ? 429 : 502
      const headers: Record<string, string> = {
        ...getCorsHeaders(req),
        'Content-Type': 'application/json',
      }
      if (status === 429 && retryAfter && retryAfter > 0) {
        headers['Retry-After'] = String(retryAfter)
      }

      return new Response(
        JSON.stringify({
          error: 'PTT server error',
          message: upstreamMessage,
          upstreamStatus: mintResponse.status,
          ...(status === 429 && retryAfter ? { retryAfter } : {}),
          details: errorText.slice(0, 200),
        }),
        { status, headers }
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

    // Upsert presence record
    const { error: presenceError } = await supabase
      .from('ptt_presence')
      .upsert({
        user_id: user.id,
        organization_id: effectiveOrganizationId,
        channel: channelScope,
        status: 'online',
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })

    if (presenceError) {
      // Presence cache should never block radio token issuance.
      console.warn('PTT presence upsert failed:', presenceError)
    }

    const resolvedWsUrl = normalizeWsUrl(PTT_WS_URL) || toWsUrl(normalizedPttServerUrl)
    if (!resolvedWsUrl.startsWith('ws://') && !resolvedWsUrl.startsWith('wss://')) {
      return new Response(
        JSON.stringify({
          error: 'PTT websocket URL invalid',
          message: 'Resolved websocket URL must start with ws:// or wss://',
        }),
        { status: 503, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    if (isProductionRuntime() && !PTT_ALLOW_INSECURE_HTTP && resolvedWsUrl.startsWith('ws://')) {
      return new Response(
        JSON.stringify({
          error: 'PTT websocket URL insecure',
          message: 'Resolved websocket URL must use wss:// in production. Set PTT_ALLOW_INSECURE_HTTP=true only for controlled local testing.',
        }),
        { status: 503, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({
        ...tokenData,
        wsUrl: resolvedWsUrl,
      }),
      { status: 200, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    console.error('PTT token error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal error', message: error?.message || 'Unexpected edge function failure' }),
      { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    )
  }
})
