#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'
import { loadLocalEnv } from './load-local-env.mjs'

loadLocalEnv()

const HELP_TEXT = `
Reconcile Downer LINZ zone compliance matrix from the current site rules.

Usage:
  node scripts/reconcile-downer-linz-compliance.mjs [--apply]

Options:
  --apply   Perform inserts/updates. Omit for dry-run.
`

const DOWNER_LINZ_ZONE_RULES = {
  'Downer LINZ Security Zone - Lowburn': {
    self_contained_required: true,
    nights_per_month: 3,
    max_consecutive_nights: 3,
    day_visit_only: false,
  },
  'Downer LINZ Security Zone - Bendigo': {
    self_contained_required: false,
    nights_per_month: 3,
    max_consecutive_nights: 3,
    day_visit_only: false,
  },
  'Downer LINZ Security Zone - Champagne Gully': {
    self_contained_required: false,
    nights_per_month: 1,
    max_consecutive_nights: 1,
    day_visit_only: false,
  },
  'Downer LINZ Security Zone - Jacksons Inlet': {
    self_contained_required: true,
    nights_per_month: 1,
    max_consecutive_nights: 1,
    day_visit_only: false,
  },
  'Downer LINZ - Lake Dunstan Management Zone': {
    self_contained_required: false,
    nights_per_month: 0,
    max_consecutive_nights: 0,
    day_visit_only: true,
  },
  'Downer LINZ - Queenstown Coverage Zone': {
    self_contained_required: false,
    nights_per_month: 0,
    max_consecutive_nights: 0,
    day_visit_only: true,
  },
}

function parseArgs(argv) {
  return {
    apply: argv.includes('--apply'),
    help: argv.includes('--help') || argv.includes('-h'),
  }
}

function arraysEqual(a, b) {
  const left = Array.isArray(a) ? a : []
  const right = Array.isArray(b) ? b : []
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i += 1) {
    if (String(left[i]) !== String(right[i])) return false
  }
  return true
}

function normalizeRules(zoneName) {
  const base = DOWNER_LINZ_ZONE_RULES[zoneName]

  if (!base) {
    return null
  }

  return {
    self_contained_required: Boolean(base.self_contained_required),
    requires_csc: Boolean(base.self_contained_required),
    nights_per_month: Number.isFinite(base.nights_per_month) ? base.nights_per_month : 0,
    max_consecutive_nights: Number.isFinite(base.max_consecutive_nights) ? base.max_consecutive_nights : 0,
    day_visit_only: Boolean(base.day_visit_only),
    allowed_days: null,
    homeless_exemption: true,
  }
}

async function getCurrentMatrix(supabase, zoneId) {
  const { data, error } = await supabase
    .from('zone_compliance_matrix')
    .select('id, version, self_contained_required, requires_csc, nights_per_month, max_consecutive_nights, day_visit_only, allowed_days, homeless_exemption')
    .eq('zone_id', zoneId)
    .is('effective_to', null)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data || null
}

function isSameRules(current, next) {
  if (!current) return false
  return (
    Boolean(current.self_contained_required) === next.self_contained_required &&
    Boolean(current.requires_csc) === next.requires_csc &&
    Number(current.nights_per_month ?? 0) === Number(next.nights_per_month) &&
    Number(current.max_consecutive_nights ?? 0) === Number(next.max_consecutive_nights) &&
    Boolean(current.day_visit_only) === next.day_visit_only &&
    arraysEqual(current.allowed_days, next.allowed_days) &&
    Boolean(current.homeless_exemption ?? true) === next.homeless_exemption
  )
}

async function reconcileZone(supabase, zone) {
  const target = normalizeRules(zone.name)
  const current = await getCurrentMatrix(supabase, zone.id)

  if (isSameRules(current, target)) {
    return { status: 'unchanged', version: current.version }
  }

  const nextVersion = current ? Number(current.version || 1) + 1 : 1

  if (current) {
    const { error: closeErr } = await supabase
      .from('zone_compliance_matrix')
      .update({ effective_to: new Date().toISOString() })
      .eq('id', current.id)
    if (closeErr) throw closeErr
  }

  const { error: insertErr } = await supabase
    .from('zone_compliance_matrix')
    .insert({
      zone_id: zone.id,
      organization_id: zone.organization_id,
      version: nextVersion,
      effective_from: new Date().toISOString(),
      effective_to: null,
      self_contained_required: target.self_contained_required,
      requires_csc: target.requires_csc,
      nights_per_month: target.nights_per_month,
      max_consecutive_nights: target.max_consecutive_nights,
      day_visit_only: target.day_visit_only,
      allowed_days: target.allowed_days,
      homeless_exemption: target.homeless_exemption,
      change_reason: current ? 'downer_linz_site_rule_update' : 'downer_linz_site_rule_created',
      change_notes: `Seeded from Downer LINZ site compliance rules for ${zone.name}`,
    })

  if (insertErr) throw insertErr

  return { status: current ? 'updated' : 'created', version: nextVersion }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(HELP_TEXT.trim())
    return
  }

  const supabaseUrl = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim()

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: org, error: orgErr } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('name', 'Downer LINZ')
    .maybeSingle()

  if (orgErr) throw orgErr
  if (!org?.id) throw new Error('Organization not found: Downer LINZ')

  const { data: zones, error: zonesErr } = await supabase
    .from('zones')
    .select('id, organization_id, name')
    .eq('organization_id', org.id)
    .order('name', { ascending: true })

  if (zonesErr) throw zonesErr

  const targetZones = Array.isArray(zones)
    ? zones.filter((zone) => Boolean(DOWNER_LINZ_ZONE_RULES[zone.name]))
    : []

  if (targetZones.length === 0) {
    console.log(JSON.stringify({ mode: args.apply ? 'apply' : 'dry-run', zones: 0, unchanged: 0, created: 0, updated: 0, failed: 0 }, null, 2))
    return
  }

  const summary = { mode: args.apply ? 'apply' : 'dry-run', zones: targetZones.length, unchanged: 0, created: 0, updated: 0, failed: 0, skipped: zones.length - targetZones.length, zone_sample: [] }

  for (const zone of targetZones) {
    try {
      const result = await reconcileZone(supabase, zone)
      if (result.status === 'unchanged') summary.unchanged += 1
      if (result.status === 'created') summary.created += 1
      if (result.status === 'updated') summary.updated += 1
      if (!args.apply && result.status !== 'unchanged') summary.updated += 1
      summary.zone_sample.push({ zone_name: zone.name, status: result.status, version: result.version, rules: normalizeRules(zone.name) })
    } catch (error) {
      summary.failed += 1
      summary.zone_sample.push({ zone_name: zone.name, status: 'failed', error: error?.message || String(error) })
    }
  }

  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(error?.message || String(error))
  process.exit(1)
})