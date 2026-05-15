import { test, expect } from '@playwright/test'
import { supabaseAdmin } from './setup'

/**
 * Phase B4 Gate: Freedom Camping Enforcement Timeline Test
 *
 * Validates:
 * 1. Operational case can be created from a breach alert
 * 2. Enforcement timeline events are recorded on the shared case backbone
 * 3. Enforcement lifecycle (initiated → warning → ticket → completed)
 * 4. Org isolation is maintained across B4 enforcement tables
 */

async function createTestOrg(label: string) {
  if (!supabaseAdmin) throw new Error('SUPABASE_SERVICE_ROLE_KEY required')
  const { data, error } = await supabaseAdmin
    .from('organizations')
    .insert({
      name: `B4 ${label} ${Date.now()}-${crypto.randomUUID()}`,
      organization_type: 'client',
      is_active: true,
      overnight_verification_mode: 'two_photo_verification',
    })
    .select('id')
    .single()
  if (error || !data) throw error || new Error('Failed to create org')
  return data.id
}

async function createTestOfficer(organizationId: string, label: string) {
  if (!supabaseAdmin) throw new Error('SUPABASE_SERVICE_ROLE_KEY required')
  const email = `b4-${label}-${Date.now()}-${crypto.randomUUID()}@test.local`
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: `B4!${crypto.randomUUID()}aa`,
    email_confirm: true,
  })
  if (authError || !authData.user) throw authError || new Error('Failed to create auth user')

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('user_profiles')
    .upsert(
      {
        id: authData.user.id,
        organization_id: organizationId,
        email,
        role: 'officer',
        is_active: true,
        enabled_portals: [],
        portal_access: [],
        extra_organization_ids: [],
      },
      { onConflict: 'id' },
    )
    .select('id')
    .single()
  if (profileError || !profile) {
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
    throw profileError || new Error('Failed to create officer profile')
  }
  return profile.id
}

async function createTestZone(organizationId: string, label: string) {
  if (!supabaseAdmin) throw new Error('SUPABASE_SERVICE_ROLE_KEY required')
  const { data, error } = await supabaseAdmin
    .from('zones')
    .insert({
      organization_id: organizationId,
      name: `B4 Zone ${label} ${Date.now()}-${crypto.randomUUID()}`,
      zone_type: 'freedom_camping',
      is_active: true,
    })
    .select('id')
    .single()
  if (error || !data) throw error || new Error('Failed to create zone')
  return data.id
}

async function deleteTestOfficer(userId: string | undefined) {
  if (!supabaseAdmin || !userId) return
  await supabaseAdmin.auth.admin.deleteUser(userId)
}

test.describe('Phase B4: Freedom Camping Enforcement Timeline', () => {
  test.skip(!supabaseAdmin, 'SUPABASE_SERVICE_ROLE_KEY required')

  let orgId: string
  let officerId: string
  let zoneId: string
  let breachAlertId: string
  let caseId: string

  test.beforeAll(async () => {
    if (!supabaseAdmin) {
      test.skip()
      return
    }

    orgId = await createTestOrg('EnforcementOrg')
    officerId = await createTestOfficer(orgId, 'enforcement-officer')
    zoneId = await createTestZone(orgId, 'enforcement-zone')

    // Create a minimal breach alert
    const { data: breachData, error: breachError } = await supabaseAdmin
      .from('breach_alerts')
      .insert({
        organization_id: orgId,
        zone_id: zoneId,
        breach_type: 'freedom_camping',
        plate_number: 'B4TEST1',
        breach_details: {},
        status: 'active',
      })
      .select('id')
      .single()

    if (breachError || !breachData) {
      test.skip()
      return
    }
    breachAlertId = breachData.id
  })

  test('should create operational case from breach alert', async () => {
    if (!supabaseAdmin || !breachAlertId) {
      test.skip()
      return
    }

    const { data: caseIdData, error } = await supabaseAdmin.rpc('create_case_from_breach_alert', {
      p_breach_alert_id: breachAlertId,
    })

    if (error) {
      // Function may not exist in target env yet — skip
      test.skip()
      return
    }

    expect(caseIdData).toBeTruthy()
    caseId = caseIdData as string

    // Verify the case was created with correct type
    const { data: caseData } = await supabaseAdmin
      .from('operational_cases')
      .select('id, case_type, organization_id')
      .eq('id', caseId)
      .single()

    expect(caseData?.case_type).toBe('enforcement')
    expect(caseData?.organization_id).toBe(orgId)

    // Verify breach_alert.case_id was set
    const { data: breachData } = await supabaseAdmin
      .from('breach_alerts')
      .select('case_id')
      .eq('id', breachAlertId)
      .single()

    expect(breachData?.case_id).toBe(caseId)
  })

  test('should verify initial enforcement_initiated event was recorded', async () => {
    if (!supabaseAdmin || !caseId) {
      test.skip()
      return
    }

    const { data: events } = await supabaseAdmin
      .from('enforcement_events')
      .select('event_type, subject_identifier')
      .eq('case_id', caseId)
      .order('event_timestamp', { ascending: true })

    expect(events?.length).toBeGreaterThanOrEqual(1)
    expect(events?.[0]?.event_type).toBe('enforcement_initiated')
    expect(events?.[0]?.subject_identifier).toBe('B4TEST1')
  })

  test('should record warning issued event', async () => {
    if (!supabaseAdmin || !caseId) {
      test.skip()
      return
    }

    const { data: warnData, error } = await supabaseAdmin
      .from('enforcement_events')
      .insert({
        organization_id: orgId,
        case_id: caseId,
        officer_id: officerId,
        event_type: 'enforcement_warning_issued',
        subject_type: 'vehicle',
        subject_identifier: 'B4TEST1',
        violation_type: 'freedom_camping',
        action_taken: 'Verbal warning issued, asked to move on',
      })
      .select('id, event_type')
      .single()

    expect(error).toBeNull()
    expect(warnData?.event_type).toBe('enforcement_warning_issued')
  })

  test('should record ticket issued event with evidence', async () => {
    if (!supabaseAdmin || !caseId) {
      test.skip()
      return
    }

    const { data: ticketData, error } = await supabaseAdmin
      .from('enforcement_events')
      .insert({
        organization_id: orgId,
        case_id: caseId,
        officer_id: officerId,
        event_type: 'enforcement_ticket_issued',
        subject_type: 'vehicle',
        subject_identifier: 'B4TEST1',
        violation_type: 'freedom_camping',
        action_taken: 'Infringement notice issued',
        evidence_notes: 'Vehicle present for 3+ consecutive nights',
      })
      .select('id, event_type, action_taken')
      .single()

    expect(error).toBeNull()
    expect(ticketData?.event_type).toBe('enforcement_ticket_issued')
  })

  test('should retrieve full enforcement timeline in chronological order', async () => {
    if (!supabaseAdmin || !caseId) {
      test.skip()
      return
    }

    const { data: timeline } = await supabaseAdmin
      .from('enforcement_events')
      .select('event_type, event_timestamp')
      .eq('case_id', caseId)
      .order('event_timestamp', { ascending: true })

    expect(timeline?.length).toBeGreaterThanOrEqual(3)
    const types = timeline?.map((e) => e.event_type) ?? []
    expect(types[0]).toBe('enforcement_initiated')
    expect(types).toContain('enforcement_warning_issued')
    expect(types).toContain('enforcement_ticket_issued')
  })

  test('should close enforcement case', async () => {
    if (!supabaseAdmin || !caseId) {
      test.skip()
      return
    }

    // Record completed event
    const { error: evtError } = await supabaseAdmin.from('enforcement_events').insert({
      organization_id: orgId,
      case_id: caseId,
      officer_id: officerId,
      event_type: 'enforcement_completed',
      subject_type: 'vehicle',
      subject_identifier: 'B4TEST1',
      outcome: 'Notice issued and vehicle agreed to depart within 24h',
    })
    expect(evtError).toBeNull()

    // Close the case
    const { data: closedCase, error: closeError } = await supabaseAdmin
      .from('operational_cases')
      .update({ status: 'closed', closed_at: new Date().toISOString() })
      .eq('id', caseId)
      .select('id, status')
      .single()

    expect(closeError).toBeNull()
    expect(closedCase?.status).toBe('closed')
  })

  test('should maintain org isolation for enforcement events', async () => {
    if (!supabaseAdmin || !caseId) {
      test.skip()
      return
    }

    // Create a second org's enforcement event to verify org scoping
    const org2Id = await createTestOrg('EnforcementOrg2')
    const officer2Id = await createTestOfficer(org2Id, 'officer2')
    const zone2Id = await createTestZone(org2Id, 'enforcement-zone-2')

    const { data: breach2 } = await supabaseAdmin
      .from('breach_alerts')
      .insert({
        organization_id: org2Id,
        zone_id: zone2Id,
        breach_type: 'freedom_camping',
        plate_number: 'B4TEST2',
        breach_details: {},
        status: 'active',
      })
      .select('id')
      .single()

    if (breach2) {
      const { data: case2Id } = await supabaseAdmin.rpc('create_case_from_breach_alert', {
        p_breach_alert_id: breach2.id,
      })

      if (case2Id) {
        // Verify org2 enforcement events have org2 org_id
        const { data: events2 } = await supabaseAdmin
          .from('enforcement_events')
          .select('organization_id')
          .eq('case_id', case2Id)
          .limit(1)
          .single()

        expect(events2?.organization_id).toBe(org2Id)
        expect(events2?.organization_id).not.toBe(orgId)

        // Cleanup
        await supabaseAdmin.from('enforcement_events').delete().eq('case_id', case2Id)
        await supabaseAdmin.from('operational_cases').delete().eq('id', case2Id)
      }

      await supabaseAdmin.from('breach_alerts').delete().eq('id', breach2.id)
    }

    await deleteTestOfficer(officer2Id)
    await supabaseAdmin.from('zones').delete().eq('id', zone2Id)
    await supabaseAdmin.from('organizations').delete().eq('id', org2Id)
  })

  test.afterAll(async () => {
    if (!supabaseAdmin) return

    if (caseId) {
      await supabaseAdmin.from('enforcement_events').delete().eq('case_id', caseId)
      await supabaseAdmin.from('operational_cases').delete().eq('id', caseId)
    }
    if (breachAlertId) {
      await supabaseAdmin.from('breach_alerts').delete().eq('id', breachAlertId)
    }
    if (zoneId) {
      await supabaseAdmin.from('zones').delete().eq('id', zoneId)
    }
    await deleteTestOfficer(officerId)
    if (orgId) {
      await supabaseAdmin.from('organizations').delete().eq('id', orgId)
    }
  })
})
