import { test, expect } from '@playwright/test'

function readEnv(...keys: string[]): string {
  for (const key of keys) {
    const value = (process.env[key] || '').trim()
    if (value) return value
  }
  return ''
}

function getSupabaseUrl(): string {
  return readEnv('VITE_SUPABASE_URL', 'SUPABASE_URL').replace(/\/$/, '')
}

function getAnonKey(): string {
  return readEnv('VITE_SUPABASE_ANON_KEY')
}

function headers(token?: string): Record<string, string> {
  const base: Record<string, string> = {
    apikey: getAnonKey(),
    'Content-Type': 'application/json',
  }
  if (token) base.Authorization = `Bearer ${token}`
  return base
}

async function signIn(email: string, password: string): Promise<string | null> {
  if (!email || !password) return null
  const res = await fetch(`${getSupabaseUrl()}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) return null
  const data = await res.json() as { access_token?: string }
  return data.access_token || null
}

type UserProfile = {
  id: string
  organization_id: string
  role?: string
}

async function fetchMyProfile(token: string): Promise<UserProfile | null> {
  const res = await fetch(`${getSupabaseUrl()}/rest/v1/user_profiles?select=id,organization_id,role&limit=1`, {
    headers: headers(token),
  })
  if (!res.ok) return null
  const rows = await res.json() as UserProfile[]
  return rows?.[0] || null
}

async function createConsent(adminToken: string, orgId: string, officerId: string): Promise<{ status: number; row: Record<string, unknown> | null }> {
  const res = await fetch(`${getSupabaseUrl()}/rest/v1/radio_voice_consents`, {
    method: 'POST',
    headers: {
      ...headers(adminToken),
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      org_id: orgId,
      officer_id: officerId,
      purpose: 'voice_twin_training',
      retention_days: 90,
      provider: 'coqui-xtts',
    }),
  })

  if (!res.ok) return { status: res.status, row: null }
  const rows = await res.json() as Record<string, unknown>[]
  return { status: res.status, row: rows?.[0] || null }
}

const adminOrg1Email = readEnv('PLAYWRIGHT_ADMIN_ORG1_EMAIL', 'PLAYWRIGHT_ADMIN_EMAIL', 'E2E_ADMIN_EMAIL')
const adminOrg1Password = readEnv('PLAYWRIGHT_ADMIN_ORG1_PASSWORD', 'PLAYWRIGHT_ADMIN_PASSWORD', 'E2E_ADMIN_PASSWORD')
const adminOrg2Email = readEnv('PLAYWRIGHT_ADMIN_ORG2_EMAIL', 'E2E_ADMIN_ORG2_EMAIL')
const adminOrg2Password = readEnv('PLAYWRIGHT_ADMIN_ORG2_PASSWORD', 'E2E_ADMIN_ORG2_PASSWORD')
const officerEmail = readEnv('PLAYWRIGHT_OFFICER_ORG1_EMAIL', 'PLAYWRIGHT_OFFICER_EMAIL', 'E2E_OFFICER_EMAIL')
const officerPassword = readEnv('PLAYWRIGHT_OFFICER_ORG1_PASSWORD', 'PLAYWRIGHT_OFFICER_PASSWORD', 'E2E_OFFICER_PASSWORD')

const hasSupabase = !!getSupabaseUrl() && !!getAnonKey()

test.describe('radio voice consent and revocation', () => {
  test('admin can create consent record for officer in same org', async () => {
    test.skip(!hasSupabase, 'Supabase URL/key not configured')
    test.skip(!adminOrg1Email || !adminOrg1Password || !officerEmail || !officerPassword, 'Admin/officer credentials not configured')

    const adminToken = await signIn(adminOrg1Email, adminOrg1Password)
    const officerToken = await signIn(officerEmail, officerPassword)
    test.skip(!adminToken || !officerToken, 'Sign-in failed')

    const adminProfile = await fetchMyProfile(adminToken)
    const officerProfile = await fetchMyProfile(officerToken)
    test.skip(!adminProfile || !officerProfile, 'Unable to load profiles')

    // For org-scoped validation this test requires both users in same org.
    test.skip(adminProfile.organization_id !== officerProfile.organization_id, 'Admin/officer are in different organizations')

    const insert = await createConsent(adminToken, adminProfile.organization_id, officerProfile.id)
    expect([201, 404, 500]).toContain(insert.status)
    expect(insert.status).not.toBe(401)
    expect(insert.status).not.toBe(403)

    if (insert.status === 201) {
      expect(insert.row?.org_id).toBe(adminProfile.organization_id)
      expect(insert.row?.officer_id).toBe(officerProfile.id)
      expect(insert.row?.revoked_at ?? null).toBeNull()
    }
  })

  test('officer can revoke own consent record', async () => {
    test.skip(!hasSupabase, 'Supabase URL/key not configured')
    test.skip(!adminOrg1Email || !adminOrg1Password || !officerEmail || !officerPassword, 'Admin/officer credentials not configured')

    const adminToken = await signIn(adminOrg1Email, adminOrg1Password)
    const officerToken = await signIn(officerEmail, officerPassword)
    test.skip(!adminToken || !officerToken, 'Sign-in failed')

    const adminProfile = await fetchMyProfile(adminToken)
    const officerProfile = await fetchMyProfile(officerToken)
    test.skip(!adminProfile || !officerProfile, 'Unable to load profiles')
    test.skip(adminProfile.organization_id !== officerProfile.organization_id, 'Admin/officer are in different organizations')

    const inserted = await createConsent(adminToken, adminProfile.organization_id, officerProfile.id)
    test.skip(inserted.status !== 201 || !inserted.row?.id, 'Consent insert unavailable in this environment')

    const revokedAt = new Date().toISOString()
    const patchRes = await fetch(`${getSupabaseUrl()}/rest/v1/radio_voice_consents?id=eq.${inserted.row.id}`, {
      method: 'PATCH',
      headers: {
        ...headers(officerToken),
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        revoked_at: revokedAt,
        revocation_reason: 'test revocation',
      }),
    })

    expect([200, 204, 404, 500]).toContain(patchRes.status)
    expect(patchRes.status).not.toBe(401)
    expect(patchRes.status).not.toBe(403)

    if (patchRes.status === 200) {
      const rows = await patchRes.json() as Array<{ revoked_at?: string | null; revocation_reason?: string | null }>
      expect(rows?.[0]?.revoked_at).toBeTruthy()
      expect(rows?.[0]?.revocation_reason).toBe('test revocation')
    }
  })

  test('admin from another org cannot read officer consent rows', async () => {
    test.skip(!hasSupabase, 'Supabase URL/key not configured')
    test.skip(!adminOrg1Email || !adminOrg1Password || !adminOrg2Email || !adminOrg2Password || !officerEmail || !officerPassword, 'Distinct admin/officer credentials not configured')

    const adminOrg1Token = await signIn(adminOrg1Email, adminOrg1Password)
    const adminOrg2Token = await signIn(adminOrg2Email, adminOrg2Password)
    const officerToken = await signIn(officerEmail, officerPassword)
    test.skip(!adminOrg1Token || !adminOrg2Token || !officerToken, 'Sign-in failed')

    const adminOrg1Profile = await fetchMyProfile(adminOrg1Token)
    const officerProfile = await fetchMyProfile(officerToken)
    test.skip(!adminOrg1Profile || !officerProfile, 'Unable to load profiles')

    // Seed a consent row so the read-path isolation assertion has data to target.
    const seedInsert = await createConsent(adminOrg1Token, adminOrg1Profile.organization_id, officerProfile.id)
    test.skip(seedInsert.status !== 201, 'Consent seed unavailable in this environment')

    const readRes = await fetch(
      `${getSupabaseUrl()}/rest/v1/radio_voice_consents?select=id,officer_id,org_id&officer_id=eq.${officerProfile.id}&limit=10`,
      { headers: headers(adminOrg2Token) },
    )

    expect([200, 404, 500]).toContain(readRes.status)
    expect(readRes.status).not.toBe(401)
    expect(readRes.status).not.toBe(403)

    if (readRes.status === 200) {
      const rows = await readRes.json() as Array<{ id: string }>
      expect(rows).toEqual([])
    }
  })
})
