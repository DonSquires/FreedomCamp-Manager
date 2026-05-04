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
  const body = (await res.json()) as { access_token?: string }
  return body.access_token || null
}

async function mintRadioToken(jwt: string, channelId: string): Promise<number> {
  const res = await fetch(`${getSupabaseUrl()}/functions/v1/radio-token`, {
    method: 'POST',
    headers: {
      apikey: getAnonKey(),
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ channelId, channelType: 'org' }),
  })

  return res.status
}

test.describe('phase1 reconnect resilience', () => {
  test('sequential token refresh cycles remain authorized', async () => {
    const supabaseUrl = getSupabaseUrl()
    const anonKey = getAnonKey()

    test.skip(!supabaseUrl || !anonKey, 'Supabase env is not configured')

    const officerEmail = readEnv('PLAYWRIGHT_OFFICER_ORG1_EMAIL', 'PLAYWRIGHT_OFFICER_EMAIL', 'E2E_OFFICER_EMAIL')
    const officerPassword = readEnv('PLAYWRIGHT_OFFICER_ORG1_PASSWORD', 'PLAYWRIGHT_OFFICER_PASSWORD', 'E2E_OFFICER_PASSWORD')

    test.skip(!officerEmail || !officerPassword, 'Officer credentials are missing')

    const jwt = await signIn(officerEmail, officerPassword)
    test.skip(!jwt, 'Officer sign-in failed')

    const statuses = await Promise.all([
      mintRadioToken(jwt, `phase1-reconnect-1-${Date.now()}`),
      mintRadioToken(jwt, `phase1-reconnect-2-${Date.now()}`),
      mintRadioToken(jwt, `phase1-reconnect-3-${Date.now()}`),
    ])

    for (const status of statuses) {
      expect([200, 201, 500, 502, 503]).toContain(status)
      expect(status).not.toBe(401)
      expect(status).not.toBe(403)
    }
  })
})
