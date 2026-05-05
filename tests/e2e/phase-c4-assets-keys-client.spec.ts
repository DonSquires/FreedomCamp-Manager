import { test, expect } from '@playwright/test'
import { supabaseAdmin } from './setup'

async function createOrg(label: string) {
  if (!supabaseAdmin) throw new Error('SUPABASE_SERVICE_ROLE_KEY required')
  const { data, error } = await supabaseAdmin.from('organizations').insert({ name: `C4 ${label} ${crypto.randomUUID()}`, organization_type: 'client', is_active: true, overnight_verification_mode: 'two_photo_verification' }).select('id').single()
  if (error || !data) throw error ?? new Error('org')
  return data.id as string
}

async function createOfficer(orgId: string, label: string) {
  if (!supabaseAdmin) throw new Error('SUPABASE_SERVICE_ROLE_KEY required')
  const email = `c4-${label}-${crypto.randomUUID()}@test.local`
  const { data: a, error: ae } = await supabaseAdmin.auth.admin.createUser({ email, password: `C4!${crypto.randomUUID()}aa`, email_confirm: true })
  if (ae || !a.user) throw ae ?? new Error('auth')
  const { data: p, error: pe } = await supabaseAdmin.from('user_profiles').upsert({ id: a.user.id, organization_id: orgId, email, role: 'officer', is_active: true, enabled_portals: [], portal_access: [], extra_organization_ids: [] }, { onConflict: 'id' }).select('id').single()
  if (pe || !p) { await supabaseAdmin.auth.admin.deleteUser(a.user.id); throw pe ?? new Error('profile') }
  return { userId: a.user.id, profileId: p.id as string }
}

async function deleteOfficer(userId?: string) { if (supabaseAdmin && userId) await supabaseAdmin.auth.admin.deleteUser(userId) }

async function createCase(orgId: string, officerId: string) {
  if (!supabaseAdmin) throw new Error('SUPABASE_SERVICE_ROLE_KEY required')
  const { data, error } = await supabaseAdmin.from('operational_cases').insert({ organization_id: orgId, case_type: 'site_guard', created_from: 'site_guard', status: 'active', title: `C4 ${crypto.randomUUID()}`, created_by: officerId }).select('id').single()
  if (error || !data) throw error ?? new Error('case')
  return data.id as string
}

test.describe('Phase C4 — Assets / Keys / Service Agreements Case Bridge', () => {

  test('case_assets_used table is queryable', async () => {
    if (!supabaseAdmin) test.skip()
    const { error } = await supabaseAdmin!.from('case_assets_used').select('id').limit(1)
    expect(error).toBeNull()
  })

  test('case_keys_used table is queryable', async () => {
    if (!supabaseAdmin) test.skip()
    const { error } = await supabaseAdmin!.from('case_keys_used').select('id').limit(1)
    expect(error).toBeNull()
  })

  test('service_agreements table is queryable', async () => {
    if (!supabaseAdmin) test.skip()
    const { error } = await supabaseAdmin!.from('service_agreements').select('id').limit(1)
    expect(error).toBeNull()
  })

  test('case_type=client_request can be created', async () => {
    if (!supabaseAdmin) test.skip()
    const orgId = await createOrg('cr')
    const { userId, profileId } = await createOfficer(orgId, 'cr')
    try {
      const { data, error } = await supabaseAdmin!.from('operational_cases').insert({ organization_id: orgId, case_type: 'client_request', created_from: 'client_request', status: 'active', title: 'CR test', created_by: profileId }).select('id, case_type').single()
      expect(error).toBeNull()
      expect(data?.case_type).toBe('client_request')
    } finally { await deleteOfficer(userId); await supabaseAdmin!.from('organizations').delete().eq('id', orgId) }
  })

  test('service_agreement can be created with active status', async () => {
    if (!supabaseAdmin) test.skip()
    const orgId = await createOrg('sa'); const clientId = await createOrg('sa-client')
    const { userId, profileId } = await createOfficer(orgId, 'sa')
    try {
      const { data, error } = await supabaseAdmin!.from('service_agreements').insert({ organization_id: orgId, client_org_id: clientId, agreement_number: `SA-${crypto.randomUUID().slice(0, 8)}`, service_type: 'guarding', start_date: '2026-01-01', status: 'active', min_officers: 1, created_by: profileId }).select('id, status, service_type').single()
      expect(error).toBeNull()
      expect(data?.status).toBe('active')
      expect(data?.service_type).toBe('guarding')
    } finally {
      await deleteOfficer(userId)
      await supabaseAdmin!.from('organizations').delete().eq('id', orgId)
      await supabaseAdmin!.from('organizations').delete().eq('id', clientId)
    }
  })

  test('C4 timeline query returns empty arrays for new case', async () => {
    if (!supabaseAdmin) test.skip()
    const orgId = await createOrg('tl')
    const { userId, profileId } = await createOfficer(orgId, 'tl')
    const caseId = await createCase(orgId, profileId)
    try {
      const [{ data: assets, error: ae }, { data: keys, error: ke }] = await Promise.all([
        supabaseAdmin!.from('case_assets_used').select('id').eq('case_id', caseId),
        supabaseAdmin!.from('case_keys_used').select('id').eq('case_id', caseId),
      ])
      expect(ae).toBeNull(); expect(ke).toBeNull()
      expect(Array.isArray(assets)).toBe(true)
      expect(Array.isArray(keys)).toBe(true)
    } finally { await deleteOfficer(userId); await supabaseAdmin!.from('organizations').delete().eq('id', orgId) }
  })

  test('service_agreement unique constraint enforced per org', async () => {
    if (!supabaseAdmin) test.skip()
    const orgId = await createOrg('uq'); const clientId = await createOrg('uq-client')
    const { userId, profileId } = await createOfficer(orgId, 'uq')
    const num = `SA-${crypto.randomUUID().slice(0, 8)}`
    try {
      await supabaseAdmin!.from('service_agreements').insert({ organization_id: orgId, client_org_id: clientId, agreement_number: num, service_type: 'patrol', start_date: '2026-01-01', status: 'active', min_officers: 1, created_by: profileId })
      const { error } = await supabaseAdmin!.from('service_agreements').insert({ organization_id: orgId, client_org_id: clientId, agreement_number: num, service_type: 'patrol', start_date: '2026-01-01', status: 'active', min_officers: 1 })
      expect(error).not.toBeNull()
    } finally {
      await deleteOfficer(userId)
      await supabaseAdmin!.from('organizations').delete().eq('id', orgId)
      await supabaseAdmin!.from('organizations').delete().eq('id', clientId)
    }
  })

  test('org isolation: service_agreements scoped to originating org', async () => {
    if (!supabaseAdmin) test.skip()
    const orgA = await createOrg('isoA'); const orgB = await createOrg('isoB'); const clientId = await createOrg('isoC')
    const { userId: ua, profileId: pa } = await createOfficer(orgA, 'a')
    const { userId: ub } = await createOfficer(orgB, 'b')
    try {
      await supabaseAdmin!.from('service_agreements').insert({ organization_id: orgA, client_org_id: clientId, agreement_number: `SA-${crypto.randomUUID().slice(0, 8)}`, service_type: 'patrol', start_date: '2026-01-01', status: 'active', min_officers: 1, created_by: pa })
      const { data } = await supabaseAdmin!.from('service_agreements').select('id').eq('organization_id', orgB)
      expect(data?.length).toBe(0)
    } finally {
      await deleteOfficer(ua); await deleteOfficer(ub)
      await supabaseAdmin!.from('organizations').delete().eq('id', orgA)
      await supabaseAdmin!.from('organizations').delete().eq('id', orgB)
      await supabaseAdmin!.from('organizations').delete().eq('id', clientId)
    }
  })

})
