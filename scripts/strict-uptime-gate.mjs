#!/usr/bin/env node
import { config as loadEnv } from 'dotenv'

loadEnv({ path: '.env.local' })
loadEnv({ path: '.env.playwright.local' })

const SUPABASE_URL = String(process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '')
const ANON = String(process.env.VITE_SUPABASE_ANON_KEY || '')
const EMAIL = String(process.env.API_TEST_EMAIL || process.env.PLAYWRIGHT_ADMIN_EMAIL || '')
const PASSWORD = String(process.env.API_TEST_PASSWORD || process.env.PLAYWRIGHT_ADMIN_PASSWORD || '')

if (!SUPABASE_URL || !ANON || !EMAIL || !PASSWORD) {
  console.error('Missing required env vars: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, API_TEST_EMAIL, API_TEST_PASSWORD')
  process.exit(1)
}

function asText(v) {
  return typeof v === 'string' ? v : ''
}

function isHealthyStatus(v) {
  return String(v || '').toLowerCase() === 'ok'
}

async function authToken() {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body?.access_token) {
    throw new Error(`Auth failed (${res.status}): ${JSON.stringify(body)}`)
  }
  return body.access_token
}

function ab2b64(ab) {
  return Buffer.from(ab).toString('base64')
}

const checks = []
function record(name, ok, details) {
  checks.push({ name, ok, details })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} :: ${JSON.stringify(details)}`)
}

async function main() {
  const token = await authToken()
  const headers = { apikey: ANON, 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }

  // 1) Health aggregate
  const health = await fetch(`${SUPABASE_URL}/functions/v1/check-services-health`, { headers })
  const healthBody = await health.json().catch(() => ({}))
  record(
    'edge:check-services-health',
    health.ok && isHealthyStatus(healthBody?.proxy?.status) && isHealthyStatus(healthBody?.inference?.status) && isHealthyStatus(healthBody?.ptt?.status),
    {
      status: health.status,
      proxy: healthBody?.proxy?.status || null,
      inference: healthBody?.inference?.status || null,
      ptt: healthBody?.ptt?.status || null,
    },
  )

  // 2) Bob chat
  const bob = await fetch(`${SUPABASE_URL}/functions/v1/onspace-ai-chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Reply with EXACTLY BOB_OK' }], mode: 'analysis' }),
  })
  const bobBody = await bob.json().catch(() => ({}))
  const bobMsg = asText(bobBody?.response || bobBody?.message || bobBody?.reply)
  record(
    'edge:onspace-ai-chat',
    bob.ok && /BOB_OK/i.test(bobMsg) && String(bobBody?.provider || '').toLowerCase() !== 'local-fallback',
    {
      status: bob.status,
      provider: bobBody?.provider || null,
      model: bobBody?.model || null,
      excerpt: bobMsg.slice(0, 80),
      error: bobBody?.error || null,
    },
  )

  // 3) Translate
  const trn = await fetch(`${SUPABASE_URL}/functions/v1/translate-message`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ text: 'Kia ora team', target_language: 'zh' }),
  })
  const trnBody = await trn.json().catch(() => ({}))
  const translated = asText(trnBody?.translated_text)
  const provider = String(trnBody?.provider || '').toLowerCase()
  record(
    'edge:translate-message',
    trn.ok && translated.length > 0 && provider !== 'fallback' && provider !== 'browser_fallback' && provider !== 'client-fallback',
    {
      status: trn.status,
      provider: trnBody?.provider || null,
      warning: trnBody?.warning || null,
      error: trnBody?.error || null,
      excerpt: translated.slice(0, 60),
    },
  )

  // 4) PTT token
  let scope = 'global:emergency'
  const me = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } })
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
    headers,
    body: JSON.stringify({ channelScope: scope }),
  })
  const pttBody = await ptt.json().catch(() => ({}))
  record(
    'edge:ptt-signaling-token',
    ptt.ok && typeof pttBody?.token === 'string' && pttBody.token.length > 0,
    {
      status: ptt.status,
      scope,
      ws_url: pttBody?.wsUrl || pttBody?.ws_url || null,
      error: pttBody?.error || null,
    },
  )

  // 5) Synthesize speech -> real audio input for STT checks
  const synth = await fetch(`${SUPABASE_URL}/functions/v1/synthesize-speech`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ text: 'Hey Bob patrol update zone one', style: 'default' }),
  })

  const synthType = String(synth.headers.get('content-type') || '')
  let audioBase64 = ''
  let synthBody = {}
  if (synth.ok && synthType.includes('audio/wav')) {
    audioBase64 = ab2b64(await synth.arrayBuffer())
  } else {
    synthBody = await synth.json().catch(() => ({}))
    audioBase64 = asText(synthBody?.audio_base64)
  }

  record(
    'edge:synthesize-speech',
    synth.ok && audioBase64.length > 0,
    {
      status: synth.status,
      content_type: synthType || null,
      provider: synthBody?.provider || null,
      error: synthBody?.error || null,
      has_audio: audioBase64.length > 0,
    },
  )

  // 6) Whisper transcription strict (no client/browser fallback)
  const transcribe = await fetch(`${SUPABASE_URL}/functions/v1/transcribe-audio`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ audio_base64: audioBase64, audio_mime_type: 'audio/wav', language: 'en' }),
  })
  const transcribeBody = await transcribe.json().catch(() => ({}))
  const transcript = asText(transcribeBody?.transcript)
  const transcribeProvider = String(transcribeBody?.provider || '').toLowerCase()
  record(
    'edge:transcribe-audio',
    transcribe.ok && transcript.length >= 0 && transcribeProvider !== 'browser_fallback' && transcribeProvider !== 'client-fallback' && !transcribeBody?.client_action,
    {
      status: transcribe.status,
      provider: transcribeBody?.provider || null,
      has_transcript: typeof transcribeBody?.transcript === 'string',
      client_action: transcribeBody?.client_action || null,
      error: transcribeBody?.error || null,
    },
  )

  // 7) Speech intent strict
  const intentRes = await fetch(`${SUPABASE_URL}/functions/v1/speech-to-intent`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ audio_base64: audioBase64, language: 'en', context: { source: 'strict-uptime-gate' } }),
  })
  const intentBody = await intentRes.json().catch(() => ({}))
  record(
    'edge:speech-to-intent',
    intentRes.ok && typeof intentBody?.transcript === 'string' && typeof intentBody?.intent === 'object' && intentBody?.intent !== null,
    {
      status: intentRes.status,
      provider: intentBody?.provider || null,
      has_transcript: typeof intentBody?.transcript === 'string',
      intent: intentBody?.intent || null,
      error: intentBody?.error || intentBody?.message || intentBody?.detail || null,
    },
  )

  const failed = checks.filter((c) => !c.ok)
  console.log(`SUMMARY total=${checks.length} passed=${checks.length - failed.length} failed=${failed.length}`)
  process.exit(failed.length > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('FATAL', err?.message || String(err))
  process.exit(1)
})
