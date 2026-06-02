import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { getCorsHeaders } from '../_shared/withCors.ts'

const OWNER_EMAIL = (Deno.env.get('GRANDMASTER_OWNER_EMAIL') || '').trim().toLowerCase()

if (!OWNER_EMAIL) {
  throw new Error('GRANDMASTER_OWNER_EMAIL environment variable must be configured before deploying this function')
}

interface ResetRequest {
  confirmation?: string
}

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const adminClient = createClient(supabaseUrl, serviceRoleKey)

    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const { data: { user }, error: authError } = await adminClient.auth.getUser(token)
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid or expired session' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: profile } = await adminClient
      .from('user_profiles')
      .select('role, email')
      .eq('id', user.id)
      .maybeSingle()

    const email = String(profile?.email ?? user.email ?? '').trim().toLowerCase()
    if (profile?.role !== 'grand_master' || email !== OWNER_EMAIL) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = (await req.json()) as ResetRequest
    const { data, error } = await adminClient.rpc('reset_operational_data_preserving_bob', {
      p_actor_id: user.id,
      p_actor_email: email,
      p_confirmation: String(body?.confirmation ?? ''),
    })

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const summary = (data ?? {}) as Record<string, unknown>
    const affectedAuthUsers = Array.isArray(summary.affected_auth_users)
      ? (summary.affected_auth_users as Array<Record<string, unknown>>)
      : []

    const deletedAuthUsers: string[] = []
    const authDeleteFailures: Array<{ id: string; email: string; error: string }> = []

    for (const account of affectedAuthUsers) {
      const targetId = String(account?.id ?? '').trim()
      const targetEmail = String(account?.email ?? '').trim()
      if (!targetId || targetId === user.id) continue

      const { error: deleteError } = await adminClient.auth.admin.deleteUser(targetId)
      if (deleteError) {
        authDeleteFailures.push({
          id: targetId,
          email: targetEmail,
          error: deleteError.message,
        })
        continue
      }

      deletedAuthUsers.push(targetId)
    }

    return new Response(JSON.stringify({
      ok: true,
      summary,
      auth_users_deleted: deletedAuthUsers.length,
      auth_delete_failures: authDeleteFailures,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected reset failure'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
