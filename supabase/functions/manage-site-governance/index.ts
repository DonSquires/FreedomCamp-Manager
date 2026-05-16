import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { getCorsHeaders } from '../_shared/withCors.ts'

type GovernanceAction =
  | 'upsert_client_site'
  | 'set_client_site_active'
  | 'delete_client_site'
  | 'upsert_site_role_permission'
  | 'delete_site_role'
  | 'upsert_site_user_permission'
  | 'delete_site_user_permission'
  | 'clear_site_user_permissions'

interface GovernanceRequest {
  action: GovernanceAction
  siteId?: string
  role?: string
  userId?: string
  fieldGroup?: string
  payload?: Record<string, unknown>
}

const ADMIN_ROLES = new Set(['admin', 'admin_officer', 'master', 'grand_master'])
const GLOBAL_ROLES = new Set(['master', 'grand_master'])

function toText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function sanitizeRole(value: unknown): string {
  const role = toText(value).toLowerCase().replace(/\s+/g, '_')
  return role
}

function sanitizeFieldGroup(value: unknown): string {
  const group = toText(value).toLowerCase()
  return group
}

function sanitizeSitePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const allowed = [
    'organization_id', 'created_by', 'name', 'site_code', 'site_type', 'zone_id',
    'address', 'city', 'gps_lat', 'gps_lng', 'access_instructions', 'hazards',
    'special_instructions', 'notes', 'contact_name', 'contact_phone', 'contact_email',
    'emergency_contact_name', 'emergency_contact_phone', 'default_response_minutes',
    'priority_override', 'default_pay_rate', 'default_charge_rate', 'overtime_pay_multiplier',
    'm365_customer_id', 'm365_contract_ref', 'm365_cost_centre', 'contract_start_date',
    'contract_end_date', 'invoice_frequency', 'purchase_order_number', 'is_active', 'currency_code',
  ]

  const next: Record<string, unknown> = {}
  for (const key of allowed) {
    if (payload[key] !== undefined) next[key] = payload[key]
  }
  next.updated_at = new Date().toISOString()
  return next
}

function canManageTargetOrg(callerRole: string, callerOrgId: string | null, targetOrgId: string | null): boolean {
  if (GLOBAL_ROLES.has(callerRole)) return true
  if (!callerOrgId || !targetOrgId) return false
  return callerOrgId === targetOrgId
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

    if (!caller || !ADMIN_ROLES.has(caller.role)) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = (await req.json()) as GovernanceRequest
    if (!body.action) {
      return new Response(JSON.stringify({ error: 'action is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (body.action === 'upsert_client_site') {
      const payload = sanitizeSitePayload(body.payload ?? {})
      const siteId = toText(body.siteId)

      if (!siteId && !toText(payload.name)) {
        return new Response(JSON.stringify({ error: 'name is required for site creation' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (siteId) {
        const { data: existingSite, error: existingSiteError } = await adminClient
          .from('client_sites')
          .select('*')
          .eq('id', siteId)
          .single()

        if (existingSiteError || !existingSite) {
          return new Response(JSON.stringify({ error: 'Client site not found' }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }

        if (!canManageTargetOrg(caller.role, caller.organization_id, existingSite.organization_id)) {
          return new Response(JSON.stringify({ error: 'Cannot update site for another organization' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }

        const { data: updatedSite, error: updateError } = await adminClient
          .from('client_sites')
          .update(payload)
          .eq('id', siteId)
          .select('*')
          .single()

        if (updateError || !updatedSite) {
          throw new Error(updateError?.message ?? 'Failed to update client site')
        }

        const { error: auditError } = await adminClient.from('audit_log').insert({
          organization_id: updatedSite.organization_id,
          action: 'client_site_updated',
          entity_type: 'client_site',
          entity_id: siteId,
          performed_by: user.id,
          old_values: existingSite,
          new_values: updatedSite,
        })
        if (auditError) throw new Error(`Client site updated but audit artifact failed: ${auditError.message}`)

        return new Response(JSON.stringify({ ok: true, data: updatedSite }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const createOrgId = toText(payload.organization_id)
      if (!createOrgId) {
        return new Response(JSON.stringify({ error: 'organization_id is required for site creation' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (!canManageTargetOrg(caller.role, caller.organization_id, createOrgId)) {
        return new Response(JSON.stringify({ error: 'Cannot create site for another organization' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: createdSite, error: createError } = await adminClient
        .from('client_sites')
        .insert(payload)
        .select('*')
        .single()

      if (createError || !createdSite) {
        throw new Error(createError?.message ?? 'Failed to create client site')
      }

      const { error: auditError } = await adminClient.from('audit_log').insert({
        organization_id: createdSite.organization_id,
        action: 'client_site_created',
        entity_type: 'client_site',
        entity_id: createdSite.id,
        performed_by: user.id,
        new_values: createdSite,
      })
      if (auditError) throw new Error(`Client site created but audit artifact failed: ${auditError.message}`)

      return new Response(JSON.stringify({ ok: true, data: createdSite }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (body.action === 'set_client_site_active') {
      const siteId = toText(body.siteId)
      const isActive = Boolean(body.payload?.is_active)
      if (!siteId) {
        return new Response(JSON.stringify({ error: 'siteId is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: existingSite, error: existingSiteError } = await adminClient
        .from('client_sites')
        .select('*')
        .eq('id', siteId)
        .single()

      if (existingSiteError || !existingSite) {
        return new Response(JSON.stringify({ error: 'Client site not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (!canManageTargetOrg(caller.role, caller.organization_id, existingSite.organization_id)) {
        return new Response(JSON.stringify({ error: 'Cannot update site for another organization' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: updatedSite, error: updateError } = await adminClient
        .from('client_sites')
        .update({ is_active: isActive, updated_at: new Date().toISOString() })
        .eq('id', siteId)
        .select('*')
        .single()

      if (updateError || !updatedSite) {
        throw new Error(updateError?.message ?? 'Failed to update site status')
      }

      const { error: auditError } = await adminClient.from('audit_log').insert({
        organization_id: updatedSite.organization_id,
        action: 'client_site_status_updated',
        entity_type: 'client_site',
        entity_id: siteId,
        performed_by: user.id,
        old_values: { is_active: existingSite.is_active },
        new_values: { is_active: updatedSite.is_active },
      })
      if (auditError) throw new Error(`Site status updated but audit artifact failed: ${auditError.message}`)

      return new Response(JSON.stringify({ ok: true, data: updatedSite }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (body.action === 'delete_client_site') {
      const siteId = toText(body.siteId)
      if (!siteId) {
        return new Response(JSON.stringify({ error: 'siteId is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: existingSite, error: existingSiteError } = await adminClient
        .from('client_sites')
        .select('*')
        .eq('id', siteId)
        .single()

      if (existingSiteError || !existingSite) {
        return new Response(JSON.stringify({ error: 'Client site not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (!canManageTargetOrg(caller.role, caller.organization_id, existingSite.organization_id)) {
        return new Response(JSON.stringify({ error: 'Cannot delete site for another organization' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { error: deleteError } = await adminClient
        .from('client_sites')
        .delete()
        .eq('id', siteId)

      if (deleteError) {
        throw new Error(deleteError.message ?? 'Failed to delete client site')
      }

      const { error: auditError } = await adminClient.from('audit_log').insert({
        organization_id: existingSite.organization_id,
        action: 'client_site_deleted',
        entity_type: 'client_site',
        entity_id: siteId,
        performed_by: user.id,
        old_values: existingSite,
      })
      if (auditError) throw new Error(`Client site deleted but audit artifact failed: ${auditError.message}`)

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (body.action === 'upsert_site_role_permission') {
      const role = sanitizeRole(body.role ?? body.payload?.role)
      const fieldGroup = sanitizeFieldGroup(body.fieldGroup ?? body.payload?.field_group)
      const canView = Boolean(body.payload?.can_view)
      const canEdit = Boolean(body.payload?.can_edit)

      if (!role || !fieldGroup) {
        return new Response(JSON.stringify({ error: 'role and fieldGroup are required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: existing } = await adminClient
        .from('site_role_permissions')
        .select('id, role, field_group, can_view, can_edit')
        .eq('role', role)
        .eq('field_group', fieldGroup)
        .maybeSingle()

      let updated
      if (existing) {
        const { data, error } = await adminClient
          .from('site_role_permissions')
          .update({ can_view: canView, can_edit: canEdit, updated_by: user.id })
          .eq('id', existing.id)
          .select('*')
          .single()
        if (error) throw error
        updated = data
      } else {
        const { data, error } = await adminClient
          .from('site_role_permissions')
          .insert({ role, field_group: fieldGroup, can_view: canView, can_edit: canEdit, updated_by: user.id })
          .select('*')
          .single()
        if (error) throw error
        updated = data
      }

      const { error: auditError } = await adminClient.from('audit_log').insert({
        organization_id: caller.organization_id,
        action: 'site_role_permission_upserted',
        entity_type: 'site_permissions',
        entity_id: updated.id,
        performed_by: user.id,
        old_values: existing ?? null,
        new_values: updated,
      })
      if (auditError) throw new Error(`Role permission updated but audit artifact failed: ${auditError.message}`)

      return new Response(JSON.stringify({ ok: true, data: updated }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (body.action === 'delete_site_role') {
      const role = sanitizeRole(body.role ?? body.payload?.role)
      if (!role) {
        return new Response(JSON.stringify({ error: 'role is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: existing } = await adminClient
        .from('site_role_permissions')
        .select('id, role, field_group, can_view, can_edit')
        .eq('role', role)

      const { error } = await adminClient.from('site_role_permissions').delete().eq('role', role)
      if (error) throw error

      const { error: auditError } = await adminClient.from('audit_log').insert({
        organization_id: caller.organization_id,
        action: 'site_role_deleted',
        entity_type: 'site_permissions',
        entity_id: role,
        performed_by: user.id,
        old_values: existing ?? [],
      })
      if (auditError) throw new Error(`Role deleted but audit artifact failed: ${auditError.message}`)

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (body.action === 'upsert_site_user_permission') {
      const targetUserId = toText(body.userId ?? body.payload?.user_id)
      const fieldGroup = sanitizeFieldGroup(body.fieldGroup ?? body.payload?.field_group)
      const canViewRaw = body.payload?.can_view
      const canEditRaw = body.payload?.can_edit
      const canView = canViewRaw === null ? null : Boolean(canViewRaw)
      const canEdit = canEditRaw === null ? null : Boolean(canEditRaw)

      if (!targetUserId || !fieldGroup) {
        return new Response(JSON.stringify({ error: 'userId and fieldGroup are required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: existing } = await adminClient
        .from('site_user_permissions')
        .select('id, user_id, field_group, can_view, can_edit')
        .eq('user_id', targetUserId)
        .eq('field_group', fieldGroup)
        .maybeSingle()

      let updated
      if (existing) {
        const { data, error } = await adminClient
          .from('site_user_permissions')
          .update({ can_view: canView, can_edit: canEdit, updated_by: user.id })
          .eq('id', existing.id)
          .select('*')
          .single()
        if (error) throw error
        updated = data
      } else {
        const { data, error } = await adminClient
          .from('site_user_permissions')
          .insert({ user_id: targetUserId, field_group: fieldGroup, can_view: canView, can_edit: canEdit, updated_by: user.id })
          .select('*')
          .single()
        if (error) throw error
        updated = data
      }

      const { error: auditError } = await adminClient.from('audit_log').insert({
        organization_id: caller.organization_id,
        action: 'site_user_permission_upserted',
        entity_type: 'site_permissions',
        entity_id: updated.id,
        performed_by: user.id,
        old_values: existing ?? null,
        new_values: updated,
      })
      if (auditError) throw new Error(`User override updated but audit artifact failed: ${auditError.message}`)

      return new Response(JSON.stringify({ ok: true, data: updated }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (body.action === 'delete_site_user_permission') {
      const targetUserId = toText(body.userId ?? body.payload?.user_id)
      const fieldGroup = sanitizeFieldGroup(body.fieldGroup ?? body.payload?.field_group)
      if (!targetUserId || !fieldGroup) {
        return new Response(JSON.stringify({ error: 'userId and fieldGroup are required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: existing } = await adminClient
        .from('site_user_permissions')
        .select('id, user_id, field_group, can_view, can_edit')
        .eq('user_id', targetUserId)
        .eq('field_group', fieldGroup)
        .maybeSingle()

      if (existing) {
        const { error } = await adminClient.from('site_user_permissions').delete().eq('id', existing.id)
        if (error) throw error
      }

      const { error: auditError } = await adminClient.from('audit_log').insert({
        organization_id: caller.organization_id,
        action: 'site_user_permission_deleted',
        entity_type: 'site_permissions',
        entity_id: `${targetUserId}:${fieldGroup}`,
        performed_by: user.id,
        old_values: existing ?? null,
      })
      if (auditError) throw new Error(`User override removed but audit artifact failed: ${auditError.message}`)

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (body.action === 'clear_site_user_permissions') {
      const targetUserId = toText(body.userId ?? body.payload?.user_id)
      if (!targetUserId) {
        return new Response(JSON.stringify({ error: 'userId is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: existing } = await adminClient
        .from('site_user_permissions')
        .select('id, user_id, field_group, can_view, can_edit')
        .eq('user_id', targetUserId)

      const { error } = await adminClient
        .from('site_user_permissions')
        .delete()
        .eq('user_id', targetUserId)
      if (error) throw error

      const { error: auditError } = await adminClient.from('audit_log').insert({
        organization_id: caller.organization_id,
        action: 'site_user_permissions_cleared',
        entity_type: 'site_permissions',
        entity_id: targetUserId,
        performed_by: user.id,
        old_values: existing ?? [],
      })
      if (auditError) throw new Error(`User overrides cleared but audit artifact failed: ${auditError.message}`)

      return new Response(JSON.stringify({ ok: true, removed: existing?.length ?? 0 }), {
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
