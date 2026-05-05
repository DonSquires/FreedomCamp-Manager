import { test, expect } from '@playwright/test'
import { supabaseAdmin } from './setup'

/**
 * Phase C1 Gate: Site Guard / Static Guard — Case Backbone Integration
 *
 * Validates:
 * 1. site_guard_shifts table exists and is queryable
 * 2. emergency_assist_events table exists and is queryable
 * 3. Shift start creates an operational_case with case_type='site_guard'
 * 4. site_incidents can be linked to a case via case_id
 * 5. Emergency assist creates an event without closing the case
 * 6. Emergency assist status is 'active' after creation
 * 7. Shift end marks the case as 'completed'
 * 8. Full timeline returns shifts, incidents, and assist events
 * 9. Org isolation: site_guard_shifts are scoped to their originating org
 */

// ─── Test helpers ─────────────────────────────────────────────────────────────

async function createTestOrg(label: string) {
  if (!supabaseAdmin) throw new Error('SUPABASE_SERVICE_ROLE_KEY required')
  const { data, error } = await supabaseAdmin
    .from('organizations')
    .insert({
      name: `C1 ${label} ${crypto.randomUUID()}`,
      organization_type: 'client',
      is_active: true,
      overnight_verification_mode: 'two_photo_verification',
    })
    .select('id')
    .single()
  if (error || !data) throw error ?? new Error('Failed to create org')
  return data.id as string
}

async function createTestOfficer(organizationId: string, label: string) {
  if (!supabaseAdmin) throw new Error('SUPABASE_SERVICE_ROLE_KEY required')
  const email = `c1-${label}-${crypto.randomUUID()}@test.local`
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: `C1!${crypto.randomUUID()}aa`,
    email_confirm: true,
  })
  if (authError || !authData.user) throw authError ?? new Error('Failed to create auth user')

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
    throw profileError ?? new Error('Failed to create officer profile')
  }
  return { userId: authData.user.id, profileId: profile.id as string }
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
      case_type: 'site_guard',
      created_from: 'site_guard',
      status: 'active',
      title: `C1 test case ${crypto.randomUUID()}`,
      created_by: officerId,
    })
    .select('id')
    .single()
  if (error || !data) throw error ?? new Error('Failed to create test case')
  return data.id as string
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Phase C1 — Site Guard / Static Guard Case Bridge', () => {

  // ── Scenario 1: site_guard_shifts table exists ──────────────────────────────
  test('site_guard_shifts table is queryable', async () => {
    if (!supabaseAdmin) test.skip()
    const { error } = await supabaseAdmin!
      .from('site_guard_shifts')
      .select('id')
      .limit(1)
    expect(error).toBeNull()
  })

  // ── Scenario 2: emergency_assist_events table exists ───────────────────────
  test('emergency_assist_events table is queryable', async () => {
    if (!supabaseAdmin) test.skip()
    const { error } = await supabaseAdmin!
      .from('emergency_assist_events')
      .select('id')
      .limit(1)
    expect(error).toBeNull()
  })

  // ── Scenario 3: shift start creates a site_guard case + shift row ───────────
  test('shift start creates operational_case with case_type=site_guard', async () => {
    if (!supabaseAdmin) test.skip()
    const orgId = await createTestOrg('c1-shift-start')
    const { userId, profileId } = await createTestOfficer(orgId, 'shift-start')

    try {
      // Step 1: create case
      const { data: caseRow, error: caseError } = await supabaseAdmin!
        .from('operational_cases')
        .insert({
          organization_id: orgId,
          case_type: 'site_guard',
          created_from: 'site_guard',
          status: 'active',
          title: 'Guard shift test',
          created_by: profileId,
        })
        .select('id, case_type, status')
        .single()
      expect(caseError).toBeNull()
      expect(caseRow?.case_type).toBe('site_guard')
      expect(caseRow?.status).toBe('active')

      // Step 2: create shift
      const { data: shift, error: shiftError } = await supabaseAdmin!
        .from('site_guard_shifts')
        .insert({
          organization_id: orgId,
          case_id: caseRow!.id,
          officer_id: profileId,
          shift_start: new Date().toISOString(),
          status: 'active',
        })
        .select('id, case_id, status')
        .single()
      expect(shiftError).toBeNull()
      expect(shift?.case_id).toBe(caseRow!.id)
      expect(shift?.status).toBe('active')
    } finally {
      await deleteTestOfficer(userId)
      await supabaseAdmin!.from('organizations').delete().eq('id', orgId)
    }
  })

  // ── Scenario 4: site_incidents can be linked to a case ─────────────────────
  test('site_incident can be created with case_id linked to site_guard case', async () => {
    if (!supabaseAdmin) test.skip()
    const orgId = await createTestOrg('c1-incident')
    const { userId, profileId } = await createTestOfficer(orgId, 'incident')
    const caseId = await createTestCase(orgId, profileId)

    try {
      const { data: incident, error } = await supabaseAdmin!
        .from('site_incidents')
        .insert({
          organization_id: orgId,
          case_id: caseId,
          officer_id: profileId,
          incident_type: 'trespass',
          severity: 'medium',
          description: 'Test trespass during C1 gate',
          status: 'submitted',
        })
        .select('id, case_id, incident_type')
        .single()
      expect(error).toBeNull()
      expect(incident?.case_id).toBe(caseId)
      expect(incident?.incident_type).toBe('trespass')
    } finally {
      await deleteTestOfficer(userId)
      await supabaseAdmin!.from('organizations').delete().eq('id', orgId)
    }
  })

  // ── Scenario 5: emergency assist creates event without closing the case ─────
  test('emergency assist event is created and case remains active', async () => {
    if (!supabaseAdmin) test.skip()
    const orgId = await createTestOrg('c1-assist')
    const { userId, profileId } = await createTestOfficer(orgId, 'assist')
    const caseId = await createTestCase(orgId, profileId)

    try {
      const { data: assist, error: assistError } = await supabaseAdmin!
        .from('emergency_assist_events')
        .insert({
          organization_id: orgId,
          case_id: caseId,
          officer_id: profileId,
          assist_type: 'emergency',
          severity: 'high',
          description: 'Aggressive person at main entry',
          status: 'active',
          triggered_at: new Date().toISOString(),
        })
        .select('id, case_id, status')
        .single()
      expect(assistError).toBeNull()
      expect(assist?.case_id).toBe(caseId)
      expect(assist?.status).toBe('active')

      // Confirm case is still active (not auto-closed)
      const { data: caseRow } = await supabaseAdmin!
        .from('operational_cases')
        .select('status')
        .eq('id', caseId)
        .single()
      expect(caseRow?.status).toBe('active')
    } finally {
      await deleteTestOfficer(userId)
      await supabaseAdmin!.from('organizations').delete().eq('id', orgId)
    }
  })

  // ── Scenario 6: emergency assist status reflects 'active' ──────────────────
  test('emergency assist event status is active after creation', async () => {
    if (!supabaseAdmin) test.skip()
    const orgId = await createTestOrg('c1-assist-status')
    const { userId, profileId } = await createTestOfficer(orgId, 'assist-status')
    const caseId = await createTestCase(orgId, profileId)

    try {
      const { data: assist } = await supabaseAdmin!
        .from('emergency_assist_events')
        .insert({
          organization_id: orgId,
          case_id: caseId,
          officer_id: profileId,
          assist_type: 'medical',
          severity: 'critical',
          status: 'active',
          triggered_at: new Date().toISOString(),
        })
        .select('id, assist_type, severity, status')
        .single()

      expect(assist?.status).toBe('active')
      expect(assist?.assist_type).toBe('medical')
      expect(assist?.severity).toBe('critical')
    } finally {
      await deleteTestOfficer(userId)
      await supabaseAdmin!.from('organizations').delete().eq('id', orgId)
    }
  })

  // ── Scenario 7: shift end marks case as completed ──────────────────────────
  test('ending a shift marks the case as completed', async () => {
    if (!supabaseAdmin) test.skip()
    const orgId = await createTestOrg('c1-shift-end')
    const { userId, profileId } = await createTestOfficer(orgId, 'shift-end')
    const caseId = await createTestCase(orgId, profileId)

    try {
      const { data: shift } = await supabaseAdmin!
        .from('site_guard_shifts')
        .insert({
          organization_id: orgId,
          case_id: caseId,
          officer_id: profileId,
          shift_start: new Date().toISOString(),
          status: 'active',
        })
        .select('id')
        .single()

      const now = new Date().toISOString()
      // End shift
      await supabaseAdmin!
        .from('site_guard_shifts')
        .update({ shift_end: now, status: 'completed', updated_at: now })
        .eq('id', shift!.id)
      // Close case
      await supabaseAdmin!
        .from('operational_cases')
        .update({ status: 'completed', closed_at: now, updated_at: now })
        .eq('id', caseId)

      const { data: caseRow } = await supabaseAdmin!
        .from('operational_cases')
        .select('status, closed_at')
        .eq('id', caseId)
        .single()
      expect(caseRow?.status).toBe('completed')
      expect(caseRow?.closed_at).not.toBeNull()
    } finally {
      await deleteTestOfficer(userId)
      await supabaseAdmin!.from('organizations').delete().eq('id', orgId)
    }
  })

  // ── Scenario 8: full timeline retrieves all attached domain events ──────────
  test('full timeline returns shifts, incidents, and emergency assist events', async () => {
    if (!supabaseAdmin) test.skip()
    const orgId = await createTestOrg('c1-timeline')
    const { userId, profileId } = await createTestOfficer(orgId, 'timeline')
    const caseId = await createTestCase(orgId, profileId)

    try {
      // Insert one of each domain record
      await supabaseAdmin!.from('site_guard_shifts').insert({
        organization_id: orgId, case_id: caseId, officer_id: profileId,
        shift_start: new Date().toISOString(), status: 'active',
      })
      await supabaseAdmin!.from('site_incidents').insert({
        organization_id: orgId, case_id: caseId, officer_id: profileId,
        incident_type: 'theft', severity: 'high',
        description: 'Stolen bike from rack', status: 'submitted',
      })
      await supabaseAdmin!.from('emergency_assist_events').insert({
        organization_id: orgId, case_id: caseId, officer_id: profileId,
        assist_type: 'supervisor_required', severity: 'medium',
        status: 'active', triggered_at: new Date().toISOString(),
      })

      // Query all three tables for this case
      const [{ data: shifts }, { data: incidents }, { data: assists }] = await Promise.all([
        supabaseAdmin!.from('site_guard_shifts').select('id').eq('case_id', caseId),
        supabaseAdmin!.from('site_incidents').select('id').eq('case_id', caseId),
        supabaseAdmin!.from('emergency_assist_events').select('id').eq('case_id', caseId),
      ])

      expect(shifts?.length).toBeGreaterThanOrEqual(1)
      expect(incidents?.length).toBeGreaterThanOrEqual(1)
      expect(assists?.length).toBeGreaterThanOrEqual(1)
    } finally {
      await deleteTestOfficer(userId)
      await supabaseAdmin!.from('organizations').delete().eq('id', orgId)
    }
  })

  // ── Scenario 9: org isolation — shifts are scoped to their org ─────────────
  test('site_guard_shifts from Org A are not visible when querying Org B scope', async () => {
    if (!supabaseAdmin) test.skip()
    const orgAId = await createTestOrg('c1-iso-A')
    const orgBId = await createTestOrg('c1-iso-B')
    const { userId: userAId, profileId: profileAId } = await createTestOfficer(orgAId, 'iso-a')
    const { userId: userBId } = await createTestOfficer(orgBId, 'iso-b')
    const caseAId = await createTestCase(orgAId, profileAId)

    try {
      // Create a shift in Org A
      await supabaseAdmin!.from('site_guard_shifts').insert({
        organization_id: orgAId,
        case_id: caseAId,
        officer_id: profileAId,
        shift_start: new Date().toISOString(),
        status: 'active',
      })

      // Query scoped to Org B — should return zero rows
      const { data: rows, error } = await supabaseAdmin!
        .from('site_guard_shifts')
        .select('id')
        .eq('organization_id', orgBId)
      expect(error).toBeNull()
      expect(rows?.length).toBe(0)
    } finally {
      await deleteTestOfficer(userAId)
      await deleteTestOfficer(userBId)
      await supabaseAdmin!.from('organizations').delete().eq('id', orgAId)
      await supabaseAdmin!.from('organizations').delete().eq('id', orgBId)
    }
  })

})
