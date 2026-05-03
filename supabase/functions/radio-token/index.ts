/**
 * radio-token Edge Function
 *
 * Mints a short-lived scoped session token for PTT radio channel access.
 * Validates user authentication, org membership, and channel scope before
 * returning a signed token for the radio control plane.
 *
 * Request body:
 *   {
 *     channelId: string            // e.g. "org:<uuid>" | "incident:<uuid>" | "direct:<uuid>" | "emergency:<uuid>"
 *     channelType: string          // "org" | "incident" | "direct" | "emergency"
 *   }
 *
 * Response:
 *   {
 *     token: string                // signed JWT for radio control plane
 *     channelScope: string         // normalised scope string
 *     channelType: string
 *     expiresIn: number            // seconds
 *     wsUrl: string                // WebSocket URL for radio control plane
 *     iceServers: RTCIceServer[]   // TURN/STUN config
 *     transmissionId: string       // new radio_transmissions row ID
 *   }
 *
 * Per ADR 003: policy plane (Supabase) issues scoped JWT; control plane validates it.
 * Per ADR 006: emergency channels are always audited; recording flag set per channel policy.
 */

import { withCors, jsonResponse, errorResponse } from '../_shared/withCors.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'

const RADIO_CONTROL_URL =
  Deno.env.get('RADIO_CONTROL_URL') ||
  Deno.env.get('PTT_SERVER_URL') ||
  ''
const RADIO_WS_URL =
  Deno.env.get('RADIO_WS_URL') ||
  Deno.env.get('PTT_WS_URL') ||
  ''
const RADIO_PROXY_SECRET = Deno.env.get('RADIO_PROXY_SECRET') || Deno.env.get('PTT_PROXY_SECRET') || ''
const TOKEN_TTL_SECONDS = 3600

const VALID_CHANNEL_TYPES = new Set(['org', 'incident', 'direct', 'emergency'])

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function toWsUrl(baseHttpUrl: string): string {
  const normalized = normalizeBaseUrl(baseHttpUrl)
  if (normalized.startsWith('https://')) return normalized.replace('https://', 'wss://') + '/ws'
  if (normalized.startsWith('http://')) return normalized.replace('http://', 'ws://') + '/ws'
  return normalized + '/ws'
}

Deno.serve(withCors(async (req: Request) => {
  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405)
  }

  // --- Auth ----------------------------------------------------------------
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return errorResponse('Missing authorization', 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return errorResponse('Unauthorized', 401)
  }

  // --- Profile + org -------------------------------------------------------
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, organization_id, role, full_name')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    return errorResponse('Profile not found', 403)
  }

  // --- Request body --------------------------------------------------------
  let body: { channelId?: string; channelType?: string }
  try {
    body = await req.json()
  } catch {
    return errorResponse('Invalid JSON body', 400)
  }

  const { channelId, channelType } = body
  if (!channelId || typeof channelId !== 'string') {
    return errorResponse('channelId is required', 400)
  }
  if (!channelType || !VALID_CHANNEL_TYPES.has(channelType)) {
    return errorResponse(`channelType must be one of: ${[...VALID_CHANNEL_TYPES].join(', ')}`, 400)
  }

  // Emergency channels: validate role
  if (channelType === 'emergency') {
    const allowedEmergencyRoles = ['admin', 'admin_officer', 'master', 'grand_master', 'officer']
    if (!allowedEmergencyRoles.includes(profile.role)) {
      return errorResponse('Insufficient role for emergency channel', 403)
    }
  }

  const channelScope = `${channelType}:${channelId}`
  const isEmergency = channelType === 'emergency'

  // --- Create transmission audit row ---------------------------------------
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

  const { data: transmission, error: transmissionError } = await supabaseAdmin
    .from('radio_transmissions')
    .insert({
      org_id: profile.organization_id,
      channel_id: channelId,
      channel_type: channelType,
      speaker_id: profile.id,
      speaker_name: profile.full_name || user.email || profile.id,
      recording_enabled: isEmergency, // emergency channels always record per ADR 006
      is_emergency: isEmergency,
    })
    .select('id')
    .single()

  if (transmissionError || !transmission) {
    console.error('radio-token: transmission insert failed', transmissionError)
    return errorResponse('Failed to create transmission record', 500)
  }

  // --- Build scoped JWT payload --------------------------------------------
  const now = Math.floor(Date.now() / 1000)
  const tokenPayload = {
    sub: profile.id,
    org: profile.organization_id,
    role: profile.role,
    channel_scope: channelScope,
    channel_type: channelType,
    transmission_id: transmission.id,
    is_emergency: isEmergency,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  }

  // --- Fetch signed token from radio control plane -------------------------
  if (!RADIO_CONTROL_URL || !RADIO_PROXY_SECRET) {
    // Dev mode: return an unsigned payload string so local testing works
    const devToken = btoa(JSON.stringify(tokenPayload))
    const wsUrl = RADIO_WS_URL || 'ws://localhost:3002/ws'
    return jsonResponse({
      token: devToken,
      channelScope,
      channelType,
      expiresIn: TOKEN_TTL_SECONDS,
      wsUrl,
      iceServers: [],
      transmissionId: transmission.id,
      _dev: true,
    })
  }

  const controlUrl = normalizeBaseUrl(RADIO_CONTROL_URL)
  const tokenEndpoint = `${controlUrl}/radio/token`

  let controlResponse: Response
  try {
    controlResponse = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-proxy-secret': RADIO_PROXY_SECRET,
      },
      body: JSON.stringify(tokenPayload),
    })
  } catch (fetchErr) {
    console.error('radio-token: control plane fetch failed', fetchErr)
    return errorResponse('Radio control plane unavailable', 503)
  }

  if (!controlResponse.ok) {
    const errText = await controlResponse.text().catch(() => '')
    console.error('radio-token: control plane error', controlResponse.status, errText)
    return errorResponse('Radio control plane rejected token request', 502)
  }

  const controlData = await controlResponse.json()

  return jsonResponse({
    token: controlData.token,
    channelScope,
    channelType,
    expiresIn: TOKEN_TTL_SECONDS,
    wsUrl: RADIO_WS_URL || toWsUrl(RADIO_CONTROL_URL),
    iceServers: Array.isArray(controlData.iceServers) ? controlData.iceServers : [],
    transmissionId: transmission.id,
  })
}))
