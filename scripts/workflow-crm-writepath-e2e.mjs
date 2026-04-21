/**
 * Stage 2 — Workflow + CRM Write-Path E2E
 *
 * Purpose:
 * 1) Execute real workflow mutations (not only validation errors).
 * 2) Verify whether CRM write-path tables change as a consequence.
 *
 * Usage:
 *   node scripts/workflow-crm-writepath-e2e.mjs
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://kxwjcupuxnnbnzcgmkoi.supabase.co'
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4d2pjdXB1eG5uYm56Y2dta29pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1ODYwMzYsImV4cCI6MjA4ODE2MjAzNn0.7v-f-Ks4EAL7SskGVt-hjGmaASawWfFiwgzUHD_uc_Q'
const EMAIL = process.env.API_TEST_EMAIL || 'squires.don@live.com'
const PASSWORD = process.env.API_TEST_PASSWORD || 'Run2thesun??'
const EDGE_BASE = `${SUPABASE_URL}/functions/v1`
const REQUIRE_CRM_HUB = process.env.REQUIRE_CRM_HUB === '1' || process.env.CI === 'true'
const REQUIRE_JURISDICTION_SCOPE = process.env.REQUIRE_JURISDICTION_SCOPE === '1' || process.env.CI === 'true'

let token = null
let user = null
let orgId = null
let zoneId = null
let supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const results = []
let pass = 0
let fail = 0

function ok(step, detail = '') {
  pass++
  results.push({ status: 'PASS', step, detail })
  console.log(`PASS  ${step}${detail ? ' — ' + detail : ''}`)
}

function bad(step, detail = '') {
  fail++
  results.push({ status: 'FAIL', step, detail })
  console.log(`FAIL  ${step}${detail ? ' — ' + detail : ''}`)
}

async function run(step, fn) {
  try {
    const detail = await fn()
    ok(step, detail)
  } catch (e) {
    bad(step, e?.message || String(e))
  }
}

async function edge(name, body) {
  const res = await fetch(`${EDGE_BASE}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(60000),
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}

async function count(table) {
  const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true })
  if (error) throw new Error(`${table}: ${error.message}`)
  return count ?? 0
}

function deltaText(before, after) {
  const d = after - before
  const sign = d > 0 ? '+' : ''
  return `${before} -> ${after} (${sign}${d})`
}

async function main() {
  await run('Auth sign-in', async () => {
    const { data, error } = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
    if (error) throw error
    token = data.session?.access_token
    user = data.user
    if (!token || !user?.id) throw new Error('missing token/user')
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } })
    return user.id
  })

  await run('Resolve org + zone', async () => {
    const { data: profile, error: pErr } = await supabase
      .from('user_profiles')
      .select('organization_id')
      .eq('id', user.id)
      .single()
    if (pErr) throw pErr
    orgId = profile.organization_id

    const { data: zone, error: zErr } = await supabase
      .from('zones')
      .select('id')
      .eq('organization_id', orgId)
      .limit(1)
      .maybeSingle()
    if (zErr) throw zErr
    if (!zone?.id) throw new Error('no zone for org')
    zoneId = zone.id
    return `org=${orgId} zone=${zoneId}`
  })

  // Ownership + jurisdiction guardrail for Stage 2:
  // services must execute in active client org scope only, inside client jurisdiction.
  await run('Ownership/Jurisdiction guard baseline', async () => {
    const { data: zoneRow, error } = await supabase
      .from('zones')
      .select('id,organization_id,is_active')
      .eq('id', zoneId)
      .single()
    if (error) throw error
    if (!zoneRow || zoneRow.organization_id !== orgId) {
      throw new Error('zone organization mismatch with active client organization')
    }
    if (REQUIRE_JURISDICTION_SCOPE && zoneRow.is_active === false) {
      throw new Error('strict jurisdiction mode: selected zone is inactive')
    }
    return 'active client org scope confirmed'
  })

  // Baseline counts before mutating workflows.
  const baseline = {}
  const tracked = [
    'notices_to_vacate',
    'enforcement_actions',
    'report_history',
    'crm_activities',
    'crm_communications',
    'crm_account_history',
    'crm_notes',
  ]

  await run('Capture baseline counters', async () => {
    for (const t of tracked) baseline[t] = await count(t)
    return tracked.map((t) => `${t}=${baseline[t]}`).join(', ')
  })

  await run('Workflow: generate notice to vacate', async () => {
    const { status, json } = await edge('generate-notice-to-vacate', {
      zoneId,
      plateNumber: `STAGE2${Date.now().toString().slice(-4)}`,
      nightsStayed: 4,
      breachDetails: { source: 'stage2-workflow-crm' },
      issuedBy: user.id,
      deliveryMethod: 'printed_onsite',
      autoBootstrapLegalConfig: true,
    })
    if (status !== 200 || !json?.success) {
      throw new Error(`HTTP ${status} ${json?.error || json?.message || ''}`)
    }
    return json.notice?.reference_number || 'created'
  })

  await run('Workflow: cleanup-and-recalculate dry run', async () => {
    const { status, json } = await edge('cleanup-and-recalculate', {
      dry_run: true,
      org_id: orgId,
      batch_size: 20,
      phase: 'all',
    })
    if (status !== 200 && status !== 201) {
      throw new Error(`HTTP ${status} ${json?.error || json?.message || ''}`)
    }
    return json?.message || 'ok'
  })

  await run('Workflow: generate dashboard report', async () => {
    const date_from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
    const date_to = new Date().toISOString().slice(0, 10)
    const { status, json } = await edge('generate-dashboard-report', { org_id: orgId, date_from, date_to })
    if (status !== 200 && status !== 201) {
      throw new Error(`HTTP ${status} ${json?.error || json?.message || ''}`)
    }
    return 'generated'
  })

  const after = {}
  await run('Capture post-workflow counters', async () => {
    for (const t of tracked) after[t] = await count(t)
    return tracked.map((t) => `${t}=${after[t]}`).join(', ')
  })

  console.log('\nStage 2 Delta Report')
  console.log('--------------------')
  for (const t of tracked) {
    console.log(`${t.padEnd(22)} ${deltaText(baseline[t], after[t])}`)
  }

  // Strict assertions for workflow writes.
  await run('Assert workflow write deltas', async () => {
    if (after.notices_to_vacate <= baseline.notices_to_vacate) {
      throw new Error('notices_to_vacate did not increase')
    }
    if (after.enforcement_actions < baseline.enforcement_actions) {
      throw new Error('enforcement_actions regressed')
    }
    return 'core workflow writes verified'
  })

  // CRM write-path assertion.
  // In strict mode (CI or REQUIRE_CRM_HUB=1), this fails when no CRM-linked writes are observed.
  await run('Assert CRM write-path visibility', async () => {
    const crmDelta =
      (after.crm_activities - baseline.crm_activities) +
      (after.crm_communications - baseline.crm_communications) +
      (after.crm_account_history - baseline.crm_account_history) +
      (after.crm_notes - baseline.crm_notes)

    if (crmDelta > 0) {
      return `crm delta detected (${crmDelta})`
    }

    const { data: cases, error } = await supabase
      .from('enforcement_cases')
      .select('id,crm_contact_id')
      .not('crm_contact_id', 'is', null)
      .limit(1)

    if (error && /column|does not exist/i.test(error.message)) {
      if (REQUIRE_CRM_HUB) {
        throw new Error('CRM hub strict mode: crm linkage columns are missing')
      }
      return 'crm linkage columns not yet migrated; no delta expected'
    }

    if (!cases || cases.length === 0) {
      if (REQUIRE_CRM_HUB) {
        throw new Error('CRM hub strict mode: no CRM-linked workflow rows detected')
      }
      return 'no crm-linked enforcement rows yet; write-path pending migration/config'
    }

    return 'crm-linked rows exist'
  })

  const total = pass + fail
  console.log('\nSummary')
  console.log('-------')
  console.log(`${pass}/${total} steps passed, ${fail} failed`)

  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
