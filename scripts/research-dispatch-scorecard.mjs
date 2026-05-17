#!/usr/bin/env node

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { loadLocalEnv } from './load-local-env.mjs'

function getArg(name, fallback = '') {
  const key = `--${name}`
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '')
    if (token === key) return String(argv[i + 1] || fallback)
    if (token.startsWith(`${key}=`)) return token.slice(key.length + 1)
  }
  return fallback
}

function parseNumber(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function readJson(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return fallback
  }
}

function toDate(value) {
  const d = new Date(String(value || ''))
  return Number.isNaN(d.getTime()) ? null : d
}

function hoursBetween(start, end) {
  const a = toDate(start)
  const b = toDate(end)
  if (!a || !b) return null
  return Math.max(0, (b.getTime() - a.getTime()) / (1000 * 60 * 60))
}

function median(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2
  return sorted[mid]
}

async function fetchSupabaseRows({ table, select, and }) {
  const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '')
  const key = String(
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      process.env.VITE_SUPABASE_ANON_KEY ||
      '',
  )
  if (!url || !key) return null

  const qs = new URLSearchParams({ select })
  if (Array.isArray(and) && and.length > 0) {
    qs.set('and', `(${and.join(',')})`)
  }

  const endpoint = `${url.replace(/\/+$/, '')}/rest/v1/${table}?${qs.toString()}`
  const res = await fetch(endpoint, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: 'count=exact',
    },
  })
  if (!res.ok) return null
  return res.json()
}

function expectedTypesByOrg(orgType) {
  if (orgType === 'service_provider') return new Set(['patrol_route'])
  if (['client', 'contractor', 'security_company', 'operator'].includes(String(orgType || ''))) {
    return new Set(['user', 'location'])
  }
  return null
}

async function loadData({ sourceFile, windowDays }) {
  if (sourceFile) {
    const payload = readJson(resolve(process.cwd(), sourceFile), null)
    if (Array.isArray(payload)) return { jobs: payload, organizations: [] }
    if (payload?.jobs && Array.isArray(payload.jobs)) return { jobs: payload.jobs, organizations: payload.organizations || [] }
  }

  const start = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString()
  const jobs = await fetchSupabaseRows({
    table: 'noise_jobs',
    select: 'id,organization_id,created_at,updated_at,completed_at,status,assigned_to,dispatch_target_type,dispatch_target_id,dispatch_target_label',
    and: [`created_at.gte.${start}`],
  })
  const organizations = await fetchSupabaseRows({
    table: 'organizations',
    select: 'id,organization_type,name',
  })
  return {
    jobs: Array.isArray(jobs) ? jobs : [],
    organizations: Array.isArray(organizations) ? organizations : [],
  }
}

function summarize({ jobs, organizations, windowDays }) {
  const orgTypeById = new Map((organizations || []).map((o) => [o.id, o.organization_type]))

  const byTargetType = {}
  const byStatus = {}
  const policyRows = []
  const assignmentRows = []
  const terminalHours = []

  for (const job of jobs) {
    const targetType = String(job.dispatch_target_type || 'unknown')
    const status = String(job.status || 'unknown')
    const orgType = orgTypeById.get(job.organization_id) || null

    byTargetType[targetType] = (byTargetType[targetType] || 0) + 1
    byStatus[status] = (byStatus[status] || 0) + 1

    const expected = expectedTypesByOrg(orgType)
    if (expected) {
      policyRows.push({
        compliant: expected.has(targetType),
        orgType,
        targetType,
      })
    }

    if (targetType === 'user') {
      assignmentRows.push({ consistent: Boolean(job.assigned_to && job.dispatch_target_id && job.assigned_to === job.dispatch_target_id) })
    } else if (targetType === 'patrol_route' || targetType === 'location') {
      assignmentRows.push({ consistent: !job.assigned_to })
    }

    if (['completed', 'cancelled', 'referred'].includes(status)) {
      const h = hoursBetween(job.created_at, job.completed_at || job.updated_at)
      if (h != null) terminalHours.push(h)
    }
  }

  const policyEvaluated = policyRows.length
  const policyCompliant = policyRows.filter((r) => r.compliant).length
  const assignmentEvaluated = assignmentRows.length
  const assignmentConsistent = assignmentRows.filter((r) => r.consistent).length

  const total = jobs.length
  const triaged = jobs.filter((j) => ['on_scene', 'completed', 'referred'].includes(String(j.status || ''))).length

  return {
    generatedAt: new Date().toISOString(),
    windowDays,
    sample: {
      totalJobs: total,
      organizationsSeen: new Set(jobs.map((j) => j.organization_id)).size,
    },
    metrics: {
      destinationPolicyComplianceRate: policyEvaluated ? Number((policyCompliant / policyEvaluated).toFixed(4)) : null,
      assignmentConsistencyRate: assignmentEvaluated ? Number((assignmentConsistent / assignmentEvaluated).toFixed(4)) : null,
      triageRate: total ? Number((triaged / total).toFixed(4)) : null,
      medianHoursToTerminal: terminalHours.length ? Number(median(terminalHours).toFixed(3)) : null,
      p90HoursToTerminal: terminalHours.length ? Number([...terminalHours].sort((a, b) => a - b)[Math.floor(0.9 * (terminalHours.length - 1))].toFixed(3)) : null,
    },
    breakdown: {
      byTargetType,
      byStatus,
      policyEvaluated,
      assignmentEvaluated,
    },
    hypotheses: [
      'Service-provider dispatches should be route-first with minimal user direct assignment.',
      'Contractor/client dispatches should favor user/location with low patrol_route usage.',
      'Higher assignment consistency should correlate with faster triage completion.',
    ],
  }
}

async function main() {
  loadLocalEnv()

  const out = resolve(process.cwd(), getArg('out', 'data/research-dispatch-scorecard.json'))
  const sourceFile = getArg('source', '')
  const windowDays = Math.max(1, parseNumber(getArg('window-days', '30'), 30))

  const data = await loadData({ sourceFile, windowDays })
  const result = summarize({ ...data, windowDays })

  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`, 'utf8')

  console.log(`dispatch_scorecard=${out}`)
  console.log(`jobs=${result.sample.totalJobs}`)
  console.log(`policy_compliance=${result.metrics.destinationPolicyComplianceRate}`)
  console.log(`assignment_consistency=${result.metrics.assignmentConsistencyRate}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
