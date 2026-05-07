import { test, expect } from '@playwright/test'
import { supabaseAdmin } from './setup'

async function createOrg(label: string) {
  if (!supabaseAdmin) throw new Error('SUPABASE_SERVICE_ROLE_KEY required')
  const { data, error } = await supabaseAdmin
    .from('organizations')
    .insert({
      name: `D1 ${label} ${crypto.randomUUID()}`,
      organization_type: 'client',
      is_active: true,
      overnight_verification_mode: 'two_photo_verification',
    })
    .select('id')
    .single()
  if (error || !data) throw error ?? new Error('org')
  return data.id as string
}

async function createUserProfile(orgId: string, label: string, role: 'officer' | 'admin' | 'master' = 'officer') {
  if (!supabaseAdmin) throw new Error('SUPABASE_SERVICE_ROLE_KEY required')
  const email = `d1-${label}-${crypto.randomUUID()}@test.local`
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: `D1!${crypto.randomUUID()}aa`,
    email_confirm: true,
  })
  if (authError || !authData.user) throw authError ?? new Error('auth')

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('user_profiles')
    .upsert({
      id: authData.user.id,
      organization_id: orgId,
      email,
      role,
      is_active: true,
      enabled_portals: [],
      portal_access: [],
      extra_organization_ids: [],
    }, { onConflict: 'id' })
    .select('id')
    .single()

  if (profileError || !profile) {
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
    throw profileError ?? new Error('profile')
  }

  return { userId: authData.user.id, profileId: profile.id as string }
}

async function deleteUser(userId?: string) {
  if (supabaseAdmin && userId) await supabaseAdmin.auth.admin.deleteUser(userId)
}

async function createCase(orgId: string, officerId: string) {
  if (!supabaseAdmin) throw new Error('SUPABASE_SERVICE_ROLE_KEY required')
  const { data, error } = await supabaseAdmin
    .from('operational_cases')
    .insert({
      organization_id: orgId,
      case_type: 'patrol',
      created_from: 'patrol',
      status: 'active',
      title: `D1 case ${crypto.randomUUID()}`,
      created_by: officerId,
    })
    .select('id')
    .single()
  if (error || !data) throw error ?? new Error('case')
  return data.id as string
}

async function createProposal(orgId: string, requestedBy: string, caseId?: string, approvalDueAt?: string) {
  if (!supabaseAdmin) throw new Error('SUPABASE_SERVICE_ROLE_KEY required')
  const { data, error } = await supabaseAdmin
    .from('bob_action_proposals')
    .insert({
      organization_id: orgId,
      requested_by: requestedBy,
      case_id: caseId ?? null,
      proposal_type: 'create_live_plan',
      title: `Proposal ${crypto.randomUUID()}`,
      proposal_payload: { generated_by: 'playwright' },
      impact_level: 'medium',
      source_context_refs: ['bob-studio', 'phase-d1-test'],
      approval_due_at: approvalDueAt ?? new Date(Date.now() + 30_000).toISOString(),
    })
    .select('*')
    .single()
  if (error || !data) throw error ?? new Error('proposal')
  return data as { id: string; case_id: string | null; organization_id: string }
}

test.describe('Phase D1 — Bob approval / proposal / audit contracts', () => {
  test('bob_action_proposals table is queryable', async () => {
    if (!supabaseAdmin) test.skip()
    const { error } = await supabaseAdmin!.from('bob_action_proposals').select('id').limit(1)
    expect(error).toBeNull()
  })

  test('bob_action_proposal_events table is queryable', async () => {
    if (!supabaseAdmin) test.skip()
    const { error } = await supabaseAdmin!.from('bob_action_proposal_events').select('id').limit(1)
    expect(error).toBeNull()
  })

  test('proposal can be linked to an operational case', async () => {
    if (!supabaseAdmin) test.skip()
    const orgId = await createOrg('case')
    const requester = await createUserProfile(orgId, 'case-requester')
    try {
      const caseId = await createCase(orgId, requester.profileId)
      const proposal = await createProposal(orgId, requester.profileId, caseId)
      expect(proposal.case_id).toBe(caseId)
    } finally {
      await deleteUser(requester.userId)
      await supabaseAdmin!.from('organizations').delete().eq('id', orgId)
    }
  })

  test('approve_bob_action_proposal marks proposal approved with approver details', async () => {
    if (!supabaseAdmin) test.skip()
    const orgId = await createOrg('approve')
    const requester = await createUserProfile(orgId, 'approve-requester')
    const approver = await createUserProfile(orgId, 'approve-admin', 'admin')
    try {
      const proposal = await createProposal(orgId, requester.profileId)
      const { data, error } = await supabaseAdmin!.rpc('approve_bob_action_proposal', {
        p_proposal_id: proposal.id,
        p_decision: 'approve',
        p_note: 'Approved in D1 gate',
        p_actor_id: approver.profileId,
      })
      expect(error).toBeNull()
      expect(data?.status).toBe('approved')
      expect(data?.approver_id).toBe(approver.profileId)
      expect(data?.approved_at).toBeTruthy()
    } finally {
      await deleteUser(requester.userId)
      await deleteUser(approver.userId)
      await supabaseAdmin!.from('organizations').delete().eq('id', orgId)
    }
  })

  test('approve_bob_action_proposal can reject proposals', async () => {
    if (!supabaseAdmin) test.skip()
    const orgId = await createOrg('reject')
    const requester = await createUserProfile(orgId, 'reject-requester')
    const approver = await createUserProfile(orgId, 'reject-admin', 'admin')
    try {
      const proposal = await createProposal(orgId, requester.profileId)
      const { data, error } = await supabaseAdmin!.rpc('approve_bob_action_proposal', {
        p_proposal_id: proposal.id,
        p_decision: 'reject',
        p_note: 'Rejected in D1 gate',
        p_actor_id: approver.profileId,
      })
      expect(error).toBeNull()
      expect(data?.status).toBe('rejected')
      expect(data?.rejected_at).toBeTruthy()
    } finally {
      await deleteUser(requester.userId)
      await deleteUser(approver.userId)
      await supabaseAdmin!.from('organizations').delete().eq('id', orgId)
    }
  })

  test('expired proposals escalate to pending_escalation', async () => {
    if (!supabaseAdmin) test.skip()
    const orgId = await createOrg('escalate')
    const requester = await createUserProfile(orgId, 'escalate-requester')
    try {
      const pastDue = new Date(Date.now() - 60_000).toISOString()
      const proposal = await createProposal(orgId, requester.profileId, undefined, pastDue)
      const { data, error } = await supabaseAdmin!.rpc('escalate_expired_bob_action_proposals', {
        p_organization_id: orgId,
      })
      expect(error).toBeNull()
      expect(Number(data ?? 0)).toBeGreaterThanOrEqual(1)

      const { data: refreshed } = await supabaseAdmin!
        .from('bob_action_proposals')
        .select('status, escalated_at')
        .eq('id', proposal.id)
        .single()

      expect(refreshed?.status).toBe('pending_escalation')
      expect(refreshed?.escalated_at).toBeTruthy()
    } finally {
      await deleteUser(requester.userId)
      await supabaseAdmin!.from('organizations').delete().eq('id', orgId)
    }
  })

  test('mark_bob_action_proposal_execution records executed status', async () => {
    if (!supabaseAdmin) test.skip()
    const orgId = await createOrg('executed')
    const requester = await createUserProfile(orgId, 'executed-requester')
    const approver = await createUserProfile(orgId, 'executed-admin', 'admin')
    try {
      const proposal = await createProposal(orgId, requester.profileId)
      await supabaseAdmin!.rpc('approve_bob_action_proposal', {
        p_proposal_id: proposal.id,
        p_decision: 'approve',
        p_note: 'Ready to execute',
        p_actor_id: approver.profileId,
      })

      const { data, error } = await supabaseAdmin!.rpc('mark_bob_action_proposal_execution', {
        p_proposal_id: proposal.id,
        p_execution_status: 'executed',
        p_note: 'Executed in D1 gate',
        p_actor_id: approver.profileId,
      })

      expect(error).toBeNull()
      expect(data?.status).toBe('executed')
      expect(data?.executed_at).toBeTruthy()
    } finally {
      await deleteUser(requester.userId)
      await deleteUser(approver.userId)
      await supabaseAdmin!.from('organizations').delete().eq('id', orgId)
    }
  })

  test('mark_bob_action_proposal_execution records execution failures distinctly', async () => {
    if (!supabaseAdmin) test.skip()
    const orgId = await createOrg('failed')
    const requester = await createUserProfile(orgId, 'failed-requester')
    const approver = await createUserProfile(orgId, 'failed-admin', 'admin')
    try {
      const proposal = await createProposal(orgId, requester.profileId)
      await supabaseAdmin!.rpc('approve_bob_action_proposal', {
        p_proposal_id: proposal.id,
        p_decision: 'approve',
        p_note: 'Approved before failure path',
        p_actor_id: approver.profileId,
      })

      const { data, error } = await supabaseAdmin!.rpc('mark_bob_action_proposal_execution', {
        p_proposal_id: proposal.id,
        p_execution_status: 'execution_failed',
        p_note: 'Execution failed in D1 gate',
        p_error: 'Synthetic failure',
        p_actor_id: approver.profileId,
      })

      expect(error).toBeNull()
      expect(data?.status).toBe('execution_failed')
      expect(data?.execution_error).toBe('Synthetic failure')
      expect(data?.execution_failed_at).toBeTruthy()
    } finally {
      await deleteUser(requester.userId)
      await deleteUser(approver.userId)
      await supabaseAdmin!.from('organizations').delete().eq('id', orgId)
    }
  })

  test('proposal audit trail captures proposed, approved, and executed events', async () => {
    if (!supabaseAdmin) test.skip()
    const orgId = await createOrg('audit')
    const requester = await createUserProfile(orgId, 'audit-requester')
    const approver = await createUserProfile(orgId, 'audit-admin', 'admin')
    try {
      const proposal = await createProposal(orgId, requester.profileId)
      await supabaseAdmin!.rpc('approve_bob_action_proposal', {
        p_proposal_id: proposal.id,
        p_decision: 'approve',
        p_note: 'Audit approve',
        p_actor_id: approver.profileId,
      })
      await supabaseAdmin!.rpc('mark_bob_action_proposal_execution', {
        p_proposal_id: proposal.id,
        p_execution_status: 'executed',
        p_note: 'Audit execute',
        p_actor_id: approver.profileId,
      })

      const { data, error } = await supabaseAdmin!
        .from('bob_action_proposal_events')
        .select('event_type')
        .eq('proposal_id', proposal.id)
        .order('created_at', { ascending: true })

      expect(error).toBeNull()
      expect((data ?? []).map((row) => row.event_type)).toEqual(['proposed', 'approved', 'executed'])
    } finally {
      await deleteUser(requester.userId)
      await deleteUser(approver.userId)
      await supabaseAdmin!.from('organizations').delete().eq('id', orgId)
    }
  })

  test('org isolation: Org A proposals are not visible when scoped to Org B', async () => {
    if (!supabaseAdmin) test.skip()
    const orgA = await createOrg('isoA')
    const orgB = await createOrg('isoB')
    const requesterA = await createUserProfile(orgA, 'iso-requester-a')
    const requesterB = await createUserProfile(orgB, 'iso-requester-b')
    try {
      await createProposal(orgA, requesterA.profileId)
      const { data, error } = await supabaseAdmin!
        .from('bob_action_proposals')
        .select('id')
        .eq('organization_id', orgB)
      expect(error).toBeNull()
      expect(data?.length).toBe(0)
    } finally {
      await deleteUser(requesterA.userId)
      await deleteUser(requesterB.userId)
      await supabaseAdmin!.from('organizations').delete().eq('id', orgA)
      await supabaseAdmin!.from('organizations').delete().eq('id', orgB)
    }
  })
})
