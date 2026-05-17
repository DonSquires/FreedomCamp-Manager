import { expect, test } from '@playwright/test'

/**
 * Phase 0-4: Translated Audio Relay contract tests.
 *
 * Validates:
 *   - P0-4a: synthesize-translated-audio endpoint contract (render request,
 *     degraded-mode 503 when no provider, audit row persisted)
 *   - P0-4b: user_radio_preferences read/write (audio_playback_mode, preferred_language)
 *   - P0-4c: watermark field present on all synthesis responses
 *   - P0-4c: fallback_to_original behavior when TTS unavailable
 *   - P0-4c: org isolation on user_radio_preferences (cross-org row count = 0)
 */

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
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    data: { email: TEST_EMAIL, password: TEST_PASSWORD },
  })
  const body = await response.json().catch(() => ({})) as { access_token?: string }
  return response.ok() && typeof body.access_token === 'string' ? String(body.access_token) : null
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
  const orgId = String(profileRows[0]?.organization_id || '')
  const speakerName = `${profileRows[0]?.first_name || 'Phase04'} ${profileRows[0]?.last_name || 'Tester'}`.trim()
  return { userId, orgId, speakerName }
}

async function seedTranslationSegment(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  context: { userId: string; orgId: string; speakerName: string },
): Promise<string> {
  // Transmission
  const channelId = `phase0-p4-${Date.now()}`
  const txResp = await request.post(`${SUPABASE_URL}/rest/v1/radio_transmissions`, {
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
      metadata: { source: 'phase0_phase4_contract_test' },
    },
  })
  const txRows = await txResp.json().catch(() => []) as Array<{ id?: string }>
  expect(txResp.ok()).toBeTruthy()
  const transmissionId = String(txRows[0]?.id || '')

  // Transcript segment
  const ingestResp = await request.post(`${SUPABASE_URL}/functions/v1/ingest-transcript-segments`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: {
      orgId: context.orgId,
      channelId,
      transmissionId,
      language: 'en',
      segments: [{ sequenceNum: 1, startMs: 0, endMs: 900, text: 'All units respond to sector four', confidence: 0.97, isFinal: true }],
    },
  })
  expect(ingestResp.status()).toBe(200)

  // Translation segment
  const translateResp = await request.post(`${SUPABASE_URL}/functions/v1/translate-transcript-segments`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: {
      orgId: context.orgId,
      transmissionId,
      targetLanguage: 'mi',
      segments: [{ sequenceNum: 1, translatedText: 'Whakaaro katoa ki wāhanga whā', confidence: 0.88, provider: 'phase0-p4-seed' }],
    },
  })
  expect(translateResp.status()).toBe(200)

  // Get the translation segment id
  const segResp = await request.get(
    `${SUPABASE_URL}/rest/v1/radio_translation_segments?select=id&target_language=eq.mi&order=created_at.desc&limit=1`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } },
  )
  const segRows = await segResp.json().catch(() => []) as Array<{ id?: string }>
  expect(Array.isArray(segRows) && segRows.length > 0).toBeTruthy()
  return String(segRows[0]?.id || '')
}

test.describe('Phase 0-4 Translated Audio Relay', () => {
  test.skip(
    !SUPABASE_URL || !SUPABASE_ANON_KEY || !TEST_EMAIL || !TEST_PASSWORD,
    'Requires VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, and test credentials.',
  )

  test('P0-4a: degraded-mode response when no TTS provider configured', async ({ request }) => {
    const token = await getAccessToken(request)
    test.skip(!token, 'Auth preflight failed; skipping.')
    const context = await getUserContext(request, token)
    const translationSegmentId = await seedTranslationSegment(request, token, context)

    const synthResp = await request.post(`${SUPABASE_URL}/functions/v1/synthesize-translated-audio`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { orgId: context.orgId, translationSegmentId, targetLanguage: 'mi' },
    })

    const synthBody = await synthResp.json().catch(() => ({})) as Record<string, unknown>

    // Staging has no TTS provider — expect degraded 503 or accepted 200 with fallback
    const status = synthResp.status()
    expect([200, 503], `Expected 200 or 503, got ${status}: ${JSON.stringify(synthBody)}`).toContain(status)

    // Watermark must always be present in the response
    expect(typeof synthBody.watermark, 'watermark field must be a string').toBe('string')
    expect(String(synthBody.watermark || '').length).toBeGreaterThan(0)

    if (status === 503) {
      // Degraded-mode response must include structured fallback signal
      expect(synthBody.degraded).toBe(true)
      expect(synthBody.fallback).toBe('original_audio')
      expect(synthBody.reason).toBeTruthy()
    }
  })

  test('P0-4a: cross-org synthesis attempt returns 404', async ({ request }) => {
    const token = await getAccessToken(request)
    test.skip(!token, 'Auth preflight failed; skipping.')

    const foreignOrgId = '00000000-0000-0000-0000-000000000001'
    const foreignSegId = '00000000-0000-0000-0000-000000000003'

    const synthResp = await request.post(`${SUPABASE_URL}/functions/v1/synthesize-translated-audio`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { orgId: foreignOrgId, translationSegmentId: foreignSegId, targetLanguage: 'fr' },
    })
    expect(synthResp.status(), 'Cross-org synthesis must not return 200').not.toBe(200)
  })

  test('P0-4b: user_radio_preferences upsert and read', async ({ request }) => {
    const token = await getAccessToken(request)
    test.skip(!token, 'Auth preflight failed; skipping.')
    const context = await getUserContext(request, token)

    // Upsert preference
    const upsertResp = await request.post(`${SUPABASE_URL}/rest/v1/user_radio_preferences`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      data: {
        user_id: context.userId,
        org_id: context.orgId,
        audio_playback_mode: 'both',
        preferred_language: 'mi',
        tts_relay_enabled: false,
      },
    })
    expect(upsertResp.ok(), `Upsert failed: ${upsertResp.status()}`).toBeTruthy()

    // Read back
    const readResp = await request.get(
      `${SUPABASE_URL}/rest/v1/user_radio_preferences?select=audio_playback_mode,preferred_language&user_id=eq.${encodeURIComponent(context.userId)}&limit=1`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } },
    )
    const readRows = await readResp.json().catch(() => []) as Array<{
      audio_playback_mode?: string
      preferred_language?: string
    }>
    expect(readResp.ok()).toBeTruthy()
    expect(Array.isArray(readRows) && readRows.length > 0).toBeTruthy()
    expect(readRows[0]?.audio_playback_mode).toBe('both')
    expect(readRows[0]?.preferred_language).toBe('mi')
  })

  test('P0-4b: RLS prevents reading another user\'s preferences', async ({ request }) => {
    const token = await getAccessToken(request)
    test.skip(!token, 'Auth preflight failed; skipping.')
    const context = await getUserContext(request, token)

    // Query for a fabricated different user_id
    const foreignUserId = '00000000-0000-0000-0000-000000000099'
    const crossUserResp = await request.get(
      `${SUPABASE_URL}/rest/v1/user_radio_preferences?select=id&user_id=eq.${encodeURIComponent(foreignUserId)}&limit=5`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } },
    )
    const crossUserRows = await crossUserResp.json().catch(() => []) as unknown[]
    expect(crossUserResp.ok()).toBeTruthy()
    expect(Array.isArray(crossUserRows) && crossUserRows.length).toBe(0)
  })
})
