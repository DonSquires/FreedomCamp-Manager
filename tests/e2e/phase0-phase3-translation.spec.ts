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
  const userBody = await userResp.json().catch(() => ({})) as { id?: string }
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
  const channelId = `phase0-translation-${Date.now()}`
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
      metadata: { source: 'phase0_phase3_contract_test' },
    },
  })

  const rows = await response.json().catch(() => []) as Array<{ id?: string }>
  expect(response.ok(), JSON.stringify(rows)).toBeTruthy()
  expect(Array.isArray(rows) && rows.length > 0 && typeof rows[0]?.id === 'string').toBeTruthy()

  return { id: String(rows[0].id), channelId }
}

test.describe('Phase 0-3 Multi-Language Translation', () => {
  test.skip(
    !SUPABASE_URL || !SUPABASE_ANON_KEY || !TEST_EMAIL || !TEST_PASSWORD,
    'Requires VITE_SUPABASE_URL/SUPABASE_URL, VITE_SUPABASE_ANON_KEY/SUPABASE_ANON_KEY, and test credentials.',
  )

  test('translation pipeline contract', async ({ request }) => {
    const token = await getAccessToken(request)
    test.skip(!token, 'Auth preflight failed for configured test credentials; skipping contract test in this environment.')
    const context = await getUserContext(request, token)
    const transmission = await createTransmission(request, token, context)

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
        segments: [
          { sequenceNum: 1, startMs: 0, endMs: 1000, text: 'Please send backup to queen street', confidence: 0.95, isFinal: true },
        ],
      },
    })
    const ingestBody = await ingestResponse.json().catch(() => ({})) as Record<string, unknown>
    expect(ingestResponse.status(), JSON.stringify(ingestBody)).toBe(200)

    const translateResponse = await request.post(`${SUPABASE_URL}/functions/v1/translate-transcript-segments`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {
        orgId: context.orgId,
        transmissionId: transmission.id,
        targetLanguage: 'mi',
        segments: [
          {
            sequenceNum: 1,
            translatedText: 'Tukua he tautoko ki te tiriti o Queen',
            confidence: 0.89,
            provider: 'phase0-contract-test',
          },
        ],
      },
    })
    const translateBody = await translateResponse.json().catch(() => ({})) as Record<string, unknown>
    expect(translateResponse.status(), JSON.stringify(translateBody)).toBe(200)
    expect(Number(translateBody.upserted || 0)).toBe(1)

    const verifyResponse = await request.get(
      `${SUPABASE_URL}/rest/v1/radio_translation_segments?select=target_language,text,provider,transcript_segment_id&target_language=eq.mi&order=created_at.desc&limit=1`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } },
    )
    const verifyRows = await verifyResponse.json().catch(() => []) as Array<{ target_language?: string; text?: string }>
    expect(verifyResponse.ok(), JSON.stringify(verifyRows)).toBeTruthy()
    expect(Array.isArray(verifyRows) && verifyRows.length > 0).toBeTruthy()
    expect(verifyRows[0]?.target_language).toBe('mi')
    expect(String(verifyRows[0]?.text || '').length).toBeGreaterThan(0)
  })

  test('low-confidence translation is flagged', async ({ request }) => {
    const token = await getAccessToken(request)
    test.skip(!token, 'Auth preflight failed; skipping.')
    const context = await getUserContext(request, token)
    const transmission = await createTransmission(request, token, context)

    // Ingest source segment
    await request.post(`${SUPABASE_URL}/functions/v1/ingest-transcript-segments`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: {
        orgId: context.orgId,
        channelId: transmission.channelId,
        transmissionId: transmission.id,
        language: 'en',
        segments: [{ sequenceNum: 1, startMs: 0, endMs: 800, text: 'Unclear transmission', confidence: 0.9, isFinal: true }],
      },
    })

    // Translate with low confidence (< 0.65 threshold)
    const translateResponse = await request.post(`${SUPABASE_URL}/functions/v1/translate-transcript-segments`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: {
        orgId: context.orgId,
        transmissionId: transmission.id,
        targetLanguage: 'zh',
        segments: [{ sequenceNum: 1, translatedText: '不清楚的传输', confidence: 0.42, provider: 'low-conf-test' }],
      },
    })
    expect(translateResponse.status()).toBe(200)

    // Verify is_low_confidence is stored as true
    const verifyResp = await request.get(
      `${SUPABASE_URL}/rest/v1/radio_translation_segments?select=confidence,is_low_confidence&target_language=eq.zh&order=created_at.desc&limit=1`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } },
    )
    const rows = await verifyResp.json().catch(() => []) as Array<{ confidence?: number; is_low_confidence?: boolean }>
    expect(verifyResp.ok()).toBeTruthy()
    expect(Array.isArray(rows) && rows.length > 0).toBeTruthy()
    expect(rows[0]?.is_low_confidence).toBe(true)
  })

  test('org isolation: cross-org transmission returns 404 from translate endpoint', async ({ request }) => {
    const token = await getAccessToken(request)
    test.skip(!token, 'Auth preflight failed; skipping.')
    const context = await getUserContext(request, token)

    // Attempt to translate against a fabricated transmission_id from a different org uuid
    const foreignOrgId = '00000000-0000-0000-0000-000000000001'
    const foreignTransmissionId = '00000000-0000-0000-0000-000000000002'

    const translateResponse = await request.post(`${SUPABASE_URL}/functions/v1/translate-transcript-segments`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: {
        orgId: foreignOrgId,
        transmissionId: foreignTransmissionId,
        targetLanguage: 'fr',
        segments: [{ sequenceNum: 1, translatedText: 'isolement de test', confidence: 0.9 }],
      },
    })
    // Expect 404 (no segments found) or 400/403 — not 200
    expect(translateResponse.status(), 'Cross-org translate must not return 200').not.toBe(200)
  })

  test('RLS: cross-org translation rows are not readable', async ({ request }) => {
    const token = await getAccessToken(request)
    test.skip(!token, 'Auth preflight failed; skipping.')
    const context = await getUserContext(request, token)

    // Query for translation segments belonging to a different org_id
    const foreignOrgId = '00000000-0000-0000-0000-000000000001'
    const crossOrgResp = await request.get(
      `${SUPABASE_URL}/rest/v1/radio_translation_segments?select=id,org_id&org_id=eq.${encodeURIComponent(foreignOrgId)}&limit=10`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } },
    )
    const crossOrgRows = await crossOrgResp.json().catch(() => []) as unknown[]
    expect(crossOrgResp.ok()).toBeTruthy()
    expect(Array.isArray(crossOrgRows) && crossOrgRows.length).toBe(0)
  })
})

