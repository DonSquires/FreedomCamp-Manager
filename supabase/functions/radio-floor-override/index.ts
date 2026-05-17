import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const RADIO_FLOOR_PROVIDER_URL = Deno.env.get('RADIO_FLOOR_PROVIDER_URL') ?? ''
const RADIO_PROXY_SECRET = Deno.env.get('RADIO_PROXY_SECRET') ?? Deno.env.get('PTT_PROXY_SECRET') ?? ''
const REQUIRE_BOB_APPROVAL = ['1', 'true', 'yes', 'on'].includes(
  String(Deno.env.get('RADIO_REQUIRE_BOB_APPROVAL') ?? '').toLowerCase(),
)

const SUPERVISOR_ROLES = new Set(['admin', 'admin_officer', 'master', 'grand_master'])

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function logOverrideEvent(
  supabase: ReturnType<typeof createClient>,
  event: {
    orgId: string
    channelId: string
    sessionId: string
    status: 'requested' | 'granted' | 'rejected' | 'released'
    speakerId: string | null
    operatorId: string
    reason: string
    bobProposalId: string | null
    details?: Record<string, unknown>
  },
) {
  const { error } = await supabase.from('radio_floor_events').insert({
    org_id: event.orgId,
    channel_id: event.channelId,
    session_id: event.sessionId,
    event_type: 'override',
    status: event.status,
    speaker_id: event.speakerId,
    operator_id: event.operatorId,
    reason: event.reason,
    details: {
      emergency_override: true,
      bob_proposal_id: event.bobProposalId,
      ...(event.details ?? {}),
    },
  })

  if (error) {
    console.error('radio-floor-override: failed to write override event', error)
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
    .select('organization_id, role')
    .eq('id', authData.user.id)
    .maybeSingle()

  if (profileError || !profile?.organization_id || !profile?.role) {
    return json(403, { error: 'Profile missing organization context' })
  }

  if (!SUPERVISOR_ROLES.has(profile.role)) {
    return json(403, { error: 'Emergency override requires supervisor role' })
  }

  let body: {
    channelId?: string
    sessionId?: string
    reason?: string
    targetSpeakerId?: string
    bobProposalId?: string
  }
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }

  const channelId = String(body.channelId ?? '').trim()
  const sessionId = String(body.sessionId ?? '').trim()
  const reason = String(body.reason ?? 'supervisor_override').trim()
  const targetSpeakerId = String(body.targetSpeakerId ?? '').trim() || null
  const bobProposalId = String(body.bobProposalId ?? '').trim() || null

  if (!channelId || !sessionId) {
    return json(400, { error: 'channelId and sessionId are required' })
  }

  if (REQUIRE_BOB_APPROVAL && !bobProposalId) {
    await logOverrideEvent(supabase, {
      orgId: profile.organization_id,
      channelId,
      sessionId,
      status: 'rejected',
      speakerId: targetSpeakerId,
      operatorId: authData.user.id,
      reason,
      bobProposalId,
      details: {
        failure: 'missing_bob_proposal_id',
        gate: 'phase-d-d1',
      },
    })

    return json(412, {
      error: 'Bob approval contract required',
      message: 'Provide bobProposalId when RADIO_REQUIRE_BOB_APPROVAL is enabled.',
      gate: 'phase-d-d1',
    })
  }

  if (!RADIO_FLOOR_PROVIDER_URL || !RADIO_PROXY_SECRET) {
    await logOverrideEvent(supabase, {
      orgId: profile.organization_id,
      channelId,
      sessionId,
      status: 'rejected',
      speakerId: targetSpeakerId,
      operatorId: authData.user.id,
      reason,
      bobProposalId,
      details: {
        source: 'radio-floor-override',
        phase: 'phase-0-1-scaffold',
        failure: 'provider_not_configured',
      },
    })

    return json(501, {
      error: 'radio-floor-override not configured',
      message: 'Set RADIO_FLOOR_PROVIDER_URL and RADIO_PROXY_SECRET to enable override.',
      phase: 'phase-0-1-scaffold',
      channelId,
      sessionId,
    })
  }

  try {
    const upstream = await fetch(`${RADIO_FLOOR_PROVIDER_URL.replace(/\/+$/, '')}/override`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-proxy-secret': RADIO_PROXY_SECRET,
        'x-org-id': req.headers.get('x-org-id') ?? '',
      },
      body: JSON.stringify({
        channelId,
        sessionId,
        reason,
        targetSpeakerId,
        operatorId: authData.user.id,
        bobProposalId,
      }),
    })

    const payload = await upstream.json().catch(() => ({ error: 'Invalid upstream response' }))
    if (!upstream.ok) {
      await logOverrideEvent(supabase, {
        orgId: profile.organization_id,
        channelId,
        sessionId,
        status: 'rejected',
        speakerId: targetSpeakerId,
        operatorId: authData.user.id,
        reason,
        bobProposalId,
        details: {
          source: 'radio-floor-override',
          phase: 'phase-0-1-scaffold',
          upstream: payload,
        },
      })

      return json(409, {
        error: 'Floor override rejected',
        details: payload,
      })
    }

    await logOverrideEvent(supabase, {
      orgId: profile.organization_id,
      channelId,
      sessionId,
      status: 'granted',
      speakerId: targetSpeakerId,
      operatorId: authData.user.id,
      reason,
      bobProposalId,
      details: {
        source: 'radio-floor-override',
        phase: 'phase-0-1-scaffold',
      },
    })

    return json(200, {
      ...payload,
      phase: 'phase-0-1-scaffold',
      channelId,
      sessionId,
      reason,
      operatorId: authData.user.id,
      bobProposalId,
    })
  } catch (error) {
    await logOverrideEvent(supabase, {
      orgId: profile.organization_id,
      channelId,
      sessionId,
      status: 'rejected',
      speakerId: targetSpeakerId,
      operatorId: authData.user.id,
      reason,
      bobProposalId,
      details: {
        source: 'radio-floor-override',
        phase: 'phase-0-1-scaffold',
        exception: String(error),
      },
    })

    return json(503, {
      error: 'Floor coordinator unavailable',
      details: String(error),
    })
  }
})
