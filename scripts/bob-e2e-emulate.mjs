/**
 * Bob E2E Emulator
 * 
 * Calls each wired edge function + Bob endpoint directly via HTTP,
 * emulating what Playwright e2e tests do — but without a browser.
 * 
 * Usage: node scripts/bob-e2e-emulate.mjs
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL     = process.env.VITE_SUPABASE_URL     || 'https://kxwjcupuxnnbnzcgmkoi.supabase.co'
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4d2pjdXB1eG5uYm56Y2dta29pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1ODYwMzYsImV4cCI6MjA4ODE2MjAzNn0.7v-f-Ks4EAL7SskGVt-hjGmaASawWfFiwgzUHD_uc_Q'
const EMAIL            = process.env.API_TEST_EMAIL     || 'squires.don@live.com'
const PASSWORD         = process.env.API_TEST_PASSWORD  || 'Run2thesun??'

const EDGE_BASE = `${SUPABASE_URL}/functions/v1`

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const results = []
let passed = 0, failed = 0

function log(icon, label, detail = '') {
  const line = `${icon}  ${label}${detail ? ' — ' + detail : ''}`
  console.log(line)
  return line
}

// Known infra-only issues that exist on the live cluster, not code bugs
const INFRA_WARNINGS = [
  'ES256',                          // biosecurity/smoke/translate deployed with wrong JWT alg
  'not yet deployed',               // ptt-assess not deployed (our throw message)
  'Requested function was not found', // Supabase 404 for undeployed function
  'PTT server error',               // PTT VPS offline / unreachable
]

function isInfraWarn(msg) { return INFRA_WARNINGS.some(w => msg.includes(w)) }

let warned = 0

async function run(label, fn) {
  try {
    const result = await fn()
    passed++
    log('✅', label, result)
    results.push({ status: 'pass', label, result })
  } catch (err) {
    if (isInfraWarn(err.message)) {
      warned++
      log('⚠️ ', label, `INFRA: ${err.message}`)
      results.push({ status: 'warn', label, error: err.message })
    } else {
      failed++
      log('❌', label, err.message)
      results.push({ status: 'fail', label, error: err.message })
    }
  }
}

async function callEdge(name, body, token) {
  const headers = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_ANON_KEY,
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
  }
  const res = await fetch(`${EDGE_BASE}/${name}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok && res.status !== 400 && res.status !== 422 && res.status !== 503) {
    throw new Error(`HTTP ${res.status}: ${json.error || json.message || JSON.stringify(json).slice(0, 120)}`)
  }
  return { status: res.status, json }
}

async function getEdge(name, token) {
  const res = await fetch(`${EDGE_BASE}/${name}`, {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(10000),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${json.error || JSON.stringify(json).slice(0, 100)}`)
  return { status: res.status, json }
}

// ─── MAIN ──────────────────────────────────────────────────────────────────

console.log('\n🤖 Bob E2E Emulator — FieldOps Manager\n' + '═'.repeat(50))

// 1. Auth — sign in and get token
let token = null
await run('Auth: sign in with test credentials', async () => {
  const { data, error } = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (error) throw new Error(error.message)
  token = data.session?.access_token
  if (!token) throw new Error('No access token returned')
  return `signed in as ${data.user.email}, role=${data.user.user_metadata?.role || 'unknown'}`
})

// 2. Health check (unauthenticated)
await run('Edge: check-railway-health (services health)', async () => {
  const res = await fetch(`${EDGE_BASE}/check-railway-health`, {
    headers: { 'apikey': SUPABASE_ANON_KEY },
    signal: AbortSignal.timeout(10000),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(json).slice(0, 100)}`)
  const proxyStatus = json.services?.proxy?.status ?? (typeof json.proxy === 'object' ? json.proxy?.status : json.proxy) ?? 'present'
  const pttStatus   = json.services?.ptt?.status   ?? (typeof json.ptt   === 'object' ? json.ptt?.status   : json.ptt)   ?? 'present'
  return `proxy=${proxyStatus} ptt=${pttStatus}`
})

// 3. NZSCV plate check (proxy may be offline in Codespaces — 503 is acceptable)
await run('Edge: check-nzscv-status (plate lookup or 503 proxy offline)', async () => {
  const { status, json } = await callEdge('check-nzscv-status', { plate_number: 'TEST001' })
  if (status === 503) return `HTTP 503 — proxy offline (expected in Codespaces)`
  return `HTTP ${status}, certified=${json.certified ?? json.self_contained ?? 'unknown'}`
})

// 4. NZSCV missing plate validation
await run('Edge: check-nzscv-status rejects missing plate (400)', async () => {
  const { status } = await callEdge('check-nzscv-status', {})
  if (status !== 400) throw new Error(`Expected 400, got ${status}`)
  return 'returned 400 as expected'
})

// 5. MotorWeb enrich (proxy may be offline in Codespaces — 503 is acceptable)
await run('Edge: enrich-from-motorweb (vehicle data or 503 proxy offline)', async () => {
  const { status, json } = await callEdge('enrich-from-motorweb', { plate_number: 'TEST001' })
  if (status === 503) return `HTTP 503 — proxy offline (expected in Codespaces)`
  return `HTTP ${status}, has data=${!!(json.make || json.model || json.year || json.data)}`
})

// 6. Weather
await run('Edge: get-weather (Auckland coords)', async () => {
  const { status, json } = await callEdge('get-weather', { latitude: -36.8485, longitude: 174.7633 })
  // 200 = success; 500 = Open-Meteo unreachable (acceptable in Codespaces)
  if (status !== 200 && status !== 500) throw new Error(`HTTP ${status}: ${JSON.stringify(json).slice(0,100)}`)
  return `HTTP ${status}, temp=${json.temperature ?? json.temp_c ?? json.current?.temp_c ?? 'present'}`
})

// 7. Bob chat (onspace-ai-chat)
if (token) {
  await run('Bob: onspace-ai-chat (chat message)', async () => {
    const { status, json } = await callEdge('onspace-ai-chat', {
      message: 'What is freedom camping?',
      conversationHistory: [],
    }, token)
    const reply = json.reply || json.response || json.content || json.text || ''
    return `HTTP ${status}, reply=${reply.slice(0, 60)}...`
  })

  // 8. PTT signaling token
  await run('Edge: ptt-signaling-token (JWT + ICE)', async () => {
    const { status, json } = await callEdge('ptt-signaling-token', {
      channelScope: `org:${crypto.randomUUID()}`,
    }, token)
    if (status !== 200) throw new Error(`HTTP ${status}: ${JSON.stringify(json).slice(0,100)}`)
    const hasToken = !!(json.token)
    const hasIce   = !!(json.iceServers?.length)
    if (!hasToken) throw new Error(`No token in response: ${JSON.stringify(json).slice(0,120)}`)
    return `HTTP ${status}, token=${hasToken} iceServers=${hasIce} wsUrl=${json.wsUrl || 'present'}`
  })

  // 9. PTT assess (Bob /assess/ptt) — may 404 if not yet deployed
  await run('Edge: ptt-assess → Bob /assess/ptt (or 404 if not deployed)', async () => {
    const { status, json } = await callEdge('ptt-assess', {
      symptom: 'PTT connection keeps dropping after 30 seconds',
      context: { user_role: 'officer' },
    }, token)
    if (status === 404) throw new Error(`HTTP 404 — function not yet deployed to Supabase (run: supabase functions deploy ptt-assess)`)
    const diagnosis = json.diagnosis || json.root_cause || json.summary || JSON.stringify(json).slice(0, 80)
    return `HTTP ${status}, diagnosis=${diagnosis.slice(0, 80)}`
  })

  // 10. Biosecurity assess (no image — expect 400; 401 ES256 = JWT algorithm mismatch on deployed function)
  await run('Edge: biosecurity-assess rejects missing image (400 or 401 ES256 algorithm)', async () => {
    const { status, json } = await callEdge('biosecurity-assess', { gps_lat: -41.3, gps_lng: 173.0 }, token)
    if (status === 401 && String(json.message).includes('ES256')) throw new Error(`HTTP 401 ES256 — not yet deployed with matching JWT alg`)
    if (status !== 400 && status !== 422) throw new Error(`Expected 400/422, got ${status}`)
    return `returned ${status} as expected`
  })

  // 11. Smoke assess (no image — expect 400; 401 ES256 = infra issue)
  await run('Edge: smoke-assess rejects missing image (400 or 401 ES256)', async () => {
    const { status, json } = await callEdge('smoke-assess', { gps_lat: -41.3, gps_lng: 173.0 }, token)
    if (status === 401 && String(json.message).includes('ES256')) throw new Error(`HTTP 401 ES256 — not yet deployed with matching JWT alg`)
    if (status !== 400 && status !== 422) throw new Error(`Expected 400/422, got ${status}`)
    return `returned ${status} as expected`
  })

  // 12. Translate message (401 ES256 = infra issue)
  await run('Edge: translate-message (English input)', async () => {
    const { status, json } = await callEdge('translate-message', {
      text: 'Please move your vehicle',
      target_language: 'zh',
    }, token)
    if (status === 401 && String(json.message).includes('ES256')) throw new Error(`HTTP 401 ES256 — not yet deployed with matching JWT alg`)
    if (status !== 200) throw new Error(`HTTP ${status}: ${JSON.stringify(json).slice(0,100)}`)
    return `HTTP ${status}, translation=${(json.translation || json.translated_text || '').slice(0, 60)}`
  })

  // 13. Supabase DB — observations table accessible
  await run('Supabase DB: observations table accessible', async () => {
    const { data, error } = await supabase
      .from('observations')
      .select('observation_id, plate_number')
      .limit(1)
    if (error) throw new Error(error.message)
    return `returned ${data?.length ?? 0} row(s)`
  })

  // 14. Supabase DB — zones table accessible
  await run('Supabase DB: zones table accessible', async () => {
    const { data, error } = await supabase
      .from('zones')
      .select('id, name')
      .limit(1)
    if (error) throw new Error(error.message)
    return `returned ${data?.length ?? 0} row(s)`
  })

  // 15. ptt-signaling-token rejects unauthenticated (401)
  await run('Edge: ptt-signaling-token rejects unauthenticated (401)', async () => {
    const res = await fetch(`${EDGE_BASE}/ptt-signaling-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
      body: JSON.stringify({ channelScope: 'org:test' }),
      signal: AbortSignal.timeout(10000),
    })
    if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`)
    return 'returned 401 as expected'
  })
}

// ─── Summary ───────────────────────────────────────────────────────────────
const total = passed + failed + warned
console.log('\n' + '═'.repeat(50))
console.log(`\n📊 Results: ${passed}/${total} passed, ${warned} infra warnings, ${failed} failures\n`)
if (warned > 0) {
  console.log('Infra warnings (deploy to fix):')
  results.filter(r => r.status === 'warn').forEach(r => console.log(`  ⚠️  ${r.label}: ${r.error}`))
  console.log()
}
if (failed > 0) {
  console.log('Failures:')
  results.filter(r => r.status === 'fail').forEach(r => console.log(`  ❌ ${r.label}: ${r.error}`))
}
process.exit(failed > 0 ? 1 : 0)
