import { getTestUser } from '../auth'
import { supabaseAdmin } from '../setup'

export type OfficerRosterSeedResult = {
  ready: boolean
  reason?: string
  seeded: boolean
}

type ServiceType = 'patrol' | 'noise'

export async function ensureOfficerRosterSeed(serviceType: ServiceType = 'patrol'): Promise<OfficerRosterSeedResult> {
  if (!supabaseAdmin) {
    return {
      ready: false,
      seeded: false,
      reason: 'SUPABASE_SERVICE_ROLE_KEY unavailable for officer roster pre-seed',
    }
  }

  const officerEmail = getTestUser('officerOrg1').email
  const { data: officerProfile, error: officerProfileError } = await supabaseAdmin
    .from('user_profiles')
    .select('id, organization_id')
    .eq('email', officerEmail)
    .maybeSingle()

  if (officerProfileError || !officerProfile?.id || !officerProfile?.organization_id) {
    return {
      ready: false,
      seeded: false,
      reason: 'Officer profile lookup failed for roster pre-seed',
    }
  }

  const now = new Date()
  const from = new Date(now.getTime() - 30 * 60 * 1000).toISOString()
  const to = new Date(now.getTime() + 10 * 60 * 60 * 1000).toISOString()

  const { data: existing, error: existingError } = await (supabaseAdmin.from('roster_shifts') as any)
    .select('id')
    .eq('officer_id', officerProfile.id)
    .eq('organization_id', officerProfile.organization_id)
    .eq('service_type', serviceType)
    .gte('end_time', from)
    .lte('start_time', to)
    .limit(1)

  if (existingError) {
    return {
      ready: false,
      seeded: false,
      reason: `Roster pre-seed lookup failed: ${existingError.message || 'unknown error'}`,
    }
  }

  if (existing?.length) {
    return { ready: true, seeded: false }
  }

  const start = new Date(now.getTime() + 2 * 60 * 1000)
  const end = new Date(now.getTime() + 8 * 60 * 60 * 1000)

  const { error: insertError } = await (supabaseAdmin.from('roster_shifts') as any).insert({
    organization_id: officerProfile.organization_id,
    officer_id: officerProfile.id,
    shift_date: start.toISOString().slice(0, 10),
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    shift_type: 'custom',
    service_type: serviceType,
    status: 'published',
    officer_response: 'accepted',
    confirmed_at: new Date().toISOString(),
    notes: `Playwright pre-seed for ${serviceType} route capability`,
  })

  if (insertError) {
    return {
      ready: false,
      seeded: false,
      reason: `Roster pre-seed insert failed: ${insertError.message || 'unknown error'}`,
    }
  }

  return { ready: true, seeded: true }
}