import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const RADIO_GRANT_ENDPOINT = Deno.env.get('RADIO_GRANT_ENDPOINT') ?? ''
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

  let body: { channelScope?: string }
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }

  const channelScope = String(body.channelScope ?? '').trim()
  if (!channelScope) {
    return json(400, { error: 'channelScope is required' })
  }

  // Phase 0-1 scaffold: proxy to control-plane grant endpoint when configured.
  if (!RADIO_GRANT_ENDPOINT || !RADIO_PROXY_SECRET) {
    return json(501, {
      error: 'radio-session-grant not configured',
      message: 'Set RADIO_GRANT_ENDPOINT and RADIO_PROXY_SECRET to enable grant minting.',
      phase: 'phase-0-1-scaffold',
      channelScope,
    })
  }

  try {
    const upstream = await fetch(RADIO_GRANT_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-proxy-secret': RADIO_PROXY_SECRET,
        'x-org-id': req.headers.get('x-org-id') ?? '',
      },
      body: JSON.stringify({ channelScope, userId: authData.user.id }),
    })

    const payload = await upstream.json().catch(() => ({ error: 'Invalid upstream response' }))
    if (!upstream.ok) {
      return json(502, {
        error: 'Grant provider rejected request',
        details: payload,
      })
    }

    return json(200, {
      ...payload,
      channelScope,
      phase: 'phase-0-1-scaffold',
    })
  } catch (error) {
    return json(503, {
      error: 'Grant provider unavailable',
      details: String(error),
    })
  }
})
