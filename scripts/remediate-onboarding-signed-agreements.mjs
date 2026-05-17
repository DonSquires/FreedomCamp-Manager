#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js'
import { loadLocalEnv } from './load-local-env.mjs'

const HELP_TEXT = `
Create or update baseline signed active service agreements for client/operator organizations.

Usage:
  node scripts/remediate-onboarding-signed-agreements.mjs [--apply] [--organization <name>] [--scope <all|new>] [--sinceDays <n>]

Options:
  --apply               Persist changes. Omit for dry-run.
  --organization <name> Restrict remediation to one organization name.
  --scope <all|new>     Target all active orgs or only recently created orgs. Default: all
  --sinceDays <n>       With --scope new, include orgs created in the last n days. Default: 30
  --help                Show help.
`

function parseArgs(argv) {
  const getArg = (flag) => {
    const idx = argv.indexOf(flag)
    if (idx === -1) return ''
    return String(argv[idx + 1] || '').trim()
  }

  const scopeRaw = getArg('--scope').toLowerCase()
  const scope = scopeRaw === 'new' ? 'new' : 'all'
  const sinceRaw = Number(getArg('--sinceDays') || '30')

  return {
    help: argv.includes('--help') || argv.includes('-h'),
    apply: argv.includes('--apply'),
    organization: getArg('--organization'),
    scope,
    sinceDays: Number.isFinite(sinceRaw) && sinceRaw > 0 ? sinceRaw : 30,
  }
}

function normalizeOrgType(value) {
  return String(value || '').trim().toLowerCase()
}

function isClientLikeOrg(org) {
  const t = normalizeOrgType(org.organization_type)
  return t === 'client' || t === 'operator'
}

function createdWithin(createdAt, sinceIso) {
  if (!createdAt) return false
  const ts = Date.parse(createdAt)
  if (Number.isNaN(ts)) return false
  return ts >= Date.parse(sinceIso)
}

function agreementNumberForOrg(org) {
  const code = String(org.name || 'ORG').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `AUTO-${code || 'ORG'}-BASE`
}

async function loadAgreementsWithSignedSupport(supabase) {
  const signedSelect = 'id,organization_id,client_org_id,name,agreement_number,status,is_active,is_signed,signed_at'
  const legacySelect = 'id,organization_id,client_org_id,name,agreement_number,status,is_active'

  const signedQuery = await supabase.from('service_agreements').select(signedSelect)
  if (!signedQuery.error) {
    return { agreements: signedQuery.data || [], supportsSignedAgreement: true }
  }

  const legacyQuery = await supabase.from('service_agreements').select(legacySelect)
  if (legacyQuery.error) {
    throw new Error(`Failed loading service_agreements: ${legacyQuery.error.message}`)
  }

  return { agreements: legacyQuery.data || [], supportsSignedAgreement: false }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(HELP_TEXT.trim())
    return
  }

  loadLocalEnv()
  const supabaseUrl = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const dryRun = !args.apply
  const sinceIso = new Date(Date.now() - args.sinceDays * 24 * 60 * 60 * 1000).toISOString()

  let orgQuery = supabase
    .from('organizations')
    .select('id,name,organization_type,is_active,created_at')
    .eq('is_active', true)
  if (args.organization) orgQuery = orgQuery.eq('name', args.organization)

  const { data: orgs, error: orgError } = await orgQuery.order('name', { ascending: true })
  if (orgError) throw new Error(`Failed loading organizations: ${orgError.message}`)

  const targets = (orgs || []).filter((org) => {
    if (!isClientLikeOrg(org)) return false
    if (args.scope === 'all') return true
    return createdWithin(org.created_at, sinceIso)
  })

  const agreementLoad = await loadAgreementsWithSignedSupport(supabase)
  const agreements = agreementLoad.agreements
  const supportsSignedAgreement = agreementLoad.supportsSignedAgreement

  if (!supportsSignedAgreement) {
    console.log('Signed-agreement columns are not present yet on service_agreements.')
    console.log('Apply migration: supabase/migrations/20260517183000_client_activation_requires_signed_service_agreement.sql')
    process.exitCode = 2
    return
  }

  const byOrg = new Map()
  for (const a of agreements) {
    const keys = [a.organization_id, a.client_org_id].filter(Boolean)
    for (const key of keys) {
      if (!byOrg.has(key)) byOrg.set(key, [])
      byOrg.get(key).push(a)
    }
  }

  console.log(`[${dryRun ? 'Dry run' : 'Apply'}] Target organizations: ${targets.length}`)

  let created = 0
  let signed = 0
  let noop = 0

  for (const org of targets) {
    const relevant = (byOrg.get(org.id) || []).filter((a) => {
      const active = String(a.status || '').toLowerCase() === 'active' || a.is_active === true
      return active
    })

    const existingSigned = relevant.find((a) => a.is_signed === true)
    if (existingSigned) {
      noop += 1
      console.log(`${org.name}: signed-agreement=noop (${existingSigned.id})`)
      continue
    }

    if (relevant.length > 0) {
      const target = relevant[0]
      if (dryRun) {
        signed += 1
        console.log(`${org.name}: signed-agreement=sign-existing (${target.id})`)
      } else {
        const { error: updateError } = await supabase
          .from('service_agreements')
          .update({
            is_signed: true,
            signed_at: new Date().toISOString(),
            is_active: true,
            status: 'active',
          })
          .eq('id', target.id)
        if (updateError) throw new Error(`Failed signing agreement ${target.id}: ${updateError.message}`)
        signed += 1
        console.log(`${org.name}: signed-agreement=sign-existing (${target.id})`)
      }
      continue
    }

    const payload = {
      organization_id: org.id,
      client_org_id: org.id,
      name: `${org.name} Baseline Service Agreement`,
      reference_number: `AUTO-${org.id.slice(0, 8)}`,
      agreement_type: 'other',
      allows_client_submission: false,
      allows_auto_dispatch: false,
      default_sla_minutes: 60,
      default_priority: 'normal',
      active_from: new Date().toISOString().slice(0, 10),
      active_to: null,
      is_active: true,
      notes: 'Auto-created baseline agreement for onboarding gate remediation.',
      agreement_number: agreementNumberForOrg(org),
      service_type: 'other',
      status: 'active',
      is_signed: true,
      signed_at: new Date().toISOString(),
    }

    if (dryRun) {
      created += 1
      console.log(`${org.name}: signed-agreement=create-baseline`)
    } else {
      const { error: insertError } = await supabase.from('service_agreements').insert(payload)
      if (insertError) throw new Error(`Failed creating agreement for ${org.name}: ${insertError.message}`)
      created += 1
      console.log(`${org.name}: signed-agreement=create-baseline`)
    }
  }

  console.log(`Summary: created=${created}, signed_existing=${signed}, noop=${noop}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
