import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { getCorsHeaders } from '../_shared/withCors.ts'

type ParkingAction =
  | 'update_infringement_status'
  | 'revoke_permit'
  | 'create_parking_zone'
  | 'create_parking_permit'

interface ParkingRequest {
  action: ParkingAction
  infringementId?: string
  permitId?: string
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

    const body = (await req.json()) as ParkingRequest
    if (!body.action) {
      return new Response(JSON.stringify({ error: 'action is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (body.action === 'update_infringement_status') {
      const infringementId = toText(body.infringementId)
      const status = toText(body.payload?.status)
      if (!infringementId || !status) {
        return new Response(JSON.stringify({ error: 'infringementId and payload.status are required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: existing, error: existingError } = await adminClient
        .from('parking_infringements')
        .select('*')
        .eq('id', infringementId)
        .single()

      if (existingError || !existing) {
        return new Response(JSON.stringify({ error: 'Infringement not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (!canManageOrg(caller.role, caller.organization_id, existing.organization_id)) {
        return new Response(JSON.stringify({ error: 'Cannot manage infringements for another organization' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const updatePayload: Record<string, unknown> = { status }
      if (status === 'paid') updatePayload.payment_received_at = new Date().toISOString()

      const { data: updated, error: updateError } = await adminClient
        .from('parking_infringements')
        .update(updatePayload)
        .eq('id', infringementId)
        .select('*')
        .single()

      if (updateError || !updated) {
        throw new Error(updateError?.message ?? 'Failed to update infringement status')
      }

      const { error: auditError } = await adminClient.from('audit_log').insert({
        organization_id: updated.organization_id,
        action: 'parking_infringement_status_updated',
        entity_type: 'parking_infringement',
        entity_id: updated.id,
        performed_by: user.id,
        old_values: existing,
        new_values: updated,
      })
      if (auditError) throw new Error(`Status updated but audit artifact failed: ${auditError.message}`)

      return new Response(JSON.stringify({ ok: true, data: updated }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (body.action === 'revoke_permit') {
      const permitId = toText(body.permitId)
      if (!permitId) {
        return new Response(JSON.stringify({ error: 'permitId is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: existing, error: existingError } = await adminClient
        .from('parking_permits')
        .select('*')
        .eq('id', permitId)
        .single()

      if (existingError || !existing) {
        return new Response(JSON.stringify({ error: 'Permit not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (!canManageOrg(caller.role, caller.organization_id, existing.organization_id)) {
        return new Response(JSON.stringify({ error: 'Cannot manage permits for another organization' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: updated, error: updateError } = await adminClient
        .from('parking_permits')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', permitId)
        .select('*')
        .single()

      if (updateError || !updated) {
        throw new Error(updateError?.message ?? 'Failed to revoke permit')
      }

      const { error: auditError } = await adminClient.from('audit_log').insert({
        organization_id: updated.organization_id,
        action: 'parking_permit_revoked',
        entity_type: 'parking_permit',
        entity_id: updated.id,
        performed_by: user.id,
        old_values: existing,
        new_values: updated,
      })
      if (auditError) throw new Error(`Permit revoked but audit artifact failed: ${auditError.message}`)

      return new Response(JSON.stringify({ ok: true, data: updated }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (body.action === 'create_parking_zone') {
      const payload = body.payload ?? {}
      const organizationId = toText(payload.organization_id)
      const name = toText(payload.name)
      if (!organizationId || !name) {
        return new Response(JSON.stringify({ error: 'payload.organization_id and payload.name are required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (!canManageOrg(caller.role, caller.organization_id, organizationId)) {
        return new Response(JSON.stringify({ error: 'Cannot create zones for another organization' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const zonePayload = {
        organization_id: organizationId,
        name,
        address: payload.address ?? null,
        zone_type: payload.zone_type ?? 'time_limited',
        max_stay_minutes: payload.max_stay_minutes ?? null,
        fine_amount_nzd: payload.fine_amount_nzd ?? null,
        grace_period_minutes: payload.grace_period_minutes ?? 5,
        notes: payload.notes ?? null,
      }

      const { data: created, error: createError } = await adminClient
        .from('parking_zones')
        .insert(zonePayload)
        .select('*')
        .single()

      if (createError || !created) {
        throw new Error(createError?.message ?? 'Failed to create parking zone')
      }

      const { error: auditError } = await adminClient.from('audit_log').insert({
        organization_id: created.organization_id,
        action: 'parking_zone_created',
        entity_type: 'parking_zone',
        entity_id: created.id,
        performed_by: user.id,
        new_values: created,
      })
      if (auditError) throw new Error(`Zone created but audit artifact failed: ${auditError.message}`)

      return new Response(JSON.stringify({ ok: true, data: created }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (body.action === 'create_parking_permit') {
      const payload = body.payload ?? {}
      const organizationId = toText(payload.organization_id)
      const plateNumber = toText(payload.plate_number).toUpperCase()
      if (!organizationId || !plateNumber) {
        return new Response(JSON.stringify({ error: 'payload.organization_id and payload.plate_number are required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (!canManageOrg(caller.role, caller.organization_id, organizationId)) {
        return new Response(JSON.stringify({ error: 'Cannot create permits for another organization' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const permitPayload = {
        organization_id: organizationId,
        plate_number: plateNumber,
        permit_type: payload.permit_type ?? 'resident',
        parking_zone_id: payload.parking_zone_id ?? null,
        holder_name: payload.holder_name ?? null,
        holder_address: payload.holder_address ?? null,
        valid_from: payload.valid_from ?? null,
        valid_to: payload.valid_to ?? null,
        is_active: true,
      }

      const { data: created, error: createError } = await adminClient
        .from('parking_permits')
        .insert(permitPayload)
        .select('*')
        .single()

      if (createError || !created) {
        throw new Error(createError?.message ?? 'Failed to create parking permit')
      }

      const { error: auditError } = await adminClient.from('audit_log').insert({
        organization_id: created.organization_id,
        action: 'parking_permit_created',
        entity_type: 'parking_permit',
        entity_id: created.id,
        performed_by: user.id,
        new_values: created,
      })
      if (auditError) throw new Error(`Permit created but audit artifact failed: ${auditError.message}`)

      return new Response(JSON.stringify({ ok: true, data: created }), {
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
