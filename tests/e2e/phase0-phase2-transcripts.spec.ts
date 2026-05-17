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

async function getUserContext(
  request: import('@playwright/test').APIRequestContext,
  token: string,
): Promise<{ userId: string; orgId: string; speakerName: string }> {
  const userResp = await request.get(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  })
  const userBody = await userResp.json().catch(() => ({})) as { id?: string; email?: string }
  expect(userResp.ok()).toBeTruthy()
  expect(typeof userBody.id).toBe('string')
  const userId = String(userBody.id)

  const profileResp = await request.get(
    `${SUPABASE_URL}/rest/v1/user_profiles?select=organization_id,first_name,last_name&id=eq.${encodeURIComponent(userId)}&limit=1`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } },
  )
  const profileRows = await profileResp.json().catch(() => []) as Array<{
    organization_id?: string
    first_name?: string
    last_name?: string
  }>
  expect(profileResp.ok()).toBeTruthy()
  expect(Array.isArray(profileRows) && profileRows.length > 0).toBeTruthy()

  const orgId = String(profileRows[0]?.organization_id || '')
  expect(orgId.length).toBeGreaterThan(0)
  const speakerName = `${profileRows[0]?.first_name || 'Phase0'} ${profileRows[0]?.last_name || 'Tester'}`.trim()

  return { userId, orgId, speakerName }
}

async function createTransmission(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  context: { userId: string; orgId: string; speakerName: string },
): Promise<{ id: string; channelId: string }> {
  const channelId = `phase0-contract-${Date.now()}`
  const response = await request.post(`${SUPABASE_URL}/rest/v1/radio_transmissions`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    data: {
      org_id: context.orgId,
      channel_id: channelId,
      channel_type: 'org',
      speaker_id: context.userId,
      speaker_name: context.speakerName,
      metadata: { source: 'phase0_phase2_contract_test' },
    },
  })

  const rows = await response.json().catch(() => []) as Array<{ id?: string }>
  expect(response.ok(), JSON.stringify(rows)).toBeTruthy()
  expect(Array.isArray(rows) && rows.length > 0 && typeof rows[0]?.id === 'string').toBeTruthy()

  return { id: String(rows[0].id), channelId }
}

test.describe('Phase 0-2 Streaming STT + Live Captions', () => {
  test.skip(
    !SUPABASE_URL || !SUPABASE_ANON_KEY || !TEST_EMAIL || !TEST_PASSWORD,
    'Requires VITE_SUPABASE_URL/SUPABASE_URL, VITE_SUPABASE_ANON_KEY/SUPABASE_ANON_KEY, and test credentials.',
  )

  test('transcript ingestion contract', async ({ request }) => {
    const token = await getAccessToken(request)
    test.skip(!token, 'Auth preflight failed for configured test credentials; skipping contract test in this environment.')
    const context = await getUserContext(request, token)
    const transmission = await createTransmission(request, token, context)

    const healthResponse = await request.post(`${SUPABASE_URL}/functions/v1/ingest-transcript-segments`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {
        action: 'health',
        orgId: context.orgId,
        channelId: transmission.channelId,
        transmissionId: transmission.id,
        provider: { name: 'google' },
        source: 'phase0_contract_test',
      },
    })
    const healthBody = await healthResponse.json().catch(() => ({})) as Record<string, unknown>
    expect(healthResponse.status(), JSON.stringify(healthBody)).toBe(200)
    expect(String((healthBody.health as Record<string, unknown> | undefined)?.provider || '')).toBe('google')

    const ingestResponse = await request.post(`${SUPABASE_URL}/functions/v1/ingest-transcript-segments`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {
        orgId: context.orgId,
        channelId: transmission.channelId,
        transmissionId: transmission.id,
        language: 'en',
        source: 'phase0_contract_test',
        provider: {
          name: 'google',
          requestId: `phase0-${Date.now()}`,
          model: 'chirp-2',
          region: 'australia-southeast1',
          latencyMs: 420,
          pipeline: 'livekit-egress-stt',
        },
        segments: [
          { sequenceNum: 1, startMs: 0, endMs: 1200, text: 'Unit responding to dispatch', confidence: 0.94, isFinal: true },
          { sequenceNum: 2, startMs: 1200, endMs: 2400, text: 'ETA five minutes', confidence: 0.91, isFinal: true },
        ],
      },
    })
    const ingestBody = await ingestResponse.json().catch(() => ({})) as Record<string, unknown>
    expect(ingestResponse.status(), JSON.stringify(ingestBody)).toBe(200)
    expect(Number(ingestBody.upserted || 0)).toBe(2)
    expect(String((ingestBody.trace as Record<string, unknown> | undefined)?.provider || '')).toBe('google')
    expect(String((ingestBody.trace as Record<string, unknown> | undefined)?.source || '')).toBe('phase0_contract_test')

    const verifyResponse = await request.get(
      `${SUPABASE_URL}/rest/v1/radio_transcript_segments?select=id,org_id,sequence_num,text&transmission_id=eq.${encodeURIComponent(transmission.id)}&order=sequence_num.asc`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } },
    )
    const verifyRows = await verifyResponse.json().catch(() => []) as Array<{
      org_id?: string
      sequence_num?: number
      text?: string
    }>
    expect(verifyResponse.ok(), JSON.stringify(verifyRows)).toBeTruthy()
    expect(verifyRows.length).toBeGreaterThanOrEqual(2)
    expect(verifyRows[0]?.sequence_num).toBe(1)
    expect(String(verifyRows[0]?.text || '').length).toBeGreaterThan(0)
    expect(verifyRows.every((row) => String(row.org_id || '') === context.orgId)).toBeTruthy()

    const crossOrgProbeResponse = await request.get(
      `${SUPABASE_URL}/rest/v1/radio_transcript_segments?select=id&org_id=neq.${encodeURIComponent(context.orgId)}&limit=1`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } },
    )
    const crossOrgRows = await crossOrgProbeResponse.json().catch(() => []) as Array<Record<string, unknown>>
    expect(crossOrgProbeResponse.ok(), JSON.stringify(crossOrgRows)).toBeTruthy()
    expect(crossOrgRows.length).toBe(0)
  })
})
