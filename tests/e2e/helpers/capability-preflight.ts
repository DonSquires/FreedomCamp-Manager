import type { Page } from '@playwright/test'
import { getTestUser } from '../auth'
import { supabaseAdmin } from '../setup'

type LoginRole = 'officerOrg1' | 'adminOrg1' | 'master' | 'bob'

export type AuthenticatedRouteProbe = {
  ready: boolean
  reason?: string
  resolvedUrl: string
}

async function getOfficerRouteGateDiagnostics(route: '/radio' | '/team-chat'): Promise<string> {
  if (!supabaseAdmin) return 'diag=service_role_unavailable'

  const officerEmail = getTestUser('officerOrg1').email
  const { data: officerProfile, error: officerProfileError } = await supabaseAdmin
    .from('user_profiles')
    .select('id, organization_id')
    .eq('email', officerEmail)
    .maybeSingle()

  if (officerProfileError) {
    const message = officerProfileError.message || 'unknown'
    return `diag=profile_lookup_error:${message}`
  }

  if (!officerProfile?.id || !officerProfile?.organization_id) {
    return 'diag=profile_missing_or_unscoped'
  }

  const { data: latestShift, error: latestShiftError } = await (supabaseAdmin.from('roster_shifts') as any)
    .select('service_type, status, officer_response, start_time, end_time')
    .eq('officer_id', officerProfile.id)
    .eq('organization_id', officerProfile.organization_id)
    .order('start_time', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latestShiftError) {
    const message = latestShiftError.message || 'unknown'
    return `diag=roster_lookup_error:${message}`
  }

  const nowIso = new Date().toISOString()
  const { data: activeShiftRows, error: activeShiftError } = await (supabaseAdmin.from('roster_shifts') as any)
    .select('id')
    .eq('officer_id', officerProfile.id)
    .eq('organization_id', officerProfile.organization_id)
    .lte('start_time', nowIso)
    .gte('end_time', nowIso)
    .limit(1)

  if (activeShiftError) {
    const message = activeShiftError.message || 'unknown'
    return `diag=active_window_lookup_error:${message}`
  }

  const routeExpectedService = route === '/radio' ? 'patrol' : 'patrol_or_noise'
  const hasActiveRosterWindow = !!activeShiftRows?.length
  const latestService = latestShift?.service_type || 'none'
  const latestStatus = latestShift?.status || 'none'
  const latestOfficerResponse = latestShift?.officer_response || 'none'

  return [
    'diag=ok',
    `expectedService=${routeExpectedService}`,
    `activeRosterWindow=${hasActiveRosterWindow ? 'yes' : 'no'}`,
    `latestService=${latestService}`,
    `latestStatus=${latestStatus}`,
    `latestOfficerResponse=${latestOfficerResponse}`,
  ].join(';')
}

export async function probeAuthenticatedRouteAccess(
  page: Page,
  role: LoginRole,
  route: '/radio' | '/team-chat',
  loginAs: (page: Page, role: LoginRole) => Promise<void>,
): Promise<AuthenticatedRouteProbe> {
  try {
    await loginAs(page, role)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    if (/ended on \/login|login failed|rate|throttle|over_request_rate_limit|too many requests|err_connection_refused/i.test(message)) {
      return {
        ready: false,
        reason: `Auth bootstrap is unavailable or rate-limited for ${role}: ${message}`,
        resolvedUrl: page.url(),
      }
    }
    throw error
  }

  await page.goto(route, { waitUntil: 'domcontentloaded' })

  if (page.url().includes('/login')) {
    try {
      await loginAs(page, role)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      if (/ended on \/login|login failed|rate|throttle|over_request_rate_limit|too many requests|err_connection_refused/i.test(message)) {
        return {
          ready: false,
          reason: `Auth bootstrap is unavailable or rate-limited for ${role}: ${message}`,
          resolvedUrl: page.url(),
        }
      }
      throw error
    }
    await page.goto(route, { waitUntil: 'domcontentloaded' })
  }

  const resolvedUrl = page.url()
  if (resolvedUrl.includes('/login')) {
    return {
      ready: false,
      reason: `Auth bootstrap is unavailable or rate-limited for ${role}`,
      resolvedUrl,
    }
  }

  if (/\/(officer-home|field-officer)(?:\?|$|\/)/.test(resolvedUrl)) {
    const diagnostics = role === 'officerOrg1' ? await getOfficerRouteGateDiagnostics(route) : 'diag=non_officer_role'
    return {
      ready: false,
      reason: `${route} is roster/site-permission gated for ${role} (${diagnostics})`,
      resolvedUrl,
    }
  }

  if (route === '/radio' && !/\/(radio|ptt-radio)(?:\?|$|\/)/.test(resolvedUrl)) {
    return {
      ready: false,
      reason: `PTT route did not resolve to radio surface for ${role} (resolved=${resolvedUrl})`,
      resolvedUrl,
    }
  }

  if (route === '/team-chat' && !/\/team-chat(?:\?|$|\/)/.test(resolvedUrl)) {
    return {
      ready: false,
      reason: `Team-chat route did not resolve for ${role} (resolved=${resolvedUrl})`,
      resolvedUrl,
    }
  }

  return { ready: true, resolvedUrl }
}

export type CommsSchemaProbe = {
  ready: boolean
  reason?: string
  dispatchJobsReady: boolean
}

export async function probeCommsSchemaCapabilities(): Promise<CommsSchemaProbe> {
  if (!supabaseAdmin) {
    return {
      ready: false,
      reason: 'SUPABASE_SERVICE_ROLE_KEY required for Phase B3 gate',
      dispatchJobsReady: false,
    }
  }

  const { error: radioCheckError } = await supabaseAdmin
    .from('radio_comms_events')
    .select('id')
    .limit(1)

  if (radioCheckError && (radioCheckError as any).code === 'PGRST205') {
    return {
      ready: false,
      reason: 'radio_comms_events table is not deployed in this environment',
      dispatchJobsReady: false,
    }
  }

  if (radioCheckError) {
    return {
      ready: false,
      reason: `radio_comms_events readiness probe failed: ${(radioCheckError as any).message || 'unknown error'}`,
      dispatchJobsReady: false,
    }
  }

  const { error: dispatchJobsCheckError } = await supabaseAdmin
    .from('dispatch_jobs')
    .select('id')
    .limit(1)

  const dispatchJobsReady = !dispatchJobsCheckError || (dispatchJobsCheckError as any).code !== 'PGRST205'

  return {
    ready: true,
    dispatchJobsReady,
  }
}