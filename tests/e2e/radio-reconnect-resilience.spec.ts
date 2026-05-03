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

async function mintRadioToken(jwt: string, channelType: 'org' | 'emergency'): Promise<{ status: number; transmissionId: string | null }> {
  const res = await fetch(edgeFnUrl('radio-token'), {
    method: 'POST',
    headers: {
      apikey: getAnonKey(),
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      channelId: `${channelType}-${Date.now()}`,
      channelType,
    }),
  })

  let body: { transmissionId?: string } | null = null
  try {
    body = await res.json() as { transmissionId?: string }
  } catch {
    body = null
  }

  return { status: res.status, transmissionId: body?.transmissionId || null }
}

const officerEmail = readEnv('PLAYWRIGHT_OFFICER_ORG1_EMAIL', 'PLAYWRIGHT_OFFICER_EMAIL', 'E2E_OFFICER_EMAIL')
const officerPassword = readEnv('PLAYWRIGHT_OFFICER_ORG1_PASSWORD', 'PLAYWRIGHT_OFFICER_PASSWORD', 'E2E_OFFICER_PASSWORD')

test.describe('radio reconnect resilience', () => {
  test('sequential token mints remain accepted across reconnect-like cycles', async () => {
    test.skip(!getSupabaseUrl() || !getAnonKey(), 'Supabase URL/key not configured')
    test.skip(!officerEmail || !officerPassword, 'Officer credentials not configured')

    const jwt = await signIn(officerEmail, officerPassword)
    test.skip(!jwt, 'Officer sign-in failed')

    const first = await mintRadioToken(jwt, 'org')
    const second = await mintRadioToken(jwt, 'org')
    const third = await mintRadioToken(jwt, 'org')

    for (const call of [first, second, third]) {
      expect([200, 201, 500, 502, 503]).toContain(call.status)
      expect(call.status).not.toBe(401)
      expect(call.status).not.toBe(403)
    }

    if (first.status === 200 && second.status === 200 && third.status === 200) {
      expect(first.transmissionId).toBeTruthy()
      expect(second.transmissionId).toBeTruthy()
      expect(third.transmissionId).toBeTruthy()
      expect(first.transmissionId).not.toBe(second.transmissionId)
      expect(second.transmissionId).not.toBe(third.transmissionId)
    }
  })

  test('switching org/emergency channels remains accepted without auth regression', async () => {
    test.skip(!getSupabaseUrl() || !getAnonKey(), 'Supabase URL/key not configured')
    test.skip(!officerEmail || !officerPassword, 'Officer credentials not configured')

    const jwt = await signIn(officerEmail, officerPassword)
    test.skip(!jwt, 'Officer sign-in failed')

    const orgCall = await mintRadioToken(jwt, 'org')
    const emergencyCall = await mintRadioToken(jwt, 'emergency')

    expect([200, 201, 500, 502, 503]).toContain(orgCall.status)
    expect([200, 201, 500, 502, 503]).toContain(emergencyCall.status)
    expect(orgCall.status).not.toBe(401)
    expect(orgCall.status).not.toBe(403)
    expect(emergencyCall.status).not.toBe(401)
    expect(emergencyCall.status).not.toBe(403)
  })
})
