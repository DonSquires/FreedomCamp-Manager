#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { loadLocalEnv } from './load-local-env.mjs'

loadLocalEnv()

function arg(name, fallback = '') {
  const key = `--${name}`
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '')
    if (token === key) return String(argv[i + 1] || fallback)
    if (token.startsWith(`${key}=`)) return token.slice(key.length + 1) || fallback
  }
  return fallback
}

function hasFlag(name) {
  return process.argv.slice(2).includes(`--${name}`)
}

function parseIntSafe(value, fallback) {
  const n = Number.parseInt(String(value), 10)
  return Number.isFinite(n) ? n : fallback
}

function parseFloatSafe(value, fallback) {
  const n = Number.parseFloat(String(value))
  return Number.isFinite(n) ? n : fallback
}

function classifyLevel(summary) {
  if (summary.errorRate >= summary.thresholds.criticalRate || summary.errorEvents >= summary.thresholds.criticalCount) {
    return 'critical'
  }
  if (summary.errorRate >= summary.thresholds.actionRate || summary.errorEvents >= summary.thresholds.actionCount) {
    return 'action'
  }
  if (summary.errorRate >= summary.thresholds.watchRate || summary.errorEvents >= summary.thresholds.watchCount) {
    return 'watch'
  }
  return 'normal'
}

function looksLikeError(action = '') {
  return /(error|failed|timeout|denied|forbidden|blocked|exception|critical|invalid|rejected)/i.test(action)
}

function looksLikeSuccess(action = '') {
  return /(complete|completed|resolved|approved|success|synced|created|updated|closed)/i.test(action)
}

function buildRecommendation(level, summary) {
  if (level === 'critical') {
    return [
      'Open incident bridge and page on-call owner for affected orgs.',
      'Capture top 5 error actions and correlate with deployment/activity timeline.',
      'Run targeted shadow pack for impacted surface (agentic:ui or human-engine).',
    ]
  }
  if (level === 'action') {
    return [
      'Open remediation ticket with top failing action signatures.',
      'Validate role/org route parity for impacted surfaces.',
      'Re-run near-live monitor in 15 minutes after mitigation.',
    ]
  }
  if (level === 'watch') {
    return [
      'Keep monitoring at 15-30 minute intervals.',
      'Review slow CTA events and identify UX friction hotspots.',
      'Prepare mitigation if error rate trends upward over 2 windows.',
    ]
  }
  return [
    'No immediate action required.',
    'Continue periodic monitoring and weekly trend review.',
  ]
}

async function queryAuditEvents({ supabaseUrl, serviceRoleKey, sinceIso, limit, orgId }) {
  const params = new URLSearchParams({
    select: 'action,entity_type,organization_id,created_at,new_values',
    order: 'created_at.desc',
    limit: String(limit),
  })
  params.set('created_at', `gte.${sinceIso}`)
  if (orgId) {
    params.set('organization_id', `eq.${orgId}`)
  }

  const url = `${supabaseUrl}/rest/v1/audit_log?${params.toString()}`
  const response = await fetch(url, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  })

  const rawText = await response.text()
  let data = []
  try {
    data = rawText ? JSON.parse(rawText) : []
  } catch {
    throw new Error(`Failed to parse audit_log response: ${rawText.slice(0, 200)}`)
  }

  if (!response.ok) {
    throw new Error(`audit_log query failed (${response.status}): ${JSON.stringify(data).slice(0, 240)}`)
  }

  return Array.isArray(data) ? data : []
}

function summarizeEvents(events, config) {
  const actionCounts = new Map()
  const entityCounts = new Map()

  let errorEvents = 0
  let successEvents = 0
  let croEvents = 0
  let slowCtaEvents = 0

  for (const row of events) {
    const action = String(row?.action || 'unknown')
    const entityType = String(row?.entity_type || 'unknown')
    const metrics = row?.new_values && typeof row.new_values === 'object' ? row.new_values : {}

    actionCounts.set(action, (actionCounts.get(action) || 0) + 1)
    entityCounts.set(entityType, (entityCounts.get(entityType) || 0) + 1)

    if (looksLikeError(action)) errorEvents += 1
    if (looksLikeSuccess(action)) successEvents += 1

    if (metrics?.cro === true || action.startsWith('cro_')) {
      croEvents += 1
      if (action === 'cro_time_to_first_action') {
        const durationMs = Number(metrics?.duration_ms)
        if (Number.isFinite(durationMs) && durationMs > config.slowCtaThresholdMs) {
          slowCtaEvents += 1
        }
      }
    }
  }

  const totalEvents = events.length
  const errorRate = totalEvents > 0 ? errorEvents / totalEvents : 0

  const topActions = [...actionCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, config.topN)
    .map(([action, count]) => ({ action, count }))

  const topEntities = [...entityCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, config.topN)
    .map(([entityType, count]) => ({ entityType, count }))

  const summary = {
    windowMinutes: config.minutes,
    orgScope: config.orgId || 'all',
    totalEvents,
    distinctActions: actionCounts.size,
    errorEvents,
    successEvents,
    croEvents,
    slowCtaEvents,
    errorRate,
    topActions,
    topEntities,
    thresholds: {
      watchRate: config.watchRate,
      actionRate: config.actionRate,
      criticalRate: config.criticalRate,
      watchCount: config.watchCount,
      actionCount: config.actionCount,
      criticalCount: config.criticalCount,
      slowCtaThresholdMs: config.slowCtaThresholdMs,
    },
  }

  const level = classifyLevel(summary)
  return {
    ...summary,
    level,
    recommendations: buildRecommendation(level, summary),
  }
}

async function maybeWriteReport(report, enabled) {
  if (!enabled) return null
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outDir = path.resolve('tools', 'shadow-near-live', stamp)
  const outPath = path.join(outDir, 'report.json')
  await fs.mkdir(outDir, { recursive: true })
  await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return outPath
}

function printHumanReport(report) {
  console.log('[shadow-near-live] Near-live telemetry summary')
  console.log(`- window_minutes: ${report.windowMinutes}`)
  console.log(`- org_scope: ${report.orgScope}`)
  console.log(`- total_events: ${report.totalEvents}`)
  console.log(`- distinct_actions: ${report.distinctActions}`)
  console.log(`- error_events: ${report.errorEvents}`)
  console.log(`- success_events: ${report.successEvents}`)
  console.log(`- cro_events: ${report.croEvents}`)
  console.log(`- slow_cta_events: ${report.slowCtaEvents}`)
  console.log(`- error_rate: ${(report.errorRate * 100).toFixed(2)}%`)
  console.log(`- level: ${report.level}`)

  console.log('- top_actions:')
  for (const item of report.topActions) {
    console.log(`  - ${item.action}: ${item.count}`)
  }

  console.log('- recommendations:')
  for (const step of report.recommendations) {
    console.log(`  - ${step}`)
  }
}

async function main() {
  if (hasFlag('help')) {
    console.log(`
shadow-near-live-monitor

Usage:
  node scripts/shadow-near-live-monitor.mjs [--minutes 30] [--limit 500] [--org-id <uuid>] [--json]

Options:
  --minutes <n>             Sliding window in minutes (default: 30)
  --limit <n>               Max audit rows fetched (default: 500)
  --org-id <uuid>           Scope monitoring to one organization_id
  --top <n>                 Number of top action/entity rows to print (default: 8)
  --no-write-report         Skip tools/shadow-near-live/<stamp>/report.json output
  --json                    Print JSON summary instead of human text
  --help                    Show this message

Environment:
  VITE_SUPABASE_URL or SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  SHADOW_WATCH_RATE          (default 0.10)
  SHADOW_ACTION_RATE         (default 0.20)
  SHADOW_CRITICAL_RATE       (default 0.35)
  SHADOW_WATCH_COUNT         (default 5)
  SHADOW_ACTION_COUNT        (default 10)
  SHADOW_CRITICAL_COUNT      (default 20)
  SHADOW_SLOW_CTA_THRESHOLD_MS (default 120000)
`)
    return
  }

  const supabaseUrl = String(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '')
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[shadow-near-live] Missing VITE_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  const config = {
    minutes: Math.max(1, parseIntSafe(arg('minutes', '30'), 30)),
    limit: Math.max(1, parseIntSafe(arg('limit', '500'), 500)),
    orgId: String(arg('org-id', '')).trim(),
    topN: Math.max(1, parseIntSafe(arg('top', '8'), 8)),
    writeReport: !hasFlag('no-write-report'),
    asJson: hasFlag('json'),
    watchRate: parseFloatSafe(process.env.SHADOW_WATCH_RATE, 0.10),
    actionRate: parseFloatSafe(process.env.SHADOW_ACTION_RATE, 0.20),
    criticalRate: parseFloatSafe(process.env.SHADOW_CRITICAL_RATE, 0.35),
    watchCount: Math.max(1, parseIntSafe(process.env.SHADOW_WATCH_COUNT, 5)),
    actionCount: Math.max(1, parseIntSafe(process.env.SHADOW_ACTION_COUNT, 10)),
    criticalCount: Math.max(1, parseIntSafe(process.env.SHADOW_CRITICAL_COUNT, 20)),
    slowCtaThresholdMs: Math.max(1000, parseIntSafe(process.env.SHADOW_SLOW_CTA_THRESHOLD_MS, 120000)),
  }

  const sinceIso = new Date(Date.now() - config.minutes * 60 * 1000).toISOString()
  const events = await queryAuditEvents({
    supabaseUrl,
    serviceRoleKey,
    sinceIso,
    limit: config.limit,
    orgId: config.orgId,
  })

  const report = {
    generatedAt: new Date().toISOString(),
    sinceIso,
    mode: 'near-live-shadow-telemetry',
    privacy: {
      capturesSessionReplay: false,
      storesRawPII: false,
      source: 'audit_log aggregate events only',
    },
    summary: summarizeEvents(events, config),
  }

  const reportPath = await maybeWriteReport(report, config.writeReport)
  if (reportPath) {
    report.reportPath = reportPath
  }

  if (config.asJson) {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  printHumanReport(report.summary)
  if (reportPath) {
    console.log(`- report_path: ${reportPath}`)
  }
}

main().catch((error) => {
  console.error('[shadow-near-live] fatal:', error?.message || error)
  process.exit(1)
})
