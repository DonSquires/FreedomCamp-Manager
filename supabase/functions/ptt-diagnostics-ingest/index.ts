import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { withCors, errorResponse, jsonResponse } from '../_shared/withCors.ts'
import { requireAuth } from '../_shared/requireAuth.ts'

type IncomingPayload = {
  channel_id?: string
  rtt_ms?: number | null
  packet_loss?: number | null
  jitter_ms?: number | null
  ice_type?: string | null
  packets_sent?: number | null
  packets_recv?: number | null
}

function parseChannelScope(channelId: string): { type: string; value: string } | null {
  const trimmed = String(channelId || '').trim()
  const parts = trimmed.split(':')
  if (parts.length !== 2) return null

  const [type, value] = parts
  if (!type || !value) return null

  const validType = ['org', 'incident', 'direct', 'team', 'deployment'].includes(type)
  const validValue = /^[a-f0-9-]{36}$/i.test(value)
  if (!validType || !validValue) return null

  return { type, value }
}

function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function normalizeIceType(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (!normalized) return null
  if (normalized === 'host' || normalized === 'srflx' || normalized === 'relay' || normalized === 'prflx') {
    return normalized
  }
  return null
}

Deno.serve(withCors(async (req: Request) => {
  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', req, 405)
  }

  const authResult = await requireAuth(req)
  if (!authResult.user) {
    return errorResponse(authResult.error ?? 'Unauthorized', req, 401)
  }

  let body: IncomingPayload
  try {
    body = await req.json()
  } catch {
    return errorResponse('Invalid JSON body', req, 400)
  }

  const channelId = typeof body.channel_id === 'string' ? body.channel_id.trim() : ''
  if (!channelId) {
    return errorResponse('channel_id is required', req, 400)
  }

  const channelScope = parseChannelScope(channelId)
  if (!channelScope) {
    return errorResponse('channel_id must be a valid scope (org|incident|direct|team|deployment):<uuid>', req, 400)
  }

  const serviceClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const { data: profile, error: profileError } = await serviceClient
    .from('user_profiles')
    .select('organization_id')
    .eq('id', authResult.user.id)
    .maybeSingle()

  if (profileError) {
    return errorResponse('Failed to resolve profile for diagnostics ingest', req, 500, profileError.message)
  }

  if (!profile?.organization_id) {
    return errorResponse('User organization not found', req, 403)
  }

  // Enforce direct org ownership for org-scoped channels.
  if (channelScope.type === 'org' && channelScope.value !== profile.organization_id) {
    return errorResponse('Channel scope is not authorized for this user organization', req, 403)
  }

  const payload = {
    org_id: profile.organization_id,
    user_id: authResult.user.id,
    channel_id: channelId,
    rtt_ms: asNullableNumber(body.rtt_ms),
    packet_loss: asNullableNumber(body.packet_loss),
    jitter_ms: asNullableNumber(body.jitter_ms),
    ice_type: normalizeIceType(body.ice_type),
    packets_sent: asNullableNumber(body.packets_sent),
    packets_recv: asNullableNumber(body.packets_recv),
  }

  const { error: insertError } = await (serviceClient as any)
    .from('ptt_diagnostic_events')
    .insert(payload)

  if (insertError) {
    return errorResponse('Failed to insert diagnostics event', req, 500, insertError.message)
  }

  return jsonResponse({ ok: true }, req, 200)
}))
