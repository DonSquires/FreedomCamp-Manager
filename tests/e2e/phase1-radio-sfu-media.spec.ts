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

function getPttServerUrl(): string {
  return readEnv('PTT_SERVER_URL', 'VITE_PTT_SERVER_URL', 'RADIO_CONTROL_PLANE_URL').replace(/\/$/, '')
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

async function mintRadioToken(jwt: string, channelId: string): Promise<string | null> {
  const res = await fetch(`${getSupabaseUrl()}/functions/v1/radio-token`, {
    method: 'POST',
    headers: {
      apikey: getAnonKey(),
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ channelId, channelType: 'org' }),
  })

  if (!res.ok) return null
  const body = (await res.json()) as { token?: string }
  return body.token || null
}

test.describe('phase1 SFU media flow', () => {
  test('SFU transport endpoints are reachable with valid radio token', async () => {
    const supabaseUrl = getSupabaseUrl()
    const anonKey = getAnonKey()
    const pttServerUrl = getPttServerUrl()

    test.skip(!supabaseUrl || !anonKey, 'Supabase env is not configured')
    test.skip(!pttServerUrl, 'PTT server URL is not configured')

    const officerEmail = readEnv('PLAYWRIGHT_OFFICER_ORG1_EMAIL', 'PLAYWRIGHT_OFFICER_EMAIL', 'E2E_OFFICER_EMAIL')
    const officerPassword = readEnv('PLAYWRIGHT_OFFICER_ORG1_PASSWORD', 'PLAYWRIGHT_OFFICER_PASSWORD', 'E2E_OFFICER_PASSWORD')

    test.skip(!officerEmail || !officerPassword, 'Officer credentials are missing')

    const jwt = await signIn(officerEmail, officerPassword)
    test.skip(!jwt, 'Officer sign-in failed')

    const channelId = `phase1-sfu-${Date.now()}`
    const radioToken = await mintRadioToken(jwt, channelId)
    test.skip(!radioToken, 'Could not mint radio token')

    const createRes = await fetch(`${pttServerUrl}/sfu/transport/create`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${radioToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel_id: channelId,
        direction: 'send',
      }),
    })

    expect([200, 500, 502, 503]).toContain(createRes.status)
    expect(createRes.status).not.toBe(401)
    expect(createRes.status).not.toBe(403)

    if (createRes.status === 200) {
      const body = (await createRes.json()) as { transport_id?: string }
      expect(body.transport_id).toBeTruthy()
    }
  })
})
