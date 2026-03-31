#!/usr/bin/env node
import { config as loadEnv } from 'dotenv'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

loadEnv({ path: '.env.local' })
loadEnv({ path: '.env.playwright.local' })

const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
const ANON = process.env.VITE_SUPABASE_ANON_KEY || ''
const EMAIL = process.env.API_TEST_EMAIL || process.env.PLAYWRIGHT_ADMIN_EMAIL || ''
const PASSWORD = process.env.API_TEST_PASSWORD || process.env.PLAYWRIGHT_ADMIN_PASSWORD || ''

if (!SUPABASE_URL || !ANON || !EMAIL || !PASSWORD) {
  console.error('Missing required env vars for live checks')
  process.exit(1)
}

const results = []
const add = (name, ok, details) => results.push({ name, ok, details })

const jsonHeaders = {
  apikey: ANON,
  'Content-Type': 'application/json',
}

async function getToken() {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || !body?.access_token) {
    throw new Error(`Auth failed (${response.status}): ${JSON.stringify(body)}`)
  }
  return body.access_token
}

async function run() {
  const token = await getToken()
  const authHeaders = { ...jsonHeaders, Authorization: `Bearer ${token}` }

  // 1) Railway health (source of live service URLs)
  const health = await fetch(`${SUPABASE_URL}/functions/v1/check-railway-health`, {
    method: 'GET',
    headers: authHeaders,
  })
  const healthBody = await health.json().catch(() => ({}))
  const inferenceUrl = (healthBody?.inference_url || healthBody?.inference?.url || '').replace(/\/$/, '')
  add('edge:check-railway-health', health.ok, {
    status: health.status,
    inference_url_present: Boolean(inferenceUrl),
    proxy_status: healthBody?.proxy?.status || null,
    inference_status: healthBody?.inference?.status || null,
  })

  // 2) AI chat endpoint
  const ai = await fetch(`${SUPABASE_URL}/functions/v1/onspace-ai-chat`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Reply with one sentence: what is freedom camping in NZ?' }],
      mode: 'analysis',
    }),
  })
  const aiBody = await ai.json().catch(() => ({}))
  const aiMessage = aiBody?.response || aiBody?.message || aiBody?.reply || ''
  add('edge:onspace-ai-chat', ai.ok && typeof aiMessage === 'string' && aiMessage.length > 10, {
    status: ai.status,
    response_excerpt: String(aiMessage).slice(0, 120),
    error: aiBody?.error || null,
    details: aiBody?.details || null,
  })

  // 3) PTT token mint endpoint
  let scope = 'org:test'
  const me = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON, Authorization: `Bearer ${token}` },
  })
  const meBody = await me.json().catch(() => ({}))
  if (meBody?.id) {
    const profile = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?select=organization_id&id=eq.${meBody.id}&limit=1`, {
      headers: { apikey: ANON, Authorization: `Bearer ${token}` },
    })
    const rows = await profile.json().catch(() => [])
    const orgId = rows?.[0]?.organization_id
    if (orgId) scope = `org:${orgId}`
  }

  const ptt = await fetch(`${SUPABASE_URL}/functions/v1/ptt-signaling-token`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ channelScope: scope }),
  })
  const pttBody = await ptt.json().catch(() => ({}))
  add('edge:ptt-signaling-token', ptt.ok && Boolean(pttBody?.token), {
    status: ptt.status,
    channel_scope: scope,
    token_present: Boolean(pttBody?.token),
    ws_url_present: Boolean(pttBody?.wsUrl || pttBody?.ws_url),
    error: pttBody?.error || null,
    details: pttBody?.details || pttBody?.message || null,
  })

  // 4) Face scan edge function
  const faceScan = await fetch(`${SUPABASE_URL}/functions/v1/process-face-scan`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      mode: 'detect',
      photo_url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800',
      save_record: false,
    }),
  })
  const faceScanBody = await faceScan.json().catch(() => ({}))
  add('edge:process-face-scan', faceScan.ok, {
    status: faceScan.status,
    face_count: faceScanBody?.face_count ?? faceScanBody?.data?.face_count ?? null,
    has_faces: Boolean(faceScanBody?.faces || faceScanBody?.data?.faces),
    error: faceScanBody?.error || null,
  })

  // 5) Inference service endpoints
  if (inferenceUrl) {
    const inferHealth = await fetch(`${inferenceUrl}/health`)
    const inferHealthBody = await inferHealth.json().catch(() => ({}))
    add('inference:/health', inferHealth.ok, {
      status: inferHealth.status,
      model_status: inferHealthBody?.models || null,
      capabilities: inferHealthBody?.capabilities || null,
    })

    const imageUrl = 'https://images.unsplash.com/photo-1493238792000-8113da705763?w=1200'
    const imageResponse = await fetch(imageUrl)
    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer())
    const tmpImage = join(tmpdir(), 'fcm-live-infer.jpg')
    writeFileSync(tmpImage, imageBuffer)

    const form = new FormData()
    form.append('photo', new Blob([imageBuffer], { type: 'image/jpeg' }), 'fcm-live-infer.jpg')

    const infer = await fetch(`${inferenceUrl}/infer`, {
      method: 'POST',
      body: form,
    })
    const inferBody = await infer.json().catch(() => ({}))
    add('inference:/infer', infer.ok, {
      status: infer.status,
      success: inferBody?.success ?? null,
      plate_number: inferBody?.plate_number ?? inferBody?.data?.plate_number ?? null,
      vehicle_detected: inferBody?.vehicle_detected ?? inferBody?.data?.vehicle_detected ?? null,
      error: inferBody?.error || null,
    })
  } else {
    add('inference:url', false, { error: 'No inference URL available from check-railway-health' })
  }

  console.log('=== LIVE FUNCTIONAL CHECK REPORT ===')
  let failed = 0
  for (const row of results) {
    if (!row.ok) failed += 1
    console.log(`${row.ok ? 'PASS' : 'FAIL'} ${row.name} :: ${JSON.stringify(row.details)}`)
  }
  console.log(`SUMMARY total=${results.length} passed=${results.length - failed} failed=${failed}`)

  process.exit(failed > 0 ? 1 : 0)
}

run().catch((err) => {
  console.error('FATAL', err?.message || String(err))
  process.exit(1)
})
