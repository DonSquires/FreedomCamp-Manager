#!/usr/bin/env node
/**
 * reconcile-zone-compliance-matrix.mjs
 *
 * Reconciles active zone compliance matrix rows from zone settings so compliance
 * measurement always has a current matrix version per zone.
 *
 * Documented rules source:
 * - self_contained_required
 * - nights_per_month
 * - max_consecutive_nights
 * - day_visit_only
 * - allowed_days
 * - homeless_exemption (default true)
 *
 * Usage:
 *   node scripts/reconcile-zone-compliance-matrix.mjs [--org-id <uuid>] [--zone-id <uuid>] [--dry-run]
 *
 * Required env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  process.exit(1)
}

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const ORG_ID = (() => {
  const idx = args.indexOf('--org-id')
  return idx !== -1 ? args[idx + 1] : null
})()
const ZONE_ID = (() => {
  const idx = args.indexOf('--zone-id')
  return idx !== -1 ? args[idx + 1] : null
})()

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

function arraysEqual(a, b) {
  const left = Array.isArray(a) ? a : []
  const right = Array.isArray(b) ? b : []
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i++) {
    if (String(left[i]) !== String(right[i])) return false
  }
  return true
}

function normalizeRules(zone) {
  return {
    self_contained_required: Boolean(zone.self_contained_required),
    requires_csc: Boolean(zone.self_contained_required),
    nights_per_month: Number.isFinite(zone.nights_per_month) ? zone.nights_per_month : 28,
    max_consecutive_nights: Number.isFinite(zone.max_consecutive_nights) ? zone.max_consecutive_nights : 3,
    day_visit_only: Boolean(zone.day_visit_only),
    allowed_days: Array.isArray(zone.allowed_days) ? zone.allowed_days : null,
    homeless_exemption: true,
  }
}

async function getCurrentMatrix(zoneId) {
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
    Number(current.nights_per_month ?? 28) === Number(next.nights_per_month) &&
    Number(current.max_consecutive_nights ?? 3) === Number(next.max_consecutive_nights) &&
    Boolean(current.day_visit_only) === next.day_visit_only &&
    arraysEqual(current.allowed_days, next.allowed_days) &&
    Boolean(current.homeless_exemption ?? true) === next.homeless_exemption
  )
}

async function reconcileZone(zone) {
  const target = normalizeRules(zone)
  const current = await getCurrentMatrix(zone.id)

  if (isSameRules(current, target)) {
    return { status: 'unchanged', version: current.version }
  }

  const nextVersion = current ? Number(current.version || 1) + 1 : 1

  if (DRY_RUN) {
    return { status: 'would_update', version: nextVersion }
  }

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
      change_reason: current ? 'auto_synced_from_zone_update' : 'auto_created_with_zone',
      change_notes: 'Reconciled from zones by reconcile-zone-compliance-matrix.mjs',
    })

  if (insertErr) throw insertErr

  return { status: current ? 'updated' : 'created', version: nextVersion }
}

async function run() {
  let query = supabase
    .from('zones')
    .select('id, organization_id, name, self_contained_required, nights_per_month, max_consecutive_nights, day_visit_only, allowed_days, is_active')

  if (ORG_ID) query = query.eq('organization_id', ORG_ID)
  if (ZONE_ID) query = query.eq('id', ZONE_ID)

  const { data: zones, error } = await query.order('name', { ascending: true })
  if (error) throw error

  if (!zones || zones.length === 0) {
    console.log('No zones matched the provided filters.')
    return
  }

  let unchanged = 0
  let created = 0
  let updated = 0
  let failed = 0

  for (const zone of zones) {
    try {
      const result = await reconcileZone(zone)
      if (result.status === 'unchanged') unchanged++
      if (result.status === 'created') created++
      if (result.status === 'updated') updated++
      if (result.status === 'would_update') updated++
      console.log(`${zone.name}: ${result.status} (v${result.version})`)
    } catch (err) {
      failed++
      const message = err && typeof err === 'object' && 'message' in err ? err.message : String(err)
      console.error(`${zone.name}: failed - ${message}`)
    }
  }

  console.log(`\nSummary: zones=${zones.length}, unchanged=${unchanged}, ${DRY_RUN ? 'would_update' : 'updated'}=${updated}, created=${created}, failed=${failed}`)
}

run().catch((err) => {
  console.error('Fatal error:', err?.message || err)
  process.exit(1)
})
