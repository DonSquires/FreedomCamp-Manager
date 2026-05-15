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

  let body: { channelId?: string; sessionId?: string }
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }

  const channelId = String(body.channelId ?? '').trim()
  const sessionId = String(body.sessionId ?? '').trim()
  if (!channelId || !sessionId) {
    return json(400, { error: 'channelId and sessionId are required' })
  }

  // Phase 0-1 scaffold: relay to external floor coordinator when configured.
  if (!RADIO_FLOOR_PROVIDER_URL || !RADIO_PROXY_SECRET) {
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
      return json(409, {
        error: 'Floor acquire rejected',
        details: payload,
      })
    }

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
