#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js'
import { loadLocalEnv } from './load-local-env.mjs'

const HELP_TEXT = `
Remediate missing onboarding module subscriptions for client/operator organizations.

Usage:
  node scripts/remediate-onboarding-client-modules.mjs [--apply] [--organization <name>] [--scope <all|new>] [--sinceDays <n>]

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
  const type = normalizeOrgType(org.organization_type)
  return type === 'client' || type === 'operator'
}

function createdWithin(createdAt, sinceIso) {
  if (!createdAt) return false
  const ts = Date.parse(createdAt)
  if (Number.isNaN(ts)) return false
  return ts >= Date.parse(sinceIso)
}

async function upsertModule({ supabase, organizationId, moduleKey, dryRun }) {
  const { data: existing, error: lookupError } = await supabase
    .from('org_module_subscriptions')
    .select('id, is_active, config')
    .eq('organization_id', organizationId)
    .eq('module_key', moduleKey)
    .maybeSingle()

  if (lookupError) {
    throw new Error(`Failed loading module ${moduleKey} for org ${organizationId}: ${lookupError.message}`)
  }

  if (existing?.id) {
    if (dryRun) return { action: existing.is_active ? 'noop' : 'activate', id: existing.id }
    if (existing.is_active) return { action: 'noop', id: existing.id }

    const { error: updateError } = await supabase
      .from('org_module_subscriptions')
      .update({ is_active: true, updated_at: new Date().toISOString() })
      .eq('id', existing.id)

    if (updateError) {
      throw new Error(`Failed activating module ${moduleKey} for org ${organizationId}: ${updateError.message}`)
    }

    return { action: 'activate', id: existing.id }
  }

  if (dryRun) return { action: 'insert', id: '' }

  const { data: inserted, error: insertError } = await supabase
    .from('org_module_subscriptions')
    .insert({
      organization_id: organizationId,
      module_key: moduleKey,
      is_active: true,
      config: {},
    })
    .select('id')
    .single()

  if (insertError || !inserted?.id) {
    throw new Error(`Failed inserting module ${moduleKey} for org ${organizationId}: ${insertError?.message || 'Unknown error'}`)
  }

  return { action: 'insert', id: inserted.id }
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

  let query = supabase
    .from('organizations')
    .select('id,name,organization_type,is_active,created_at')
    .eq('is_active', true)

  if (args.organization) {
    query = query.eq('name', args.organization)
  }

  const { data: orgs, error: orgError } = await query.order('name', { ascending: true })
  if (orgError) {
    throw new Error(`Failed loading organizations: ${orgError.message}`)
  }

  const targets = (orgs || []).filter((org) => {
    if (!isClientLikeOrg(org)) return false
    if (args.scope === 'all') return true
    return createdWithin(org.created_at, sinceIso)
  })

  console.log(`[${dryRun ? 'Dry run' : 'Apply'}] Target organizations: ${targets.length}`)

  let inserts = 0
  let activates = 0
  let noops = 0

  for (const org of targets) {
    const crm = await upsertModule({ supabase, organizationId: org.id, moduleKey: 'crm', dryRun })
    const reporting = await upsertModule({ supabase, organizationId: org.id, moduleKey: 'reporting', dryRun })

    for (const result of [crm, reporting]) {
      if (result.action === 'insert') inserts += 1
      else if (result.action === 'activate') activates += 1
      else noops += 1
    }

    console.log(`${org.name}: crm=${crm.action}, reporting=${reporting.action}`)
  }

  console.log(`Summary: inserts=${inserts}, activates=${activates}, noops=${noops}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
