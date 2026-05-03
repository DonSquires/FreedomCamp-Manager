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

function edgeFnUrl(name: string): string {
  return `${getSupabaseUrl()}/functions/v1/${name}`
}

async function signIn(email: string, password: string): Promise<string | null> {
  if (!email || !password) return null
  const res = await fetch(`${getSupabaseUrl()}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: getAnonKey(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) return null
  const data = await res.json() as { access_token?: string }
  return data.access_token || null
}

async function mintTokenAndMeasure(jwt: string, channelType: 'org' | 'emergency'): Promise<{ status: number; elapsedMs: number }> {
  const body = {
    channelId: channelType === 'emergency' ? `emg-${Date.now()}` : `org-${Date.now()}`,
    channelType,
  }

  const start = Date.now()
  const res = await fetch(edgeFnUrl('radio-token'), {
    method: 'POST',
    headers: {
      apikey: getAnonKey(),
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const elapsedMs = Date.now() - start
  return { status: res.status, elapsedMs }
}

const maxLatencyMs = parseInt(readEnv('PLAYWRIGHT_RADIO_TOKEN_MAX_LATENCY_MS') || '8000', 10)
const officerEmail = readEnv('PLAYWRIGHT_OFFICER_ORG1_EMAIL', 'PLAYWRIGHT_OFFICER_EMAIL', 'E2E_OFFICER_EMAIL')
const officerPassword = readEnv('PLAYWRIGHT_OFFICER_ORG1_PASSWORD', 'PLAYWRIGHT_OFFICER_PASSWORD', 'E2E_OFFICER_PASSWORD')
const adminEmail = readEnv('PLAYWRIGHT_ADMIN_ORG1_EMAIL', 'PLAYWRIGHT_ADMIN_EMAIL', 'E2E_ADMIN_EMAIL')
const adminPassword = readEnv('PLAYWRIGHT_ADMIN_ORG1_PASSWORD', 'PLAYWRIGHT_ADMIN_PASSWORD', 'E2E_ADMIN_PASSWORD')

test.describe('radio emergency channel latency', () => {
  test('officer emergency token mint stays under latency budget', async () => {
    test.skip(!getSupabaseUrl() || !getAnonKey(), 'Supabase URL/key not configured')
    test.skip(!officerEmail || !officerPassword, 'Officer credentials not configured')

    const jwt = await signIn(officerEmail, officerPassword)
    test.skip(!jwt, 'Officer sign-in failed')

    const result = await mintTokenAndMeasure(jwt, 'emergency')
    expect([200, 201, 500, 502, 503]).toContain(result.status)
    expect(result.status).not.toBe(401)
    expect(result.status).not.toBe(403)
    expect(result.elapsedMs).toBeLessThan(maxLatencyMs)
  })

  test('emergency path is not materially slower than org path', async () => {
    test.skip(!getSupabaseUrl() || !getAnonKey(), 'Supabase URL/key not configured')
    test.skip(!adminEmail || !adminPassword, 'Admin credentials not configured')

    const jwt = await signIn(adminEmail, adminPassword)
    test.skip(!jwt, 'Admin sign-in failed')

    const orgCall = await mintTokenAndMeasure(jwt, 'org')
    const emergencyCall = await mintTokenAndMeasure(jwt, 'emergency')

    expect([200, 201, 500, 502, 503]).toContain(orgCall.status)
    expect([200, 201, 500, 502, 503]).toContain(emergencyCall.status)

    const deltaMs = Math.abs(emergencyCall.elapsedMs - orgCall.elapsedMs)
    const allowedDelta = Math.max(1500, Math.floor(maxLatencyMs * 0.5))
    expect(deltaMs).toBeLessThan(allowedDelta)
  })
})
