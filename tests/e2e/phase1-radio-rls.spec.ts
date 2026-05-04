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
  const body = (await res.json()) as { access_token?: string }
  return body.access_token || null
}

async function fetchOrgId(token: string): Promise<string | null> {
  const res = await fetch(`${getSupabaseUrl()}/rest/v1/user_profiles?select=organization_id&limit=1`, {
    headers: headers(token),
  })
  if (!res.ok) return null
  const rows = (await res.json()) as Array<{ organization_id?: string }>
  return rows?.[0]?.organization_id || null
}

test.describe('phase1 radio RLS', () => {
  test('officer from org A cannot read org B transmissions', async () => {
    const supabaseUrl = getSupabaseUrl()
    const anonKey = getAnonKey()

    test.skip(!supabaseUrl || !anonKey, 'Supabase env is not configured')

    const orgAEmail = readEnv('PLAYWRIGHT_OFFICER_ORG1_EMAIL', 'PLAYWRIGHT_OFFICER_EMAIL', 'E2E_OFFICER_EMAIL')
    const orgAPassword = readEnv('PLAYWRIGHT_OFFICER_ORG1_PASSWORD', 'PLAYWRIGHT_OFFICER_PASSWORD', 'E2E_OFFICER_PASSWORD')
    const orgBEmail = readEnv('PLAYWRIGHT_OFFICER_ORG2_EMAIL', 'E2E_OFFICER_ORG2_EMAIL')
    const orgBPassword = readEnv('PLAYWRIGHT_OFFICER_ORG2_PASSWORD', 'E2E_OFFICER_ORG2_PASSWORD')

    test.skip(!orgAEmail || !orgAPassword || !orgBEmail || !orgBPassword, 'Cross-org officer credentials missing')

    const orgAToken = await signIn(orgAEmail, orgAPassword)
    const orgBToken = await signIn(orgBEmail, orgBPassword)

    test.skip(!orgAToken || !orgBToken, 'Sign-in failed for one or more users')

    const orgBId = await fetchOrgId(orgBToken)
    test.skip(!orgBId, 'Could not resolve org B id')

    const query = `${supabaseUrl}/rest/v1/radio_transmissions?select=id,org_id,speaker_id,started_at&org_id=eq.${orgBId}&limit=5`
    const res = await fetch(query, { headers: headers(orgAToken) })

    expect([200, 404, 500]).toContain(res.status)
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(403)

    if (res.status === 200) {
      const rows = (await res.json()) as Array<Record<string, unknown>>
      expect(rows).toEqual([])
    }
  })
})
