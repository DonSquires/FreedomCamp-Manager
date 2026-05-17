import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const RADIO_FLOOR_PROVIDER_URL = Deno.env.get('RADIO_FLOOR_PROVIDER_URL') ?? ''
const RADIO_PROXY_SECRET = Deno.env.get('RADIO_PROXY_SECRET') ?? Deno.env.get('PTT_PROXY_SECRET') ?? ''

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function logFloorEvent(
  supabase: ReturnType<typeof createClient>,
  event: {
    orgId: string
    channelId: string
    sessionId: string
    status: 'requested' | 'granted' | 'rejected' | 'released'
    speakerId: string
    operatorId: string
    reason?: string
    details?: Record<string, unknown>
  },
) {
  const { error } = await supabase.from('radio_floor_events').insert({
    org_id: event.orgId,
    channel_id: event.channelId,
    session_id: event.sessionId,
    event_type: 'acquire',
    status: event.status,
    speaker_id: event.speakerId,
    operator_id: event.operatorId,
    reason: event.reason ?? null,
    details: event.details ?? {},
  })

  if (error) {
    console.error('radio-floor-acquire: failed to write floor event', error)
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return json(405, { error: 'Method not allowed' })
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return json(401, { error: 'Missing authorization' })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  if (!supabaseUrl || !supabaseAnonKey) {
    return json(503, { error: 'Supabase configuration missing' })
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData?.user) {
    return json(401, { error: 'Unauthorized' })
  }

  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('organization_id')
    .eq('id', authData.user.id)
    .maybeSingle()

  if (profileError || !profile?.organization_id) {
    return json(403, { error: 'Profile missing organization context' })
  }

  let body: { channelId?: string; sessionId?: string; reason?: string; bobProposalId?: string }
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }

  const channelId = String(body.channelId ?? '').trim()
  const sessionId = String(body.sessionId ?? '').trim()
  const reason = String(body.reason ?? 'floor_request').trim()
  const bobProposalId = String(body.bobProposalId ?? '').trim() || null
  if (!channelId || !sessionId) {
    return json(400, { error: 'channelId and sessionId are required' })
  }

  // Phase 0-1 scaffold: relay to external floor coordinator when configured.
  if (!RADIO_FLOOR_PROVIDER_URL || !RADIO_PROXY_SECRET) {
    await logFloorEvent(supabase, {
      orgId: profile.organization_id,
      channelId,
      sessionId,
      status: 'rejected',
      speakerId: authData.user.id,
      operatorId: authData.user.id,
      reason,
      details: {
        source: 'radio-floor-acquire',
        phase: 'phase-0-1-scaffold',
        failure: 'provider_not_configured',
        bobProposalId,
      },
    })

    return json(501, {
      error: 'radio-floor-acquire not configured',
      message: 'Set RADIO_FLOOR_PROVIDER_URL and RADIO_PROXY_SECRET to enable floor acquisition.',
      phase: 'phase-0-1-scaffold',
      channelId,
      sessionId,
    })
  }

  try {
    const upstream = await fetch(`${RADIO_FLOOR_PROVIDER_URL.replace(/\/+$/, '')}/acquire`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-proxy-secret': RADIO_PROXY_SECRET,
        'x-org-id': req.headers.get('x-org-id') ?? '',
      },
      body: JSON.stringify({
        channelId,
        sessionId,
        userId: authData.user.id,
      }),
    })

    const payload = await upstream.json().catch(() => ({ error: 'Invalid upstream response' }))
    if (!upstream.ok) {
      await logFloorEvent(supabase, {
        orgId: profile.organization_id,
        channelId,
        sessionId,
        status: 'rejected',
        speakerId: authData.user.id,
        operatorId: authData.user.id,
        reason,
        details: {
          source: 'radio-floor-acquire',
          phase: 'phase-0-1-scaffold',
          bobProposalId,
          upstream: payload,
        },
      })

      return json(409, {
        error: 'Floor acquire rejected',
        details: payload,
      })
    }

    await logFloorEvent(supabase, {
      orgId: profile.organization_id,
      channelId,
      sessionId,
      status: 'granted',
      speakerId: authData.user.id,
      operatorId: authData.user.id,
      reason,
      details: {
        source: 'radio-floor-acquire',
        phase: 'phase-0-1-scaffold',
        bobProposalId,
      },
    })

    return json(200, {
      ...payload,
      phase: 'phase-0-1-scaffold',
      channelId,
      sessionId,
    })
  } catch (error) {
    return json(503, {
      error: 'Floor coordinator unavailable',
      details: String(error),
    })
  }
})
