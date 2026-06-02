import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { getCorsHeaders } from '../_shared/withCors.ts'
import {
  normalizeEmailAddress,
  normalizeStringArray,
  resolveAuthorizedWorkLocations,
  resolveEmployerOrganizationId,
  resolveUserNames,
  trimToNull,
} from '../../../src/lib/entityCreationDefaults.ts'

interface ManageUserRequest {
  action: 'create' | 'invite' | 'update' | 'update_access' | 'set_password' | 'deactivate' | 'disconnect_ptt' | 'set_ptt_channel_access'
  userId?: string
  organizationId?: string
  payload?: Record<string, unknown>
}

type PttScopeMode = 'replace' | 'grant' | 'revoke'

const PTT_SCOPE_PATTERN = /^(org|incident|direct|team|deployment):[a-f0-9-]+$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PORTAL_ACCESS_PATTERN = /^[a-z0-9_:-]{2,64}$/

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const segments = String(token || '').split('.')
  if (segments.length < 2) return null

  try {
    const json = atob(segments[1].replace(/-/g, '+').replace(/_/g, '/'))
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
}

function normalizeScopeList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return Array.from(
    new Set(
      raw
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter((scope) => scope.length > 0 && PTT_SCOPE_PATTERN.test(scope)),
    ),
  )
}

function normalizeUuidList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return Array.from(
    new Set(
      raw
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter((id) => UUID_PATTERN.test(id)),
    ),
  )
}

function normalizePortalAccess(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return Array.from(
    new Set(
      raw
        .map((entry) => (typeof entry === 'string' ? entry.trim().toLowerCase() : ''))
        .filter((code) => PORTAL_ACCESS_PATTERN.test(code)),
    ),
  )
}

function applyPttScopeMutation(currentScopes: string[], incomingScopes: string[], mode: PttScopeMode): string[] {
  if (mode === 'replace') return incomingScopes

  const currentSet = new Set(currentScopes)
  if (mode === 'grant') {
    for (const scope of incomingScopes) currentSet.add(scope)
    return Array.from(currentSet)
  }

  for (const scope of incomingScopes) currentSet.delete(scope)
  return Array.from(currentSet)
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

async function revokeActivePTTConnection(
  userId: string,
  reason = 'user_deactivated',
): Promise<{ attempted: boolean; ok: boolean; status?: number; message?: string }> {
  const pttServerUrl =
    Deno.env.get('PTT_SERVER_URL') ||
    Deno.env.get('PTT_SERVICE_URL') ||
    ''
  const pttProxySecret = Deno.env.get('PTT_PROXY_SECRET') || ''

  if (!pttServerUrl || !pttProxySecret) {
    return { attempted: false, ok: true, message: 'PTT revoke skipped: missing PTT_SERVER_URL or PTT_PROXY_SECRET' }
  }

  const normalized = normalizeBaseUrl(pttServerUrl)
  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    return { attempted: false, ok: false, message: 'PTT revoke skipped: invalid PTT server URL' }
  }

  const encodedReason = encodeURIComponent(reason)
  const endpoint = `${normalized}/api/connections/${encodeURIComponent(userId)}?reason=${encodedReason}`

  try {
    const response = await fetch(endpoint, {
      method: 'DELETE',
      headers: {
        'x-proxy-secret': pttProxySecret,
      },
      signal: AbortSignal.timeout(8000),
    })

    if (response.ok || response.status === 404) {
      return { attempted: true, ok: true, status: response.status }
    }

    const text = await response.text().catch(() => '')
    return {
      attempted: true,
      ok: false,
      status: response.status,
      message: text.slice(0, 200) || `PTT revoke failed with ${response.status}`,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'PTT revoke request failed'
    return { attempted: true, ok: false, message }
  }
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

    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim()
    const jwtPayload = decodeJwtPayload(jwt)
    let userId = typeof jwtPayload?.sub === 'string' && jwtPayload.sub.trim() ? jwtPayload.sub.trim() : ''

    if (!userId) {
      const { data: { user }, error: authError } = await userClient.auth.getUser(jwt)
      if (authError || !user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      userId = user.id
    }

    const { data: caller } = await adminClient
      .from('user_profiles')
      .select('organization_id, role')
      .eq('id', userId)
      .single()

    const isAdminLike = caller && ['admin', 'systems_administrator', 'admin_officer', 'master', 'grand_master'].includes(caller.role)
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
      const payload = body.payload ?? {}
      const email = normalizeEmailAddress(payload.email)
      const password = String(payload.password ?? '')
      const role = trimToNull(payload.role) ?? ''
      const organizationId = trimToNull(body.organizationId ?? payload.organization_id) ?? ''
      const normalizedExtraOrganizationIds = normalizeUuidList(normalizeStringArray(payload.extra_organization_ids))
      const resolvedEmployerOrganizationId = resolveEmployerOrganizationId(
        organizationId || null,
        trimToNull(payload.employer_organization_id),
      )
      const normalizedAuthorizedWorkLocations = normalizeUuidList(
        resolveAuthorizedWorkLocations(
          organizationId || null,
          normalizedExtraOrganizationIds,
          normalizeStringArray(payload.authorized_work_locations),
        ),
      )
      const normalizedPortalAccess = normalizePortalAccess(normalizeStringArray(payload.portal_access))
      const normalizedPttChannelAccess = normalizeScopeList(normalizeStringArray(payload.ptt_channel_access))
      const normalizedNames = resolveUserNames({
        email,
        first_name: payload.first_name,
        last_name: payload.last_name,
        role,
      })

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
        user_metadata: {
          first_name: normalizedNames.first_name ?? undefined,
          last_name: normalizedNames.last_name ?? undefined,
          full_name: [normalizedNames.first_name, normalizedNames.last_name].filter(Boolean).join(' ') || undefined,
          organization_id: organizationId,
          employer_organization_id: resolvedEmployerOrganizationId ?? undefined,
          role,
        },
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
          first_name: normalizedNames.first_name,
          last_name: normalizedNames.last_name,
          phone: trimToNull(payload.phone),
          job_title: trimToNull(payload.job_title),
          requires_driver_license: payload.requires_driver_license === true,
          employer_organization_id: resolvedEmployerOrganizationId,
          portal_access: normalizedPortalAccess,
          authorized_work_locations: normalizedAuthorizedWorkLocations,
          extra_organization_ids: normalizedExtraOrganizationIds,
          ptt_channel_access: normalizedPttChannelAccess,
          permissions: payload.permissions ?? [],
          is_active: true,
          updated_at: new Date().toISOString(),
        })
        .select('id,email,role,organization_id,employer_organization_id,is_active')
        .single()

      if (profileError) {
        await adminClient.auth.admin.deleteUser(authCreate.user.id)
        throw new Error(profileError.message)
      }

      return new Response(JSON.stringify({ ok: true, data: profile }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (body.action === 'invite') {
      const email = String(body.payload?.email ?? '').trim().toLowerCase()
      const role = String(body.payload?.role ?? '')
      const organizationId = String(body.organizationId ?? body.payload?.organization_id ?? '')
      const payload = body.payload ?? {}
      const normalizedEmail = normalizeEmailAddress(payload.email)
      const normalizedOrganizationId = trimToNull(body.organizationId ?? payload.organization_id) ?? ''
      const normalizedRole = trimToNull(payload.role) ?? ''
      const firstName = trimToNull(payload.first_name) ?? ''
      const lastName = trimToNull(payload.last_name) ?? ''
      const normalizedExtraOrganizationIds = normalizeUuidList(normalizeStringArray(payload.extra_organization_ids))
      const normalizedAuthorizedWorkLocations = normalizeUuidList(
        resolveAuthorizedWorkLocations(
          normalizedOrganizationId || null,
          normalizedExtraOrganizationIds,
          normalizeStringArray(payload.authorized_work_locations),
        ),
      )
      const normalizedPortalAccess = normalizePortalAccess(normalizeStringArray(payload.portal_access))
      const normalizedPttChannelAccess = normalizeScopeList(normalizeStringArray(payload.ptt_channel_access))
      const normalizedEmployerOrganizationId = resolveEmployerOrganizationId(
        normalizedOrganizationId || null,
        trimToNull(payload.employer_organization_id),
      )

      if (!normalizedEmail || !normalizedRole || !normalizedOrganizationId || !firstName || !lastName) {
        return new Response(JSON.stringify({ error: 'email, first_name, last_name, role, and organization_id are required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (!['grand_master', 'systems_administrator'].includes(caller.role) && caller.organization_id !== normalizedOrganizationId) {
        return new Response(JSON.stringify({ error: 'Cannot invite users to another organization' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const siteUrl = Deno.env.get('SITE_URL') || Deno.env.get('APP_URL') || 'https://fcmanager.co.nz'
      const redirectTo = `${normalizeBaseUrl(siteUrl)}/login`

      const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
        type: 'invite',
        email: normalizedEmail,
        options: { redirectTo },
      })
      if (linkError) throw new Error(linkError.message)

      const invitedUserId = String((linkData as any)?.user?.id ?? '')
      const inviteUrl = String((linkData as any)?.properties?.action_link ?? '')
      if (!invitedUserId || !inviteUrl) {
        throw new Error('Failed to generate invite link')
      }

      const { data: profile, error: profileError } = await adminClient
        .from('user_profiles')
        .upsert({
          id: invitedUserId,
          email: normalizedEmail,
          role: normalizedRole,
          first_name: firstName || null,
          last_name: lastName || null,
          phone: trimToNull(payload.phone),
          job_title: trimToNull(payload.job_title),
          requires_driver_license: payload.requires_driver_license === true,
          organization_id: normalizedOrganizationId,
          employer_organization_id: normalizedEmployerOrganizationId,
          portal_access: normalizedPortalAccess,
          authorized_work_locations: normalizedAuthorizedWorkLocations,
          extra_organization_ids: normalizedExtraOrganizationIds,
          ptt_channel_access: normalizedPttChannelAccess,
          is_active: true,
          updated_at: new Date().toISOString(),
        })
        .select('id,email,role,organization_id,employer_organization_id,is_active')
        .single()

      if (profileError || !profile) {
        throw new Error(profileError?.message ?? 'Failed to create invite profile')
      }

      const emailResponse = await fetch(`${supabaseUrl}/functions/v1/send-invite-email`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + serviceRoleKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: normalizedEmail,
          first_name: firstName || undefined,
          invite_url: inviteUrl,
          organization_id: normalizedOrganizationId,
        }),
      })

      if (!emailResponse.ok) {
        const message = await emailResponse.text().catch(() => '')
        throw new Error(message || 'Failed to send invite email')
      }

      return new Response(JSON.stringify({ ok: true, data: profile, invited: true }), {
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
      .select(`
        id,
        organization_id,
        first_name,
        last_name,
        full_name,
        email,
        role,
        phone,
        job_title,
        requires_driver_license,
        employer_organization_id,
        portal_access,
        authorized_work_locations,
        extra_organization_ids,
        ptt_channel_access,
        permissions,
        is_active
      `)
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

    if (body.action === 'update_access') {
      const portalAccess = normalizePortalAccess(body.payload?.portal_access)
      const authorizedWorkLocations = normalizeUuidList(body.payload?.authorized_work_locations)
      const extraOrganizationIds = normalizeUuidList(body.payload?.extra_organization_ids)
      const sourceModule = typeof body.payload?.source_module === 'string' ? body.payload.source_module : 'access_control'

      const { data: existingProfile, error: existingProfileError } = await adminClient
        .from('user_profiles')
        .select('id, organization_id, portal_access, authorized_work_locations, extra_organization_ids')
        .eq('id', body.userId)
        .single()

      if (existingProfileError || !existingProfile) {
        return new Response(JSON.stringify({ error: 'Target user profile not found for access update' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: updatedAccess, error: updateAccessError } = await adminClient
        .from('user_profiles')
        .update({
          portal_access: portalAccess,
          authorized_work_locations: authorizedWorkLocations,
          extra_organization_ids: extraOrganizationIds,
          updated_at: new Date().toISOString(),
        })
        .eq('id', body.userId)
        .select('id, portal_access, authorized_work_locations, extra_organization_ids, updated_at')
        .single()

      if (updateAccessError || !updatedAccess) {
        throw new Error(updateAccessError?.message ?? 'Failed to update user access settings')
      }

      const { error: auditError } = await adminClient
        .from('audit_log')
        .insert({
          organization_id: targetProfile.organization_id,
          action: 'user_access_updated',
          entity_type: 'user_profile',
          entity_id: body.userId,
          performed_by: user.id,
          old_values: {
            portal_access: existingProfile.portal_access ?? [],
            authorized_work_locations: existingProfile.authorized_work_locations ?? [],
            extra_organization_ids: existingProfile.extra_organization_ids ?? [],
          },
          new_values: {
            portal_access: portalAccess,
            authorized_work_locations: authorizedWorkLocations,
            extra_organization_ids: extraOrganizationIds,
            source_module: sourceModule,
          },
        })

      if (auditError) {
        throw new Error(`Access updated but audit artifact failed: ${auditError.message}`)
      }

      return new Response(JSON.stringify({
        ok: true,
        data: updatedAccess,
        audit: { action: 'user_access_updated', source_module: sourceModule },
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (body.action === 'deactivate') {
      const { error } = await adminClient
        .from('user_profiles')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', body.userId)
      if (error) throw new Error(error.message)

      const pttRevoke = await revokeActivePTTConnection(body.userId)

      return new Response(JSON.stringify({ ok: true, message: 'User deactivated', pttRevoke }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (body.action === 'disconnect_ptt') {
      const pttRevoke = await revokeActivePTTConnection(body.userId, 'admin_forced_disconnect')

      return new Response(JSON.stringify({ ok: true, message: 'PTT disconnect requested', pttRevoke }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (body.action === 'set_ptt_channel_access') {
      if (!['master', 'grand_master'].includes(caller.role)) {
        return new Response(JSON.stringify({ error: 'Only master or grand_master can modify cross-organization PTT scope access' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const modeRaw = String(body.payload?.mode ?? 'replace').toLowerCase()
      const mode: PttScopeMode = modeRaw === 'grant' || modeRaw === 'revoke' ? modeRaw : 'replace'
      const requestedScopes = normalizeScopeList(body.payload?.scopes)

      const { data: existingProfile, error: existingProfileError } = await adminClient
        .from('user_profiles')
        .select('id, ptt_channel_access')
        .eq('id', body.userId)
        .single()

      if (existingProfileError || !existingProfile) {
        return new Response(JSON.stringify({ error: 'Target user profile not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const currentScopes = normalizeScopeList(existingProfile.ptt_channel_access)
      const mergedScopes = applyPttScopeMutation(currentScopes, requestedScopes, mode)

      const { data: updatedScopesProfile, error: scopeUpdateError } = await adminClient
        .from('user_profiles')
        .update({
          ptt_channel_access: mergedScopes,
          updated_at: new Date().toISOString(),
        })
        .eq('id', body.userId)
        .select('id, ptt_channel_access, updated_at')
        .single()

      if (scopeUpdateError) throw new Error(scopeUpdateError.message)

      return new Response(JSON.stringify({
        ok: true,
        data: updatedScopesProfile,
        mode,
        requested_scopes: requestedScopes,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const payload = body.payload ?? {}
    const requestedOrganizationId = trimToNull(payload.organization_id)
    const effectiveOrganizationId = requestedOrganizationId ?? targetProfile.organization_id

    if (
      requestedOrganizationId &&
      requestedOrganizationId !== targetProfile.organization_id &&
      !['grand_master', 'systems_administrator'].includes(caller.role) &&
      caller.organization_id !== requestedOrganizationId
    ) {
      return new Response(JSON.stringify({ error: 'Cannot move users to another organization' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const normalizedExtraOrganizationIds =
      payload.extra_organization_ids !== undefined
        ? normalizeUuidList(normalizeStringArray(payload.extra_organization_ids))
        : normalizeUuidList(normalizeStringArray(targetProfile.extra_organization_ids))
    const normalizedPortalAccess =
      payload.portal_access !== undefined
        ? normalizePortalAccess(normalizeStringArray(payload.portal_access))
        : normalizePortalAccess(normalizeStringArray(targetProfile.portal_access))
    const normalizedPttChannelAccess =
      payload.ptt_channel_access !== undefined
        ? normalizeScopeList(normalizeStringArray(payload.ptt_channel_access))
        : normalizeScopeList(normalizeStringArray(targetProfile.ptt_channel_access))
    const normalizedAuthorizedWorkLocations =
      payload.authorized_work_locations !== undefined
        ? normalizeUuidList(
          resolveAuthorizedWorkLocations(
            effectiveOrganizationId || null,
            normalizedExtraOrganizationIds,
            normalizeStringArray(payload.authorized_work_locations),
          ),
        )
        : normalizeUuidList(
          resolveAuthorizedWorkLocations(
            effectiveOrganizationId || null,
            normalizedExtraOrganizationIds,
            normalizeStringArray(targetProfile.authorized_work_locations),
          ),
        )
    const resolvedEmployerOrganizationId = resolveEmployerOrganizationId(
      effectiveOrganizationId || null,
      trimToNull(
        payload.employer_organization_id !== undefined
          ? payload.employer_organization_id
          : targetProfile.employer_organization_id,
      ),
    )

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }

    if (payload.role !== undefined) updates.role = trimToNull(payload.role)
    if (payload.email !== undefined) updates.email = normalizeEmailAddress(payload.email)
    if (payload.organization_id !== undefined) updates.organization_id = effectiveOrganizationId
    if (payload.phone !== undefined) updates.phone = trimToNull(payload.phone)
    if (payload.job_title !== undefined) updates.job_title = trimToNull(payload.job_title)
    if (payload.requires_driver_license !== undefined) updates.requires_driver_license = payload.requires_driver_license === true
    if (payload.portal_access !== undefined) updates.portal_access = normalizedPortalAccess
    if (payload.authorized_work_locations !== undefined) updates.authorized_work_locations = normalizedAuthorizedWorkLocations
    if (payload.extra_organization_ids !== undefined) updates.extra_organization_ids = normalizedExtraOrganizationIds
    if (payload.ptt_channel_access !== undefined) updates.ptt_channel_access = normalizedPttChannelAccess
    if (payload.permissions !== undefined) updates.permissions = payload.permissions
    if (payload.is_active !== undefined) updates.is_active = payload.is_active
    if (
      payload.organization_id !== undefined ||
      payload.employer_organization_id !== undefined ||
      payload.extra_organization_ids !== undefined ||
      payload.authorized_work_locations !== undefined
    ) {
      updates.employer_organization_id = resolvedEmployerOrganizationId
      updates.extra_organization_ids = normalizedExtraOrganizationIds
      updates.authorized_work_locations = normalizedAuthorizedWorkLocations
    }

    if (payload.first_name !== undefined) updates.first_name = trimToNull(payload.first_name)
    if (payload.last_name !== undefined) updates.last_name = trimToNull(payload.last_name)
    if (payload.full_name !== undefined) {
      updates.full_name = trimToNull(payload.full_name)
    } else if (payload.first_name !== undefined || payload.last_name !== undefined) {
      const nextFirstName = updates.first_name !== undefined ? updates.first_name : targetProfile.first_name
      const nextLastName = updates.last_name !== undefined ? updates.last_name : targetProfile.last_name
      const computedFullName = [nextFirstName, nextLastName].filter((value) => typeof value === 'string' && value.trim().length > 0).join(' ').trim()
      updates.full_name = computedFullName || null
    }

    const { data: updated, error: updateError } = await adminClient
      .from('user_profiles')
      .update(updates)
      .eq('id', body.userId)
      .select('id,email,role,organization_id,is_active,updated_at,first_name,last_name,employer_organization_id,authorized_work_locations,extra_organization_ids')
      .single()

    if (updateError) throw new Error(updateError.message)

    if (
      payload.email !== undefined ||
      payload.role !== undefined ||
      payload.organization_id !== undefined ||
      payload.first_name !== undefined ||
      payload.last_name !== undefined
    ) {
      const metadataFirstName =
        payload.first_name !== undefined
          ? trimToNull(payload.first_name)
          : trimToNull(updated.first_name ?? targetProfile.first_name)
      const metadataLastName =
        payload.last_name !== undefined
          ? trimToNull(payload.last_name)
          : trimToNull(updated.last_name ?? targetProfile.last_name)

      const authUpdates: Record<string, unknown> = {
        user_metadata: {
          first_name: metadataFirstName ?? undefined,
          last_name: metadataLastName ?? undefined,
          full_name: [metadataFirstName, metadataLastName].filter(Boolean).join(' ') || undefined,
          organization_id: updated.organization_id ?? targetProfile.organization_id ?? undefined,
          employer_organization_id: updated.employer_organization_id ?? resolvedEmployerOrganizationId ?? undefined,
          role: updated.role ?? targetProfile.role ?? undefined,
        },
      }

      if (payload.email !== undefined && updated.email) {
        authUpdates.email = updated.email
      }

      const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(body.userId, authUpdates)
      if (authUpdateError) {
        throw new Error(`Profile updated but auth metadata sync failed: ${authUpdateError.message}`)
      }
    }

    const shouldRevokePtt = body.payload?.is_active === false
    const pttRevoke = shouldRevokePtt
      ? await revokeActivePTTConnection(body.userId)
      : { attempted: false, ok: true, message: 'PTT revoke not required' }

    return new Response(JSON.stringify({ ok: true, data: updated, pttRevoke }), {
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
