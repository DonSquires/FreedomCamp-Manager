import { expect, test } from '@playwright/test'

const SUPABASE_URL = String(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, '')
const SUPABASE_ANON_KEY = String(process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim()
const TEST_EMAIL = String(
  process.env.API_TEST_EMAIL || process.env.PLAYWRIGHT_ADMIN_EMAIL || process.env.PLAYWRIGHT_OFFICER_EMAIL || ''
).trim()
const TEST_PASSWORD = String(
  process.env.API_TEST_PASSWORD || process.env.PLAYWRIGHT_ADMIN_PASSWORD || process.env.PLAYWRIGHT_OFFICER_PASSWORD || ''
).trim()

async function getAccessToken(request: import('@playwright/test').APIRequestContext): Promise<string | null> {
  const response = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    data: {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    },
  })

  const body = await response.json().catch(() => ({})) as { access_token?: string; error_description?: string }
  if (!response.ok() || typeof body.access_token !== 'string') {
    return null
  }
  return String(body.access_token)
}

test.describe('Phase 0-1 SFU Connectivity', () => {
  test.skip(
    !SUPABASE_URL || !SUPABASE_ANON_KEY || !TEST_EMAIL || !TEST_PASSWORD,
    'Requires VITE_SUPABASE_URL/SUPABASE_URL, VITE_SUPABASE_ANON_KEY/SUPABASE_ANON_KEY, and test credentials.',
  )

  test('radio-session-grant endpoint contract is reachable with auth', async ({ request }) => {
    const token = await getAccessToken(request)
    test.skip(!token, 'Auth preflight failed for configured test credentials; skipping contract test in this environment.')
    const channelScope = `org:phase0-${Date.now()}`

    const response = await request.post(`${SUPABASE_URL}/functions/v1/radio-session-grant`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: { channelScope },
    })

    const body = await response.json().catch(() => ({})) as Record<string, unknown>

    // Contract-level assertion: endpoint exists and responds with managed failure/success.
    expect(response.status(), JSON.stringify(body)).not.toBe(404)
    expect([200, 501, 502, 503]).toContain(response.status())

    if (response.status() === 200) {
      expect(String(body.channelScope || '')).toBe(channelScope)
    } else {
      expect(typeof body.error).toBe('string')
    }
  })
})
