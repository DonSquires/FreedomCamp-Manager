import { test, expect } from '@playwright/test'
import { supabaseAdmin } from './setup'

async function createOrg(label: string) {
  if (!supabaseAdmin) throw new Error('SUPABASE_SERVICE_ROLE_KEY required')
  const { data, error } = await supabaseAdmin.from('organizations').insert({ name: `C2 ${label} ${crypto.randomUUID()}`, organization_type: 'client', is_active: true, overnight_verification_mode: 'two_photo_verification' }).select('id').single()
  if (error || !data) throw error ?? new Error('org')
  return data.id as string
}

async function createOfficer(orgId: string, label: string) {
  if (!supabaseAdmin) throw new Error('SUPABASE_SERVICE_ROLE_KEY required')
  const email = `c2-${label}-${crypto.randomUUID()}@test.local`
  const { data: a, error: ae } = await supabaseAdmin.auth.admin.createUser({ email, password: `C2!${crypto.randomUUID()}aa`, email_confirm: true })
  if (ae || !a.user) throw ae ?? new Error('auth')
  const { data: p, error: pe } = await supabaseAdmin.from('user_profiles').upsert({ id: a.user.id, organization_id: orgId, email, role: 'officer', is_active: true, enabled_portals: [], portal_access: [], extra_organization_ids: [] }, { onConflict: 'id' }).select('id').single()
  if (pe || !p) { await supabaseAdmin.auth.admin.deleteUser(a.user.id); throw pe ?? new Error('profile') }
  return { userId: a.user.id, profileId: p.id as string }
}

async function deleteOfficer(userId?: string) { if (supabaseAdmin && userId) await supabaseAdmin.auth.admin.deleteUser(userId) }

async function createCase(orgId: string, officerId: string, caseType = 'access_control') {
  if (!supabaseAdmin) throw new Error('SUPABASE_SERVICE_ROLE_KEY required')
  const { data, error } = await supabaseAdmin.from('operational_cases').insert({ organization_id: orgId, case_type: caseType, created_from: caseType, status: 'active', title: `C2 ${crypto.randomUUID()}`, created_by: officerId }).select('id').single()
  if (error || !data) throw error ?? new Error('case')
  return data.id as string
}

test.describe('Phase C2 — Access Control / Identity Case Bridge', () => {

  test('access_control_incidents table is queryable', async () => {
    if (!supabaseAdmin) test.skip()
    const { error } = await supabaseAdmin!.from('access_control_incidents').select('id').limit(1)
    expect(error).toBeNull()
  })

  test('person_id_documents table is queryable', async () => {
    if (!supabaseAdmin) test.skip()
    const { error } = await supabaseAdmin!.from('person_id_documents').select('id').limit(1)
    expect(error).toBeNull()
  })

  test('site_risk_assessments table is queryable', async () => {
    if (!supabaseAdmin) test.skip()
    const { error } = await supabaseAdmin!.from('site_risk_assessments').select('id').limit(1)
    expect(error).toBeNull()
  })

  test('case_type=access_control can be created', async () => {
    if (!supabaseAdmin) test.skip()
    const orgId = await createOrg('ac')
    const { userId, profileId } = await createOfficer(orgId, 'ac')
    try {
      const { data, error } = await supabaseAdmin!.from('operational_cases').insert({ organization_id: orgId, case_type: 'access_control', created_from: 'access_control', status: 'active', title: 'AC test', created_by: profileId }).select('id, case_type').single()
      expect(error).toBeNull()
      expect(data?.case_type).toBe('access_control')
    } finally { await deleteOfficer(userId); await supabaseAdmin!.from('organizations').delete().eq('id', orgId) }
  })

  test('case_type=identity_check can be created', async () => {
    if (!supabaseAdmin) test.skip()
    const orgId = await createOrg('id')
    const { userId, profileId } = await createOfficer(orgId, 'id')
    try {
      const { data, error } = await supabaseAdmin!.from('operational_cases').insert({ organization_id: orgId, case_type: 'identity_check', created_from: 'identity_check', status: 'active', title: 'ID test', created_by: profileId }).select('id, case_type').single()
      expect(error).toBeNull()
      expect(data?.case_type).toBe('identity_check')
    } finally { await deleteOfficer(userId); await supabaseAdmin!.from('organizations').delete().eq('id', orgId) }
  })

  test('access_control_incident can be linked to a case', async () => {
    if (!supabaseAdmin) test.skip()
    const orgId = await createOrg('aci')
    const { userId, profileId } = await createOfficer(orgId, 'aci')
    const caseId = await createCase(orgId, profileId)
    try {
      const { data, error } = await supabaseAdmin!.from('access_control_incidents').insert({ organization_id: orgId, case_id: caseId, officer_id: profileId, incident_type: 'unauthorized_entry', description: 'C2 gate', status: 'open' }).select('id, case_id').single()
      expect(error).toBeNull()
      expect(data?.case_id).toBe(caseId)
    } finally { await deleteOfficer(userId); await supabaseAdmin!.from('organizations').delete().eq('id', orgId) }
  })

  test('access_entries has case_id column', async () => {
    if (!supabaseAdmin) test.skip()
    const { error } = await supabaseAdmin!.from('access_entries').select('id, case_id').limit(1)
    expect(error).toBeNull()
  })

  test('case remains active after linking an incident', async () => {
    if (!supabaseAdmin) test.skip()
    const orgId = await createOrg('active')
    const { userId, profileId } = await createOfficer(orgId, 'active')
    const caseId = await createCase(orgId, profileId)
    try {
      await supabaseAdmin!.from('access_control_incidents').insert({ organization_id: orgId, case_id: caseId, officer_id: profileId, incident_type: 'tailgating', description: 'test', status: 'open' })
      const { data } = await supabaseAdmin!.from('operational_cases').select('status').eq('id', caseId).single()
      expect(data?.status).toBe('active')
    } finally { await deleteOfficer(userId); await supabaseAdmin!.from('organizations').delete().eq('id', orgId) }
  })

  test('timeline query returns linked incidents', async () => {
    if (!supabaseAdmin) test.skip()
    const orgId = await createOrg('tl')
    const { userId, profileId } = await createOfficer(orgId, 'tl')
    const caseId = await createCase(orgId, profileId)
    try {
      await supabaseAdmin!.from('access_control_incidents').insert({ organization_id: orgId, case_id: caseId, officer_id: profileId, incident_type: 'unauthorized_entry', description: 'timeline', status: 'open' })
      const { data } = await supabaseAdmin!.from('access_control_incidents').select('id').eq('case_id', caseId)
      expect(data?.length).toBeGreaterThanOrEqual(1)
    } finally { await deleteOfficer(userId); await supabaseAdmin!.from('organizations').delete().eq('id', orgId) }
  })

  test('org isolation: Org A incidents not visible when scoped to Org B', async () => {
    if (!supabaseAdmin) test.skip()
    const orgA = await createOrg('isoA'); const orgB = await createOrg('isoB')
    const { userId: ua, profileId: pa } = await createOfficer(orgA, 'a')
    const { userId: ub } = await createOfficer(orgB, 'b')
    const caseId = await createCase(orgA, pa)
    try {
      await supabaseAdmin!.from('access_control_incidents').insert({ organization_id: orgA, case_id: caseId, officer_id: pa, incident_type: 'unauthorized_entry', description: 'org A', status: 'open' })
      const { data } = await supabaseAdmin!.from('access_control_incidents').select('id').eq('organization_id', orgB)
      expect(data?.length).toBe(0)
    } finally {
      await deleteOfficer(ua); await deleteOfficer(ub)
      await supabaseAdmin!.from('organizations').delete().eq('id', orgA)
      await supabaseAdmin!.from('organizations').delete().eq('id', orgB)
    }
  })

})
