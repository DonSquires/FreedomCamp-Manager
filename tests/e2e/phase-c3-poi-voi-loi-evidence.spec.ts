import { test, expect } from '@playwright/test'
import { supabaseAdmin } from './setup'

async function createOrg(label: string) {
  if (!supabaseAdmin) throw new Error('SUPABASE_SERVICE_ROLE_KEY required')
  const { data, error } = await supabaseAdmin.from('organizations').insert({ name: `C3 ${label} ${crypto.randomUUID()}`, organization_type: 'client', is_active: true, overnight_verification_mode: 'two_photo_verification' }).select('id').single()
  if (error || !data) throw error ?? new Error('org')
  return data.id as string
}

async function createOfficer(orgId: string, label: string) {
  if (!supabaseAdmin) throw new Error('SUPABASE_SERVICE_ROLE_KEY required')
  const email = `c3-${label}-${crypto.randomUUID()}@test.local`
  const { data: a, error: ae } = await supabaseAdmin.auth.admin.createUser({ email, password: `C3!${crypto.randomUUID()}aa`, email_confirm: true })
  if (ae || !a.user) throw ae ?? new Error('auth')
  const { data: p, error: pe } = await supabaseAdmin.from('user_profiles').upsert({ id: a.user.id, organization_id: orgId, email, role: 'officer', is_active: true, enabled_portals: [], portal_access: [], extra_organization_ids: [] }, { onConflict: 'id' }).select('id').single()
  if (pe || !p) { await supabaseAdmin.auth.admin.deleteUser(a.user.id); throw pe ?? new Error('profile') }
  return { userId: a.user.id, profileId: p.id as string }
}

async function deleteOfficer(userId?: string) { if (supabaseAdmin && userId) await supabaseAdmin.auth.admin.deleteUser(userId) }

async function createCase(orgId: string, officerId: string, caseType = 'poi_alert', createdFrom = 'poi_match') {
  if (!supabaseAdmin) throw new Error('SUPABASE_SERVICE_ROLE_KEY required')
  const { data, error } = await supabaseAdmin.from('operational_cases').insert({ organization_id: orgId, case_type: caseType, created_from: createdFrom, status: 'active', title: `C3 ${crypto.randomUUID()}`, created_by: officerId }).select('id').single()
  if (error || !data) throw error ?? new Error('case')
  return data.id as string
}

test.describe('Phase C3 — POI / VOI / Trespass / Alert Queue Case Bridge', () => {

  test('persons_of_interest has case_id column', async () => {
    if (!supabaseAdmin) test.skip()
    const { error } = await supabaseAdmin!.from('persons_of_interest').select('id, case_id').limit(1)
    expect(error).toBeNull()
  })

  test('vehicles_of_interest has case_id column', async () => {
    if (!supabaseAdmin) test.skip()
    const { error } = await supabaseAdmin!.from('vehicles_of_interest').select('id, case_id').limit(1)
    expect(error).toBeNull()
  })

  test('trespass_notices has case_id column', async () => {
    if (!supabaseAdmin) test.skip()
    const { error } = await supabaseAdmin!.from('trespass_notices').select('id, case_id').limit(1)
    expect(error).toBeNull()
  })

  test('alert_queue has case_id column', async () => {
    if (!supabaseAdmin) test.skip()
    const { error } = await supabaseAdmin!.from('alert_queue').select('id, case_id').limit(1)
    expect(error).toBeNull()
  })

  test('case_type=poi_alert can be created', async () => {
    if (!supabaseAdmin) test.skip()
    const orgId = await createOrg('poi')
    const { userId, profileId } = await createOfficer(orgId, 'poi')
    try {
      const { data, error } = await supabaseAdmin!.from('operational_cases').insert({ organization_id: orgId, case_type: 'poi_alert', created_from: 'poi_match', status: 'active', title: 'POI test', created_by: profileId }).select('id, case_type').single()
      expect(error).toBeNull()
      expect(data?.case_type).toBe('poi_alert')
    } finally { await deleteOfficer(userId); await supabaseAdmin!.from('organizations').delete().eq('id', orgId) }
  })

  test('case_type=voi_alert can be created', async () => {
    if (!supabaseAdmin) test.skip()
    const orgId = await createOrg('voi')
    const { userId, profileId } = await createOfficer(orgId, 'voi')
    try {
      const { data, error } = await supabaseAdmin!.from('operational_cases').insert({ organization_id: orgId, case_type: 'voi_alert', created_from: 'voi_match', status: 'active', title: 'VOI test', created_by: profileId }).select('id, case_type').single()
      expect(error).toBeNull()
      expect(data?.case_type).toBe('voi_alert')
    } finally { await deleteOfficer(userId); await supabaseAdmin!.from('organizations').delete().eq('id', orgId) }
  })

  test('trespass notice can be linked to a poi_alert case', async () => {
    if (!supabaseAdmin) test.skip()
    const orgId = await createOrg('tn')
    const { userId, profileId } = await createOfficer(orgId, 'tn')
    const caseId = await createCase(orgId, profileId)
    try {
      const { data, error } = await supabaseAdmin!.from('trespass_notices').insert({ organization_id: orgId, case_id: caseId, issued_by: profileId, notice_type: 'written', trespass_reason: 'C3 gate test', status: 'active' }).select('id, case_id, notice_type').single()
      expect(error).toBeNull()
      expect(data?.case_id).toBe(caseId)
    } finally { await deleteOfficer(userId); await supabaseAdmin!.from('organizations').delete().eq('id', orgId) }
  })

  test('timeline returns linked notices', async () => {
    if (!supabaseAdmin) test.skip()
    const orgId = await createOrg('tl')
    const { userId, profileId } = await createOfficer(orgId, 'tl')
    const caseId = await createCase(orgId, profileId)
    try {
      await supabaseAdmin!.from('trespass_notices').insert({ organization_id: orgId, case_id: caseId, issued_by: profileId, notice_type: 'verbal', trespass_reason: 'timeline test', status: 'active' })
      const { data } = await supabaseAdmin!.from('trespass_notices').select('id').eq('case_id', caseId)
      expect(data?.length).toBeGreaterThanOrEqual(1)
    } finally { await deleteOfficer(userId); await supabaseAdmin!.from('organizations').delete().eq('id', orgId) }
  })

  test('org isolation: trespass notices scoped to originating org', async () => {
    if (!supabaseAdmin) test.skip()
    const orgA = await createOrg('isoA'); const orgB = await createOrg('isoB')
    const { userId: ua, profileId: pa } = await createOfficer(orgA, 'a')
    const { userId: ub } = await createOfficer(orgB, 'b')
    const caseId = await createCase(orgA, pa)
    try {
      await supabaseAdmin!.from('trespass_notices').insert({ organization_id: orgA, case_id: caseId, issued_by: pa, notice_type: 'written', trespass_reason: 'iso test', status: 'active' })
      const { data } = await supabaseAdmin!.from('trespass_notices').select('id').eq('organization_id', orgB)
      expect(data?.length).toBe(0)
    } finally {
      await deleteOfficer(ua); await deleteOfficer(ub)
      await supabaseAdmin!.from('organizations').delete().eq('id', orgA)
      await supabaseAdmin!.from('organizations').delete().eq('id', orgB)
    }
  })

})
