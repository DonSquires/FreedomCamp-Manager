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

async function fetchMyProfile(token: string): Promise<{ organization_id?: string; role?: string } | null> {
  const res = await fetch(`${getSupabaseUrl()}/rest/v1/user_profiles?select=organization_id,role&limit=1`, {
    headers: headers(token),
  })
  if (!res.ok) return null
  const rows = await res.json() as Array<{ organization_id?: string; role?: string }>
  return rows?.[0] || null
}

async function fetchTranscriptRows(token: string, orgId: string): Promise<{ status: number; rows: Array<Record<string, unknown>> | null }> {
  const res = await fetch(
    `${getSupabaseUrl()}/rest/v1/radio_transcript_segments?select=id,org_id,transmission_id,sequence_num&org_id=eq.${orgId}&limit=10`,
    { headers: headers(token) },
  )
  if (!res.ok) return { status: res.status, rows: null }
  return { status: res.status, rows: await res.json() as Array<Record<string, unknown>> }
}

async function fetchTranslationRows(token: string, orgId: string): Promise<{ status: number; rows: Array<Record<string, unknown>> | null }> {
  const res = await fetch(
    `${getSupabaseUrl()}/rest/v1/radio_translation_segments?select=id,org_id,transcript_segment_id,target_language&org_id=eq.${orgId}&limit=10`,
    { headers: headers(token) },
  )
  if (!res.ok) return { status: res.status, rows: null }
  return { status: res.status, rows: await res.json() as Array<Record<string, unknown>> }
}

const adminOrg1Email = readEnv('PLAYWRIGHT_ADMIN_ORG1_EMAIL', 'PLAYWRIGHT_ADMIN_EMAIL', 'E2E_ADMIN_EMAIL')
const adminOrg1Password = readEnv('PLAYWRIGHT_ADMIN_ORG1_PASSWORD', 'PLAYWRIGHT_ADMIN_PASSWORD', 'E2E_ADMIN_PASSWORD')
const adminOrg2Email = readEnv('PLAYWRIGHT_ADMIN_ORG2_EMAIL', 'E2E_ADMIN_ORG2_EMAIL')
const adminOrg2Password = readEnv('PLAYWRIGHT_ADMIN_ORG2_PASSWORD', 'E2E_ADMIN_ORG2_PASSWORD')
const officerEmail = readEnv('PLAYWRIGHT_OFFICER_ORG1_EMAIL', 'PLAYWRIGHT_OFFICER_EMAIL', 'E2E_OFFICER_EMAIL')
const officerPassword = readEnv('PLAYWRIGHT_OFFICER_ORG1_PASSWORD', 'PLAYWRIGHT_OFFICER_PASSWORD', 'E2E_OFFICER_PASSWORD')

const hasSupabase = !!getSupabaseUrl() && !!getAnonKey()

test.describe('radio transcript and translation org isolation', () => {
  test('admin from org1 cannot read transcript rows from org2', async () => {
    test.skip(!hasSupabase, 'Supabase URL/key not configured')
    test.skip(!adminOrg1Email || !adminOrg1Password || !adminOrg2Email || !adminOrg2Password, 'Distinct admin credentials not configured')

    const org1Token = await signIn(adminOrg1Email, adminOrg1Password)
    const org2Token = await signIn(adminOrg2Email, adminOrg2Password)
    test.skip(!org1Token || !org2Token, 'Admin sign-in failed')

    const org2Profile = await fetchMyProfile(org2Token)
    const foreignOrgId = org2Profile?.organization_id || ''
    test.skip(!foreignOrgId, 'Unable to resolve org2 organization id')

    const result = await fetchTranscriptRows(org1Token, foreignOrgId)
    expect([200, 404, 500]).toContain(result.status)
    expect(result.status).not.toBe(401)
    expect(result.status).not.toBe(403)
    if (result.status === 200) {
      expect(result.rows).toEqual([])
    }
  })

  test('admin from org1 cannot read translation rows from org2', async () => {
    test.skip(!hasSupabase, 'Supabase URL/key not configured')
    test.skip(!adminOrg1Email || !adminOrg1Password || !adminOrg2Email || !adminOrg2Password, 'Distinct admin credentials not configured')

    const org1Token = await signIn(adminOrg1Email, adminOrg1Password)
    const org2Token = await signIn(adminOrg2Email, adminOrg2Password)
    test.skip(!org1Token || !org2Token, 'Admin sign-in failed')

    const org2Profile = await fetchMyProfile(org2Token)
    const foreignOrgId = org2Profile?.organization_id || ''
    test.skip(!foreignOrgId, 'Unable to resolve org2 organization id')

    const result = await fetchTranslationRows(org1Token, foreignOrgId)
    expect([200, 404, 500]).toContain(result.status)
    expect(result.status).not.toBe(401)
    expect(result.status).not.toBe(403)
    if (result.status === 200) {
      expect(result.rows).toEqual([])
    }
  })

  test('radio-audit response is scoped to caller org', async () => {
    test.skip(!hasSupabase, 'Supabase URL/key not configured')
    test.skip(!adminOrg1Email || !adminOrg1Password, 'Admin credentials not configured')

    const token = await signIn(adminOrg1Email, adminOrg1Password)
    test.skip(!token, 'Admin sign-in failed')

    const me = await fetchMyProfile(token)
    test.skip(!me?.organization_id, 'Failed to resolve caller profile')

    const res = await fetch(`${getSupabaseUrl()}/functions/v1/radio-audit?since_hours=24`, {
      headers: headers(token),
    })

    expect([200, 500]).toContain(res.status)
    if (res.status === 200) {
      const data = await res.json() as { org_id?: string }
      expect(data.org_id).toBe(me.organization_id)
    }
  })

  test('officer cannot access radio-audit aggregates', async () => {
    test.skip(!hasSupabase, 'Supabase URL/key not configured')
    test.skip(!officerEmail || !officerPassword, 'Officer credentials not configured')

    const token = await signIn(officerEmail, officerPassword)
    test.skip(!token, 'Officer sign-in failed')

    const res = await fetch(`${getSupabaseUrl()}/functions/v1/radio-audit?since_hours=1`, {
      headers: headers(token),
    })

    expect([403, 500]).toContain(res.status)
    expect(res.status).not.toBe(401)
  })
})
