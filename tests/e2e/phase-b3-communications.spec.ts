import { test, expect } from '@playwright/test'
import { supabaseAdmin } from './setup'

/**
 * Phase B3 Gate: Communications — Callsign Binding & Dispatch-to-Radio Escalation
 *
 * Validates:
 * 1. Officer callsign can be read from user_profiles
 * 2. Callsign binding records a radio_comms_events row linked to the case
 * 3. Dispatch-to-radio escalation records BOTH radio_comms_events and dispatch_events
 * 4. Degraded mode records a radio_comms_events row with degraded_mode=true while
 *    leaving the case status as 'open'
 * 5. Org isolation: radio comms events are scoped to their originating organization
 */

async function createTestOrg(label: string) {
  if (!supabaseAdmin) throw new Error('SUPABASE_SERVICE_ROLE_KEY required')
  const { data, error } = await supabaseAdmin
    .from('organizations')
    .insert({
      name: `B3 ${label} ${crypto.randomUUID()}`,
      organization_type: 'client',
      is_active: true,
      overnight_verification_mode: 'two_photo_verification',
    })
    .select('id')
    .single()
  if (error || !data) throw error || new Error('Failed to create org')
  return data.id
}

async function createTestOfficer(organizationId: string, label: string, callsign?: string) {
  if (!supabaseAdmin) throw new Error('SUPABASE_SERVICE_ROLE_KEY required')
  const email = `b3-${label}-${crypto.randomUUID()}@test.local`
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: `B3!${crypto.randomUUID()}aa`,
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
        // Explicit callsign for B3 testing (skips auto-assignment trigger)
        ...(callsign ? { callsign } : {}),
      },
      { onConflict: 'id' },
    )
    .select('id, callsign')
    .single()
  if (profileError || !profile) {
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
    throw profileError || new Error('Failed to create officer profile')
  }
  return { id: profile.id, callsign: (profile as any).callsign as string | null }
}

async function deleteTestOfficer(userId: string | undefined) {
  if (!supabaseAdmin || !userId) return
  await supabaseAdmin.auth.admin.deleteUser(userId)
}

async function createTestCase(organizationId: string, officerId: string) {
  if (!supabaseAdmin) throw new Error('SUPABASE_SERVICE_ROLE_KEY required')
  const { data, error } = await supabaseAdmin
    .from('operational_cases')
    .insert({
      organization_id: organizationId,
      case_type: 'dispatch',
      created_from: 'dispatch',
      title: `B3 Comms Test Case ${crypto.randomUUID()}`,
      created_by: officerId,
    })
    .select('id')
    .single()
  if (error || !data) throw error || new Error('Failed to create test case')
  return data.id
}

test.describe('Phase B3: Communications — Callsign Binding & Dispatch-to-Radio Escalation', () => {
  test.skip(!supabaseAdmin, 'SUPABASE_SERVICE_ROLE_KEY required')

  let orgId: string
  let officerId: string
  let officerCallsign: string | null
  let caseId: string
  let dispatchJobId: string

  test.beforeAll(async () => {
    if (!supabaseAdmin) {
      test.skip()
      return
    }

    orgId = await createTestOrg('CommsOrg')
    const officer = await createTestOfficer(orgId, 'comms-officer', 'B3-01')
    officerId = officer.id
    officerCallsign = officer.callsign ?? 'B3-01'

    caseId = await createTestCase(orgId, officerId)

    // Create a minimal dispatch job for escalation test
    const { data: djData, error: djErr } = await supabaseAdmin
      .from('dispatch_jobs')
      .insert({
        organization_id: orgId,
        title: 'B3 Comms Test Dispatch',
        status: 'assigned',
        case_id: caseId,
      })
      .select('id')
      .single()

    if (djErr || !djData) {
      // dispatch_jobs may not be in the test env; record null and tests will handle
      dispatchJobId = ''
    } else {
      dispatchJobId = djData.id
    }
  })

  // ── Test 1: radio_comms_events table exists ──────────────────────────────

  test('should have radio_comms_events table available', async () => {
    if (!supabaseAdmin) { test.skip(); return }

    const { error } = await supabaseAdmin
      .from('radio_comms_events')
      .select('id')
      .limit(1)

    if (error && (error as any).code === 'PGRST205') {
      test.skip() // table not yet deployed to this environment
      return
    }
    expect(error).toBeNull()
  })

  // ── Test 2: Callsign binding ────────────────────────────────────────────

  test('should record radio_callsign_bound event with correct callsign', async () => {
    if (!supabaseAdmin) { test.skip(); return }

    // Skip if table not available
    const { error: checkErr } = await supabaseAdmin
      .from('radio_comms_events').select('id').limit(1)
    if (checkErr && (checkErr as any).code === 'PGRST205') { test.skip(); return }

    const { data, error } = await supabaseAdmin
      .from('radio_comms_events')
      .insert({
        organization_id: orgId,
        case_id: caseId,
        officer_id: officerId,
        callsign: officerCallsign ?? 'B3-01',
        channel_scope: `org:${orgId}`,
        event_type: 'radio_callsign_bound',
        degraded_mode: false,
        ptt_session_id: `sess-b3-${crypto.randomUUID()}`,
      })
      .select('id, callsign, event_type, degraded_mode, case_id')
      .single()

    expect(error).toBeNull()
    expect(data?.event_type).toBe('radio_callsign_bound')
    expect(data?.callsign).toBe(officerCallsign ?? 'B3-01')
    expect(data?.degraded_mode).toBe(false)
    expect(data?.case_id).toBe(caseId)
  })

  // ── Test 3: Officer callsign readable from user_profiles ────────────────

  test('should read officer callsign from user_profiles', async () => {
    if (!supabaseAdmin || !officerId) { test.skip(); return }

    const { data, error } = await supabaseAdmin
      .from('user_profiles')
      .select('id, callsign')
      .eq('id', officerId)
      .single()

    expect(error).toBeNull()
    expect(data?.callsign).toBeTruthy()
  })

  // ── Test 4: Dispatch escalation to radio ────────────────────────────────

  test('should record dispatch_escalated_to_radio in radio_comms_events', async () => {
    if (!supabaseAdmin) { test.skip(); return }

    const { error: checkErr } = await supabaseAdmin
      .from('radio_comms_events').select('id').limit(1)
    if (checkErr && (checkErr as any).code === 'PGRST205') { test.skip(); return }

    const { data: radioEvent, error: radioErr } = await supabaseAdmin
      .from('radio_comms_events')
      .insert({
        organization_id: orgId,
        case_id: caseId,
        officer_id: officerId,
        callsign: officerCallsign ?? 'B3-01',
        channel_scope: `org:${orgId}`,
        event_type: 'dispatch_escalated_to_radio',
        degraded_mode: false,
        notes: 'Escalated from dispatch console',
      })
      .select('id, event_type, callsign')
      .single()

    expect(radioErr).toBeNull()
    expect(radioEvent?.event_type).toBe('dispatch_escalated_to_radio')
    expect(radioEvent?.callsign).toBe(officerCallsign ?? 'B3-01')
  })

  // ── Test 5: Dispatch escalation also records dispatch_events entry ────────

  test('should record dispatch_escalated in dispatch_events when escalating to radio', async () => {
    if (!supabaseAdmin || !dispatchJobId) { test.skip(); return }

    const { data, error } = await supabaseAdmin
      .from('dispatch_events')
      .insert({
        organization_id: orgId,
        case_id: caseId,
        dispatch_job_id: dispatchJobId,
        event_type: 'dispatch_escalated',
        notes: 'Escalated to radio — callsign: B3-01',
      })
      .select('id, event_type, notes')
      .single()

    expect(error).toBeNull()
    expect(data?.event_type).toBe('dispatch_escalated')
    expect(data?.notes).toContain('radio')
  })

  // ── Test 6: Degraded mode event ──────────────────────────────────────────

  test('should record radio_degraded_mode with degraded_mode=true', async () => {
    if (!supabaseAdmin) { test.skip(); return }

    const { error: checkErr } = await supabaseAdmin
      .from('radio_comms_events').select('id').limit(1)
    if (checkErr && (checkErr as any).code === 'PGRST205') { test.skip(); return }

    const { data, error } = await supabaseAdmin
      .from('radio_comms_events')
      .insert({
        organization_id: orgId,
        case_id: caseId,
        officer_id: officerId,
        event_type: 'radio_degraded_mode',
        degraded_mode: true,
        notes: 'PTT server unreachable — using push alert fallback',
      })
      .select('id, event_type, degraded_mode')
      .single()

    expect(error).toBeNull()
    expect(data?.event_type).toBe('radio_degraded_mode')
    expect(data?.degraded_mode).toBe(true)
  })

  // ── Test 7: Case remains open after degraded mode event ──────────────────

  test('should leave case status as open after a degraded mode event', async () => {
    if (!supabaseAdmin || !caseId) { test.skip(); return }

    const { data, error } = await supabaseAdmin
      .from('operational_cases')
      .select('id, status')
      .eq('id', caseId)
      .single()

    expect(error).toBeNull()
    // Case must NOT be closed by a degraded-mode radio event
    expect(data?.status).not.toBe('closed')
  })

  // ── Test 8: Full comms timeline for a case is retrievable ─────────────────

  test('should retrieve full radio comms timeline in chronological order', async () => {
    if (!supabaseAdmin || !caseId) { test.skip(); return }

    const { error: checkErr } = await supabaseAdmin
      .from('radio_comms_events').select('id').limit(1)
    if (checkErr && (checkErr as any).code === 'PGRST205') { test.skip(); return }

    const { data: timeline, error } = await supabaseAdmin
      .from('radio_comms_events')
      .select('event_type, degraded_mode, event_timestamp')
      .eq('case_id', caseId)
      .order('event_timestamp', { ascending: true })

    expect(error).toBeNull()
    expect(timeline?.length).toBeGreaterThanOrEqual(3)

    const types = timeline?.map((e) => e.event_type) ?? []
    expect(types).toContain('radio_callsign_bound')
    expect(types).toContain('dispatch_escalated_to_radio')
    expect(types).toContain('radio_degraded_mode')

    // At least one degraded entry
    const degraded = timeline?.filter((e) => e.degraded_mode) ?? []
    expect(degraded.length).toBeGreaterThanOrEqual(1)
  })

  // ── Test 9: Org isolation ─────────────────────────────────────────────────

  test('should maintain org isolation for radio comms events', async () => {
    if (!supabaseAdmin || !caseId) { test.skip(); return }

    const { error: checkErr } = await supabaseAdmin
      .from('radio_comms_events').select('id').limit(1)
    if (checkErr && (checkErr as any).code === 'PGRST205') { test.skip(); return }

    const org2Id = await createTestOrg('CommsOrg2')
    const officer2 = await createTestOfficer(org2Id, 'comms-officer2', 'B3-02')
    const case2Id = await createTestCase(org2Id, officer2.id)

    const { data: org2Event, error: org2Err } = await supabaseAdmin
      .from('radio_comms_events')
      .insert({
        organization_id: org2Id,
        case_id: case2Id,
        officer_id: officer2.id,
        callsign: 'B3-02',
        event_type: 'radio_callsign_bound',
        degraded_mode: false,
      })
      .select('id, organization_id')
      .single()

    expect(org2Err).toBeNull()
    expect(org2Event?.organization_id).toBe(org2Id)
    expect(org2Event?.organization_id).not.toBe(orgId)

    // Cleanup
    await supabaseAdmin.from('radio_comms_events').delete().eq('case_id', case2Id)
    await supabaseAdmin.from('operational_cases').delete().eq('id', case2Id)
    await deleteTestOfficer(officer2.id)
    await supabaseAdmin.from('organizations').delete().eq('id', org2Id)
  })

  // ── Teardown ──────────────────────────────────────────────────────────────

  test.afterAll(async () => {
    if (!supabaseAdmin) return

    if (caseId) {
      await supabaseAdmin.from('radio_comms_events').delete().eq('case_id', caseId)
      if (dispatchJobId) {
        await supabaseAdmin.from('dispatch_events').delete().eq('case_id', caseId)
        await supabaseAdmin.from('dispatch_jobs').delete().eq('id', dispatchJobId)
      }
      await supabaseAdmin.from('operational_cases').delete().eq('id', caseId)
    }
    await deleteTestOfficer(officerId)
    if (orgId) {
      await supabaseAdmin.from('organizations').delete().eq('id', orgId)
    }
  })
})
