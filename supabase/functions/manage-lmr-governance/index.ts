import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { getCorsHeaders } from '../_shared/withCors.ts'

type LmrAction = 'upsert_config' | 'delete_config' | 'set_config_active'

interface LmrRequest {
  action: LmrAction
  configId?: string
  payload?: Record<string, unknown>
}

const ADMIN_ROLES = new Set(['admin', 'admin_officer', 'master', 'grand_master'])
const GLOBAL_ROLES = new Set(['master', 'grand_master'])

function toText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function canManageOrg(callerRole: string, callerOrgId: string | null, targetOrgId: string | null): boolean {
  if (GLOBAL_ROLES.has(callerRole)) return true
  if (!callerOrgId || !targetOrgId) return false
  return callerOrgId === targetOrgId
}

function sanitizeConfigPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const allowed = ['organization_id', 'label', 'gateway_url', 'gateway_token', 'radio_channel', 'direction', 'is_active', 'notes']
  const next: Record<string, unknown> = {}
  for (const key of allowed) {
    if (payload[key] !== undefined) next[key] = payload[key]
  }
  return next
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

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser()

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

    if (!caller || !ADMIN_ROLES.has(caller.role)) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = (await req.json()) as LmrRequest
    if (!body.action) {
      return new Response(JSON.stringify({ error: 'action is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (body.action === 'upsert_config') {
      const configId = toText(body.configId)
      const payload = sanitizeConfigPayload(body.payload ?? {})

      if (configId) {
        const { data: existing, error: existingError } = await adminClient
          .from('lmr_bridge_config')
          .select('*')
          .eq('id', configId)
          .single()

        if (existingError || !existing) {
          return new Response(JSON.stringify({ error: 'Bridge config not found' }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }

        if (!canManageOrg(caller.role, caller.organization_id, existing.organization_id)) {
          return new Response(JSON.stringify({ error: 'Cannot update config for another organization' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }

        const { data: updated, error: updateError } = await adminClient
          .from('lmr_bridge_config')
          .update(payload)
          .eq('id', configId)
          .select('*')
          .single()

        if (updateError || !updated) throw new Error(updateError?.message ?? 'Failed to update bridge config')

        const { error: auditError } = await adminClient.from('audit_log').insert({
          organization_id: updated.organization_id,
          action: 'lmr_bridge_config_updated',
          entity_type: 'lmr_bridge_config',
          entity_id: updated.id,
          performed_by: user.id,
          old_values: existing,
          new_values: updated,
        })
        if (auditError) throw new Error(`Config updated but audit artifact failed: ${auditError.message}`)

        return new Response(JSON.stringify({ ok: true, data: updated }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const orgId = toText(payload.organization_id)
      const label = toText(payload.label)
      const gatewayUrl = toText(payload.gateway_url)
      if (!orgId || !label || !gatewayUrl) {
        return new Response(JSON.stringify({ error: 'organization_id, label, gateway_url are required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (!canManageOrg(caller.role, caller.organization_id, orgId)) {
        return new Response(JSON.stringify({ error: 'Cannot create config for another organization' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: created, error: createError } = await adminClient
        .from('lmr_bridge_config')
        .insert(payload)
        .select('*')
        .single()

      if (createError || !created) throw new Error(createError?.message ?? 'Failed to create bridge config')

      const { error: auditError } = await adminClient.from('audit_log').insert({
        organization_id: created.organization_id,
        action: 'lmr_bridge_config_created',
        entity_type: 'lmr_bridge_config',
        entity_id: created.id,
        performed_by: user.id,
        new_values: created,
      })
      if (auditError) throw new Error(`Config created but audit artifact failed: ${auditError.message}`)

      return new Response(JSON.stringify({ ok: true, data: created }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (body.action === 'delete_config') {
      const configId = toText(body.configId)
      if (!configId) {
        return new Response(JSON.stringify({ error: 'configId is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: existing, error: existingError } = await adminClient
        .from('lmr_bridge_config')
        .select('*')
        .eq('id', configId)
        .single()

      if (existingError || !existing) {
        return new Response(JSON.stringify({ error: 'Bridge config not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (!canManageOrg(caller.role, caller.organization_id, existing.organization_id)) {
        return new Response(JSON.stringify({ error: 'Cannot delete config for another organization' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { error: deleteError } = await adminClient
        .from('lmr_bridge_config')
        .delete()
        .eq('id', configId)

      if (deleteError) throw new Error(deleteError.message ?? 'Failed to delete bridge config')

      const { error: auditError } = await adminClient.from('audit_log').insert({
        organization_id: existing.organization_id,
        action: 'lmr_bridge_config_deleted',
        entity_type: 'lmr_bridge_config',
        entity_id: configId,
        performed_by: user.id,
        old_values: existing,
      })
      if (auditError) throw new Error(`Config deleted but audit artifact failed: ${auditError.message}`)

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (body.action === 'set_config_active') {
      const configId = toText(body.configId)
      const isActive = Boolean(body.payload?.is_active)
      if (!configId) {
        return new Response(JSON.stringify({ error: 'configId is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: existing, error: existingError } = await adminClient
        .from('lmr_bridge_config')
        .select('*')
        .eq('id', configId)
        .single()

      if (existingError || !existing) {
        return new Response(JSON.stringify({ error: 'Bridge config not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (!canManageOrg(caller.role, caller.organization_id, existing.organization_id)) {
        return new Response(JSON.stringify({ error: 'Cannot update config for another organization' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: updated, error: updateError } = await adminClient
        .from('lmr_bridge_config')
        .update({ is_active: isActive, updated_at: new Date().toISOString() })
        .eq('id', configId)
        .select('*')
        .single()

      if (updateError || !updated) throw new Error(updateError?.message ?? 'Failed to update config active state')

      const { error: auditError } = await adminClient.from('audit_log').insert({
        organization_id: updated.organization_id,
        action: 'lmr_bridge_config_status_updated',
        entity_type: 'lmr_bridge_config',
        entity_id: updated.id,
        performed_by: user.id,
        old_values: { is_active: existing.is_active },
        new_values: { is_active: updated.is_active },
      })
      if (auditError) throw new Error(`Config status updated but audit artifact failed: ${auditError.message}`)

      return new Response(JSON.stringify({ ok: true, data: updated }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ error: `Unsupported action: ${body.action}` }), {
      status: 400,
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
