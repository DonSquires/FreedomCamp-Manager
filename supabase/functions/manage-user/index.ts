import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { getCorsHeaders } from '../_shared/withCors.ts'

interface ManageUserRequest {
  action: 'create' | 'update' | 'set_password' | 'deactivate'
  userId?: string
  organizationId?: string
  payload?: Record<string, unknown>
}

Deno.serve(async (req) => {
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
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

    const adminClient = createClient(supabaseUrl, serviceRoleKey)
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: { user }, error: authError } = await userClient.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: caller } = await adminClient
      .from('user_profiles')
      .select('organization_id, role')
      .eq('id', user.id)
      .single()

    const isAdminLike = caller && ['admin', 'master', 'grand_master'].includes(caller.role)
    if (!isAdminLike) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = (await req.json()) as ManageUserRequest
    if (!body.action) {
      return new Response(JSON.stringify({ error: 'action is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (body.action === 'create') {
      const email = String(body.payload?.email ?? '').trim().toLowerCase()
      const password = String(body.payload?.password ?? '')
      const role = String(body.payload?.role ?? '')
      const organizationId = String(body.organizationId ?? body.payload?.organization_id ?? '')

      if (!email || !password || !role || !organizationId) {
        return new Response(JSON.stringify({ error: 'email, password, role, and organizationId are required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (caller.role !== 'grand_master' && caller.organization_id !== organizationId) {
        return new Response(JSON.stringify({ error: 'Cannot create users in another organization' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: authCreate, error: authCreateError } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      })
      if (authCreateError || !authCreate.user) {
        throw new Error(authCreateError?.message ?? 'Failed to create auth user')
      }

      const { data: profile, error: profileError } = await adminClient
        .from('user_profiles')
        .upsert({
          id: authCreate.user.id,
          email,
          role,
          organization_id: organizationId,
          full_name: body.payload?.full_name ?? null,
          is_active: true,
        })
        .select('id,email,role,organization_id,is_active')
        .single()

      if (profileError) {
        await adminClient.auth.admin.deleteUser(authCreate.user.id)
        throw new Error(profileError.message)
      }

      return new Response(JSON.stringify({ ok: true, data: profile }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!body.userId) {
      return new Response(JSON.stringify({ error: 'userId is required for this action' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: targetProfile } = await adminClient
      .from('user_profiles')
      .select('id,organization_id')
      .eq('id', body.userId)
      .single()

    if (!targetProfile) {
      return new Response(JSON.stringify({ error: 'Target user not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (caller.role !== 'grand_master' && caller.organization_id !== targetProfile.organization_id) {
      return new Response(JSON.stringify({ error: 'Cannot manage users in another organization' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (body.action === 'set_password') {
      const password = String(body.payload?.password ?? '')
      if (!password) {
        return new Response(JSON.stringify({ error: 'password is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { error } = await adminClient.auth.admin.updateUserById(body.userId, { password })
      if (error) throw new Error(error.message)

      return new Response(JSON.stringify({ ok: true, message: 'Password updated' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (body.action === 'deactivate') {
      const { error } = await adminClient
        .from('user_profiles')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', body.userId)
      if (error) throw new Error(error.message)

      return new Response(JSON.stringify({ ok: true, message: 'User deactivated' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }
    if (body.payload?.full_name !== undefined) updates.full_name = body.payload.full_name
    if (body.payload?.role !== undefined) updates.role = body.payload.role
    if (body.payload?.email !== undefined) updates.email = body.payload.email
    if (body.payload?.is_active !== undefined) updates.is_active = body.payload.is_active

    const { data: updated, error: updateError } = await adminClient
      .from('user_profiles')
      .update(updates)
      .eq('id', body.userId)
      .select('id,email,role,organization_id,is_active,updated_at')
      .single()

    if (updateError) throw new Error(updateError.message)

    return new Response(JSON.stringify({ ok: true, data: updated }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
