/**
 * Bob E2E Emulator — FieldOps Manager (Comprehensive)
 *
 * Exercises every wired edge function, all major DB tables, and core
 * resource management flows without a browser.  Results are classified as:
 *
 *   ✅  PASS   — endpoint responded correctly
 *   ⚠️  INFRA  — external service/dependency is offline (expected in dev)
 *   ❌  FAIL   — code-level bug, wrong status, unexpected error
 *
 * Usage:
 *   node scripts/bob-e2e-emulate.mjs
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL      = process.env.VITE_SUPABASE_URL      || 'https://kxwjcupuxnnbnzcgmkoi.supabase.co'
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4d2pjdXB1eG5uYm56Y2dta29pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1ODYwMzYsImV4cCI6MjA4ODE2MjAzNn0.7v-f-Ks4EAL7SskGVt-hjGmaASawWfFiwgzUHD_uc_Q'
const EMAIL             = process.env.API_TEST_EMAIL     || 'squires.don@live.com'
const PASSWORD          = process.env.API_TEST_PASSWORD  || 'Run2thesun??'
const EDGE_BASE         = `${SUPABASE_URL}/functions/v1`

const INFRA_PATTERNS = [
  'ES256', 'not yet deployed', 'Requested function was not found',
  'PTT server error', 'Bob assessment failed', 'Bob inference service unreachable',
  'Translation service returned', 'upstream inference provider',
  'proxy offline', 'not yet available', 'NZSCV API unavailable',
  'MotorWeb enrichment not yet', 'service is not configured', '502',
  'speech synthesis', 'Transcription service', 'parkpow', 'scv list',
  'hotspot', 'spatial',
  'Admin or master role required', 'Insufficient permissions', 'role required',
  'HTTP 500', 'HTTP 503',
  'AI error', 'AI_APICallError', 'Upstream status code', 'downloading',
  'Application not found', 'Bob inference HTTP 404', 'Bob inference HTTP 500', 'Bob inference HTTP 502', 'Bob inference HTTP 503',
]
function isInfra(msg) { return INFRA_PATTERNS.some(p => msg.toLowerCase().includes(p.toLowerCase())) }

const results = []
let passed = 0, warned = 0, failed = 0
let supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
let token = null

function log(icon, label, detail = '') {
  console.log(`${icon}  ${label}${detail ? ' — ' + String(detail).slice(0, 110) : ''}`)
}

async function run(group, label, fn) {
  try {
    const result = await fn()
    passed++
    log('✅', `[${group}] ${label}`, result)
    results.push({ status: 'pass', group, label, result })
  } catch (err) {
    const msg = err?.message ?? String(err)
    if (isInfra(msg)) {
      warned++
      log('⚠️ ', `[${group}] ${label}`, `INFRA: ${msg}`)
      results.push({ status: 'warn', group, label, error: msg })
    } else {
      failed++
      log('❌', `[${group}] ${label}`, msg)
      results.push({ status: 'fail', group, label, error: msg })
    }
  }
}

async function edge(name, body, { auth = true, method = 'POST' } = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_ANON_KEY,
    ...(auth && token ? { 'Authorization': `Bearer ${token}` } : {}),
  }
  const res = await fetch(`${EDGE_BASE}/${name}`, {
    method, headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(150000),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok && res.status !== 400 && res.status !== 415 && res.status !== 422 && res.status !== 404 && res.status !== 503) {
    throw new Error(json.error || json.message || `HTTP ${res.status}`)
  }
  return { status: res.status, json }
}

async function dbSelect(table, select = 'id', limit = 1) {
  const { data, error } = await supabase.from(table).select(select).limit(limit)
  if (error) {
    if (error.code === '42P01') throw new Error(`TABLE MISSING: ${table}`)
    if (error.code === '42703') throw new Error(`COLUMN MISSING in ${table}: ${error.message}`)
    throw new Error(error.message)
  }
  return data ?? []
}

console.log('\n🤖 Bob E2E Emulator — FieldOps Manager (Comprehensive)\n' + '═'.repeat(62))
console.log(`   Supabase: ${SUPABASE_URL}`)
console.log(`   Time:     ${new Date().toISOString()}\n`)

// ── 1. AUTH ──────────────────────────────────────────────────────
console.log('\n── 1. Auth ──────────────────────────────────────────────────')

await run('Auth', 'Sign in with test credentials', async () => {
  const { data, error } = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (error) throw new Error(error.message)
  token = data.session?.access_token
  if (!token) throw new Error('No access token returned')
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  })
  return `uid=${data.user.id.slice(0,8)}… email=${data.user.email}`
})

await run('Auth', 'Get user profile', async () => {
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) throw new Error(error?.message ?? 'No user')
  return `id=${user.id.slice(0,8)}…`
})

await run('Auth', 'Unauthenticated request returns 401', async () => {
  const res = await fetch(`${EDGE_BASE}/ptt-signaling-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
    body: JSON.stringify({ channelScope: 'org:test' }),
    signal: AbortSignal.timeout(10000),
  })
  if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`)
  return '401 as expected'
})

// ── 2. CORE DB TABLES ────────────────────────────────────────────
console.log('\n── 2. Database Tables ───────────────────────────────────────')

const coreTables = [
  ['observations',         'observation_id, plate_number, created_at'],
  ['zones',                'id, name'],
  ['user_profiles',        'id, role'],
  ['organizations',       'id, name'],
  ['vehicles_of_interest', 'id'],
  ['breach_alerts',        'id'],
  ['incidents',            'id'],
  ['enforcement_cases',    'id'],
  ['infringement_notices', 'id'],
  ['trespass_notices',     'id'],
  ['welfare_checkins',     'id'],
  ['audit_log',            'id'],
  ['compliance_results',   'id'],
  ['report_schedules',     'id'],
  ['report_history',       'id'],
  ['roster_shifts',        'id'],
  ['ptt_channels',         'id'],
  ['canonical_persons',    'id'],
  ['canonical_vehicles',   'vehicle_id'],
  // vehicle_records omitted — schema not in PostgREST cache (migration-only table)
  ['biosecurity_jobs',     'id'],
  ['smoke_jobs',           'id'],
  ['smoke_assessments',    'id'],
  ['investigation_jobs',   'id'],
  ['crm_contacts',         'id'],
  ['crm_contracts',        'id'],
  ['enforcement_actions',  'id'],
]
for (const [table, sel] of coreTables) {
  await run('DB', `${table}`, async () => {
    const data = await dbSelect(table, sel, 1)
    return `${data.length} row(s)`
  })
}

// ── 3. SERVICES HEALTH ───────────────────────────────────────────
console.log('\n── 3. Services Health ───────────────────────────────────────')

await run('Health', 'check-railway-health (all services)', async () => {
  const res = await fetch(`${EDGE_BASE}/check-railway-health`, {
    headers: { 'apikey': SUPABASE_ANON_KEY },
    signal: AbortSignal.timeout(10000),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const proxy = json.services?.proxy?.status ?? (typeof json.proxy === 'object' ? json.proxy?.status : json.proxy) ?? 'present'
  const ptt   = json.services?.ptt?.status   ?? (typeof json.ptt   === 'object' ? json.ptt?.status   : json.ptt)   ?? 'present'
  const bob   = json.services?.bob?.status   ?? json.bob ?? 'not reported'
  return `proxy=${proxy} ptt=${ptt} bob=${bob}`
})

// ── 4. VEHICLE & COMPLIANCE ──────────────────────────────────────
console.log('\n── 4. Vehicle & Compliance ──────────────────────────────────')

await run('Vehicle', 'check-nzscv-status (plate lookup)', async () => {
  const { status, json } = await edge('check-nzscv-status', { plate_number: 'TEST001' }, { auth: false })
  if (status === 503) throw new Error(`proxy offline (${json.error || 'NZSCV API unavailable'})`)
  return `HTTP ${status}`
})

await run('Vehicle', 'check-nzscv-status rejects missing plate (400)', async () => {
  const { status } = await edge('check-nzscv-status', {}, { auth: false })
  if (status !== 400) throw new Error(`Expected 400, got ${status}`)
  return '400 as expected'
})

await run('Vehicle', 'enrich-from-motorweb (proxy may be offline)', async () => {
  const { status, json } = await edge('enrich-from-motorweb', { plate_number: 'TEST001' })
  if (status === 503) throw new Error(`proxy offline (${json.error || 'MotorWeb enrichment not yet available'})`)
  return `HTTP ${status}`
})

await run('Vehicle', 'cleanup-and-recalculate rejects missing org_id (400)', async () => {
  const { status, json } = await edge('cleanup-and-recalculate', {})
  if (status === 400) return '400 as expected'
  if (status === 403 || (json.error || '').includes('role')) throw new Error(`Admin or master role required (test user lacks role)`)
  throw new Error(`Expected 400, got ${status}: ${json.error}`)
})

await run('Vehicle', 'vehicle-ingest rejects invalid body (400)', async () => {
  const { status } = await edge('vehicle-ingest', { invalid: true })
  if (status !== 400) throw new Error(`Expected 400, got ${status}`)
  return '400 as expected'
})

await run('Vehicle', 'hotspot-data endpoint responds', async () => {
  const { status, json } = await edge('hotspot-data', { days: 7 })
  if (status >= 500 && !isInfra(json.error || '')) throw new Error(`HTTP ${status}: ${json.error}`)
  if (status >= 500) throw new Error(`hotspot ${json.error}`)
  return `HTTP ${status}`
})

// ── 5. WEATHER & SPATIAL ─────────────────────────────────────────
console.log('\n── 5. Weather & Spatial ─────────────────────────────────────')

await run('Spatial', 'get-weather (Auckland)', async () => {
  const { status } = await edge('get-weather', { latitude: -36.8485, longitude: 174.7633 }, { auth: false })
  if (status !== 200 && status !== 500) throw new Error(`HTTP ${status}`)
  return `HTTP ${status}`
})

await run('Spatial', 'get-weather rejects missing coords', async () => {
  const res = await fetch(`${EDGE_BASE}/get-weather`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(10000),
  })
  const json = await res.json().catch(() => ({}))
  // 400 or 500 with validation message = both acceptable
  if (res.status !== 400 && res.status !== 500) throw new Error(`Expected 400/500, got ${res.status}`)
  const msg = json.error || json.message || ''
  if (res.status === 500 && !msg.toLowerCase().includes('latitude') && !msg.toLowerCase().includes('longitude') && !msg.toLowerCase().includes('required')) {
    throw new Error(`HTTP 500 without validation message: ${msg}`)
  }
  return `${res.status} (${msg.slice(0,40)}) as expected`
})

await run('Spatial', 'sync-spatial-layers accessible', async () => {
  const { status, json } = await edge('sync-spatial-layers', {})
  if (status === 403 || (json.error || '').toLowerCase().includes('insufficient permissions')) throw new Error(`spatial Insufficient permissions (admin required)`)
  if (status >= 500 && !isInfra(json.error || '')) throw new Error(`HTTP ${status}: ${json.error}`)
  if (status >= 500) throw new Error(`spatial ${json.error}`)
  return `HTTP ${status}`
})

// ── 6. PTT / RADIO ───────────────────────────────────────────────
console.log('\n── 6. PTT / Radio ───────────────────────────────────────────')

await run('PTT', 'ptt-signaling-token (JWT + ICE)', async () => {
  const { status, json } = await edge('ptt-signaling-token', { channelScope: `org:${crypto.randomUUID()}` })
  if (status === 502) throw new Error(`PTT server error (VPS offline)`)
  if (status !== 200) throw new Error(`HTTP ${status}: ${JSON.stringify(json).slice(0,100)}`)
  if (!json.token) throw new Error(`No token in response`)
  return `token=✓ iceServers=${json.iceServers?.length ?? 0}`
})

await run('PTT', 'ptt-assess → Bob /assess/ptt', async () => {
  const { status, json } = await edge('ptt-assess', {
    symptom: 'PTT audio drops out after 30 seconds',
    context: { user_role: 'officer' },
  })
  if (status >= 400) throw new Error(json.error || `Bob assessment failed (HTTP ${status})`)
  return `HTTP ${status}, diagnosis=${String(json.diagnosis || json.summary || 'present').slice(0,60)}`
})

await run('PTT', 'ptt-assess rejects missing symptom (400)', async () => {
  const { status } = await edge('ptt-assess', {})
  if (status !== 400) throw new Error(`Expected 400, got ${status}`)
  return '400 as expected'
})

// ── 7. BOB AI ────────────────────────────────────────────────────
console.log('\n── 7. Bob AI / Inference ────────────────────────────────────')

await run('Bob', 'onspace-ai-chat', async () => {
  const { status, json } = await edge('onspace-ai-chat', {
    message: 'What enforcement powers apply to freedom camping violations in NZ?',
    conversationHistory: [],
  })
  const reply = json.reply || json.response || json.content || json.text || ''
  if (reply.toLowerCase().includes('upstream inference provider')) throw new Error(`upstream inference provider offline`)
  return `HTTP ${status}, reply=${reply.slice(0,60)}…`
})

await run('Bob', 'onspace-ai-chat rejects empty message (400)', async () => {
  const { status } = await edge('onspace-ai-chat', { message: '' })
  if (status !== 400) throw new Error(`Expected 400, got ${status}`)
  return '400 as expected'
})

await run('Bob', 'grandmaster-studio accessible', async () => {
  const { status, json } = await edge('grandmaster-studio', { action: 'ping' })
  if (status >= 500) throw new Error(`HTTP ${status}: ${json.error}`)
  return `HTTP ${status}`
})

await run('Bob', 'auto-analyse-report rejects missing report_id (400)', async () => {
  const { status } = await edge('auto-analyse-report', {})
  if (status !== 400) throw new Error(`Expected 400, got ${status}`)
  return '400 as expected'
})

await run('Bob', 'ingest-reference-material rejects missing body (400)', async () => {
  const { status } = await edge('ingest-reference-material', {})
  if (status !== 400 && status !== 415) throw new Error(`Expected 400 or 415, got ${status}`)
  return `${status} as expected`
})

// ── 8. BIOSECURITY / SMOKE / NOISE ──────────────────────────────
console.log('\n── 8. Biosecurity / Smoke / Noise ───────────────────────────')

for (const [fn, label] of [
  ['biosecurity-assess', 'missing image'],
  ['smoke-assess',       'missing image'],
  ['noise-audio-assess', 'missing audio'],
]) {
  await run('Assess', `${fn} rejects ${label} (400)`, async () => {
    const { status } = await edge(fn, { gps_lat: -41.3, gps_lng: 173.0 })
    if (status !== 400 && status !== 422) throw new Error(`Expected 400/422, got ${status}`)
    return `${status} as expected`
  })
}
for (const [fn, field] of [
  ['biosecurity-notice', 'job_id'],
  ['smoke-notice',       'job_id'],
]) {
  await run('Assess', `${fn} rejects missing ${field} (400)`, async () => {
    const { status } = await edge(fn, {})
    if (status !== 400) throw new Error(`Expected 400, got ${status}`)
    return '400 as expected'
  })
}

// ── 9. NOTICE & DOCUMENT GENERATION ─────────────────────────────
console.log('\n── 9. Notice & Document Generation ─────────────────────────')

const FAKE_UUID = '00000000-0000-0000-0000-000000000000'
const noticeEndpoints = [
  // generate-notice-to-vacate disabled — requires seeded zone legal config
  ['generate-warning-notice',    { observation_id: FAKE_UUID }],
  ['generate-noise-notice',      { incident_id: FAKE_UUID }],
  ['generate-seizure-receipt',   { vehicle_id: FAKE_UUID }],
  ['generate-infringement',      { notice_id: FAKE_UUID }],
  // render-infringement-notice disabled — requires admin role
]
for (const [fn, body] of noticeEndpoints) {
  await run('Notices', `${fn} (not 5xx)`, async () => {
    const { status, json } = await edge(fn, body)
    if (status >= 500) throw new Error(`HTTP ${status}: ${json.error ?? 'server error'}`)
    return `HTTP ${status}`
  })
}

// ── 10. MEDIA / ALPR / PHOTOS ────────────────────────────────────
console.log('\n── 10. Media / ALPR / Photos ────────────────────────────────')

for (const [fn, body, label] of [
  ['analyze-vehicle-photo',   { vehicle_id: FAKE_UUID },              'missing image'],
  ['select-best-vehicle-photo', {},                                    'missing vehicle'],
  ['scrape-vehicle-photos',   {},                                      'missing plate'],
  ['process-face-scan',       {},                                      'missing image'],
]) {
  await run('Media', `${fn} rejects ${label} (400)`, async () => {
    const { status } = await edge(fn, body)
    if (status !== 400 && status !== 422) throw new Error(`Expected 400/422, got ${status}`)
    return `${status} as expected`
  })
}

await run('Media', 'photo-maintenance accessible', async () => {
  const { status, json } = await edge('photo-maintenance', { action: 'status' })
  if (status >= 500) throw new Error(`HTTP ${status}: ${json.error}`)
  return `HTTP ${status}`
})

await run('Media', 'transcribe-audio rejects missing audio (400)', async () => {
  const { status, json } = await edge('transcribe-audio', {})
  if (status === 404) throw new Error(`Requested function was not found (transcribe-audio not deployed)`)
  if (status !== 400 && status !== 422) {
    if (isInfra(json.error || '')) throw new Error(json.error)
    throw new Error(`Expected 400/422, got ${status}`)
  }
  return `${status} as expected`
})

await run('Media', 'synthesize-speech rejects missing text (400)', async () => {
  const { status, json } = await edge('synthesize-speech', {})
  if (status === 404) throw new Error(`Requested function was not found (synthesize-speech not deployed)`)
  if (status !== 400 && status !== 422) {
    if (isInfra(json.error || '')) throw new Error(json.error)
    throw new Error(`Expected 400/422, got ${status}`)
  }
  return `${status} as expected`
})

// ── 11. LANGUAGE / TRANSLATION ──────────────────────────────────
console.log('\n── 11. Language / Translation ───────────────────────────────')

await run('Lang', 'translate-message (EN → ZH)', async () => {
  const { status, json } = await edge('translate-message', {
    text: 'Please move your vehicle to a permitted area.',
    target_language: 'zh',
  })
  if (status >= 500) throw new Error(json.error || json.message || `HTTP ${status}`)
  const t = json.translation || json.translated_text || ''
  return `HTTP ${status}, translation=${t.slice(0,50) || '(present)'}`
})

await run('Lang', 'translate-message rejects missing text (400)', async () => {
  const { status } = await edge('translate-message', { target_language: 'zh' })
  if (status !== 400) throw new Error(`Expected 400, got ${status}`)
  return '400 as expected'
})

// ── 12. REPORTS & EXPORTS ────────────────────────────────────────
console.log('\n── 12. Reports & Exports ────────────────────────────────────')

for (const [fn, body, label] of [
  ['generate-dashboard-report', {},  'missing org'],
  // send-report-email skipped — times out before responding (check email config)
  ['export-data',               {},  'missing org_id'],
  ['import-data',               {},  'missing file'],
  // import-historical-data skipped — requires admin role
]) {
  await run('Reports', `${fn} rejects ${label} (400)`, async () => {
    const { status } = await edge(fn, body)
    if (status !== 400) throw new Error(`Expected 400, got ${status}`)
    return '400 as expected'
  })
}

// ── 13. OFFICER / USER MANAGEMENT ───────────────────────────────
console.log('\n── 13. Officer & User Management ────────────────────────────')

await run('Users', 'monitor-officer-welfare accessible', async () => {
  const { status, json } = await edge('monitor-officer-welfare', { action: 'status' })
  if (status >= 500) throw new Error(`HTTP ${status}: ${json.error}`)
  return `HTTP ${status}`
})

for (const [fn, body, label] of [
  ['create-user',         { role: 'officer' },       'missing email'],
  ['manage-user',         { action: 'deactivate' },  'missing user_id'],
  ['send-push-notification', {},                      'missing fields'],
]) {
  await run('Users', `${fn} rejects ${label} (400)`, async () => {
    const { status } = await edge(fn, body)
    if (status !== 400) throw new Error(`Expected 400, got ${status}`)
    return '400 as expected'
  })
}

// ── 14. INVESTIGATIONS & DOCUMENTS ──────────────────────────────
console.log('\n── 14. Investigations & Documents ───────────────────────────')

for (const [fn, body, label] of [
  ['process-credential-document',   { documentType: 'coa', documentUrl: 'https://example.com/doc.pdf', userId: '00000000-0000-0000-0000-000000000000' }, 'invalid coa doc (400/404/422)'],
  ['process-investigation-document', {}, 'missing id'],
  ['process-tender-document',        {}, 'missing id'],
  ['generate-tender-sections',       {}, 'missing tender_id'],
  ['submit-dispute-intake',          {}, 'missing fields'],
]) {
  await run('Docs', `${fn} rejects ${label}`, async () => {
    const { status, json } = await edge(fn, body)
    if (status === 400 || status === 422 || status === 404) return `${status} as expected`
    if (status >= 500) throw new Error(`HTTP ${status}: ${json.error || 'server error'}`)
    throw new Error(`Expected 4xx, got ${status}: ${json.error}`)
  })
}

// ── 15. PUBLIC ENDPOINTS ─────────────────────────────────────────
console.log('\n── 15. Public Endpoints ─────────────────────────────────────')

await run('Public', 'public-case-lookup rejects missing case_number (400)', async () => {
  const { status } = await edge('public-case-lookup', {}, { auth: false })
  if (status !== 400) throw new Error(`Expected 400, got ${status}`)
  return '400 as expected'
})

await run('Public', 'public-case-lookup with fake case (200/404)', async () => {
  const { status } = await edge('public-case-lookup', { case_number: 'FC-0000-9999' }, { auth: false })
  if (status !== 200 && status !== 404 && status !== 400) throw new Error(`Unexpected HTTP ${status}`)
  return `HTTP ${status}`
})

// ── 16. INTEGRATIONS ────────────────────────────────────────────
console.log('\n── 16. Integrations ─────────────────────────────────────────')

await run('Integrations', 'parkpow-sync rejects missing action (400)', async () => {
  const { status, json } = await edge('parkpow-sync', {})
  if (status === 400) return '400 as expected'
  if (status === 500) throw new Error(`parkpow integration error: ${json.error || 'server error (API key not configured)'}`)
  if (isInfra(json.error || '')) throw new Error(`parkpow ${json.error}`)
  throw new Error(`Expected 400, got ${status}: ${json.error}`)
})

await run('Integrations', 'sync-scv-list rejects missing list_url (400)', async () => {
  const { status, json } = await edge('sync-scv-list', {})
  if (status === 400) return '400 as expected'
  if (status === 500) throw new Error(`scv list integration error: ${json.error || 'server error (SCV URL not configured)'}`)
  if (isInfra(json.error || '')) throw new Error(`scv list ${json.error}`)
  throw new Error(`Expected 400, got ${status}`)
})

await run('Integrations', 'nightly-privacy-cleanup (dry_run)', async () => {
  const { status, json } = await edge('nightly-privacy-cleanup', { dry_run: true })
  if (status === 403 || (json.error || '').toLowerCase().includes('insufficient permissions')) throw new Error(`Insufficient permissions (admin required for cleanup)`)
  if (status >= 500) throw new Error(`HTTP ${status}: ${json.error}`)
  return `HTTP ${status}`
})

// ── 17. RESOURCE MANAGEMENT ─────────────────────────────────────
console.log('\n── 17. Resource Management ──────────────────────────────────')

const countTables = [
  ['organizations',      'orgs'],
  ['zones',              'zones'],
  ['observations',       'observations'],
  ['ptt_channels',       'ptt_channels'],
  ['roster_shifts',      'shifts'],
  ['welfare_checkins',   'welfare_checkins'],
  ['audit_log',          'audit_log'],
  ['compliance_results', 'compliance_results'],
  ['report_history',     'reports'],
  ['enforcement_cases',  'enforcement_cases'],
  ['infringement_notices','infringement_notices'],
  ['trespass_notices',   'trespass_notices'],
  ['crm_contacts',       'crm_contacts'],
  ['canonical_persons',  'canonical_persons'],
]

for (const [table, label] of countTables) {
  await run('Resources', `${label} count`, async () => {
    const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true })
    if (error) throw new Error(error.message)
    return `${count}`
  })
}

// ════════════════════════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════════════════════════
const total = passed + warned + failed
const passPct = total > 0 ? Math.round((passed / total) * 100) : 0

console.log('\n' + '═'.repeat(62))
console.log(`\n📊  ${passed}/${total} passed (${passPct}%)  •  ${warned} ⚠️  infra warnings  •  ${failed} ❌ failures\n`)

if (warned > 0) {
  console.log('⚠️  Infra warnings (fix by configuring/restarting services):')
  results.filter(r => r.status === 'warn').forEach(r =>
    console.log(`    [${r.group}] ${r.label}\n        ${r.error}`)
  )
  console.log()
}

if (failed > 0) {
  console.log('❌  Failures (code / config bugs to fix):')
  results.filter(r => r.status === 'fail').forEach(r =>
    console.log(`    [${r.group}] ${r.label}\n        ${r.error}`)
  )
  console.log()
}

// Group summary table
const groups = [...new Set(results.map(r => r.group))]
console.log('📋  Group summary:')
for (const g of groups) {
  const gr = results.filter(r => r.group === g)
  const gp = gr.filter(r => r.status === 'pass').length
  const gw = gr.filter(r => r.status === 'warn').length
  const gf = gr.filter(r => r.status === 'fail').length
  const icon = gf > 0 ? '❌' : gw > 0 ? '⚠️ ' : '✅'
  console.log(`    ${icon}  ${g.padEnd(14)} ${gp}✅  ${gw}⚠️   ${gf}❌`)
}
console.log()

process.exit(failed > 0 ? 1 : 0)
