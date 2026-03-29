/**
 * PTT Signaling Token Edge Function
 * 
 * Mints short-lived JWT tokens for PTT channel access.
 * Validates user auth and org membership before calling the PTT signaling server.
 * 
 * Request body:
 *   { channelScope: 'org:<uuid>' | 'incident:<uuid>' | 'direct:<uuid>' | 'direct:<uuid>:<uuid>' }
 * 
 * Response:
 *   { token, channelScope, expiresIn, iceServers }
 */

import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const PTT_SERVER_URL = Deno.env.get('PTT_SERVER_URL') || ''
const PROXY_SECRET = Deno.env.get('PROXY_SECRET') || ''

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Validate PTT server is configured
    if (!PTT_SERVER_URL) {
      return new Response(
        JSON.stringify({
          error: 'PTT server not configured',
          message: 'PTT_SERVER_URL environment variable is not set',
        }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!PROXY_SECRET) {
      return new Response(
        JSON.stringify({
          error: 'PTT proxy secret not configured',
          message: 'PROXY_SECRET environment variable is not set',
        }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get auth token from request
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized', message: 'Missing or invalid Authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const accessToken = authHeader.replace('Bearer ', '')

    // Initialize Supabase client with user's token
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    })

    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser(accessToken)
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized', message: 'Invalid user token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!profile.organization_id) {
      return new Response(
        JSON.stringify({ error: 'No organization', message: 'User is not assigned to an organization' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate channel scope format.
    // Direct channels support:
    //  - Legacy: direct:<uuid>
    //  - Deterministic pair: direct:<uuid>:<uuid>
    const scopedPattern = /^(org|incident|team|deployment):[a-f0-9-]+$/
    const directLegacyPattern = /^direct:[a-f0-9-]{36}$/
    const directPairPattern = /^direct:[a-f0-9-]{36}:[a-f0-9-]{36}$/

    if (!channelScope || (!scopedPattern.test(channelScope) && !directLegacyPattern.test(channelScope) && !directPairPattern.test(channelScope))) {
      return new Response(
        JSON.stringify({
          error: 'Invalid channelScope',
          message: 'channelScope must be org:<uuid>, incident:<uuid>, direct:<uuid> (legacy), direct:<uuid>:<uuid>, team:<uuid>, or deployment:<uuid>',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate org-scoped access
    const [scopeType, ...scopeParts] = channelScope.split(':')
    const scopeId = scopeParts[0]
    
    if (scopeType === 'org') {
      // Only allow access to user's own org (or master can access any)
      if (scopeId !== profile.organization_id && !['master', 'grand_master'].includes(profile.role)) {
        return new Response(
          JSON.stringify({ error: 'Forbidden', message: 'Cannot access channels in other organizations' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
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
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      if (incident.organization_id !== profile.organization_id && !['master', 'grand_master'].includes(profile.role)) {
        return new Response(
          JSON.stringify({ error: 'Forbidden', message: 'Cannot access incident channels in other organizations' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    } else if (scopeType === 'team' || scopeType === 'deployment') {
      // Team/deployment channels - verify user is part of the deployment or has access
      // For now, allow access within same organization
      // Future: Check roster_assignments or deployment_members table
      // This allows all org members to join team channels for the MVP
      console.log(`PTT: User ${user.id} accessing ${scopeType} channel ${scopeId}`)
    } else if (scopeType === 'direct') {
      if (scopeParts.length === 2) {
        // Deterministic pair direct channel: direct:<uuidA>:<uuidB>
        const [userA, userB] = scopeParts

        if (userA === userB) {
          return new Response(
            JSON.stringify({ error: 'Invalid direct channel', message: 'Direct channel users must be different' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        if (![userA, userB].includes(user.id) && !['master', 'grand_master'].includes(profile.role)) {
          return new Response(
            JSON.stringify({ error: 'Forbidden', message: 'Direct channel must include current user' }),
            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        const { data: users, error: usersError } = await supabase
          .from('user_profiles')
          .select('id, organization_id')
          .in('id', [userA, userB])

        if (usersError || !users || users.length !== 2) {
          return new Response(
            JSON.stringify({ error: 'User not found', message: 'One or more users in direct channel do not exist' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        const crossOrg = users.some((u) => u.organization_id !== profile.organization_id)
        if (crossOrg && !['master', 'grand_master'].includes(profile.role)) {
          return new Response(
            JSON.stringify({ error: 'Forbidden', message: 'Cannot create direct channels with users in other organizations' }),
            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
      } else {
        // Legacy direct channel: direct:<targetUserId>
        const { data: targetProfile } = await supabase
          .from('user_profiles')
          .select('organization_id')
          .eq('id', scopeId)
          .single()

        if (!targetProfile) {
          return new Response(
            JSON.stringify({ error: 'User not found', message: 'Target user does not exist' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        if (targetProfile.organization_id !== profile.organization_id && !['master', 'grand_master'].includes(profile.role)) {
          return new Response(
            JSON.stringify({ error: 'Forbidden', message: 'Cannot create direct channels with users in other organizations' }),
            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
      }
    }

    // Call PTT server to mint token
    const mintResponse = await fetch(`${PTT_SERVER_URL}/api/token/mint`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-proxy-secret': PROXY_SECRET,
      },
      body: JSON.stringify({
        userId: user.id,
        userRole: profile.role,
        organizationId: profile.organization_id,
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
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const tokenData = await mintResponse.json()

    // Upsert presence record
    await supabase
      .from('ptt_presence')
      .upsert({
        user_id: user.id,
        organization_id: profile.organization_id,
        channel: channelScope,
        status: 'online',
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })

    return new Response(
      JSON.stringify({
        ...tokenData,
        wsUrl: PTT_SERVER_URL.replace(/^http/, 'ws') + '/ws',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    console.error('PTT token error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal error', message: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
