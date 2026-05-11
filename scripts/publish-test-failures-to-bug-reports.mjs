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
  const key = `--${name}`
  return process.argv.slice(2).includes(key)
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8')
  return JSON.parse(raw)
}

async function exists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function listReportFiles(rootDir, maxAgeMs = 12 * 60 * 60 * 1000) {
  const files = []
  const now = Date.now()
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
        continue
      }
      if (!entry.isFile() || entry.name !== 'report.json') continue
      if (maxAgeMs > 0) {
        const stat = await fs.stat(fullPath).catch(() => null)
        if (!stat) continue
        if (now - stat.mtimeMs > maxAgeMs) continue
      }
      files.push(fullPath)
    }
  }
  await walk(rootDir)
  return files.sort()
}

async function supabasePost(baseUrl, serviceKey, endpoint, payload) {
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/rest/v1${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Prefer: 'return=representation',
    },
    body: JSON.stringify(payload),
  })

  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { raw: text }
  }

  return { status: response.status, data }
}

async function supabaseGet(baseUrl, serviceKey, endpoint) {
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/rest/v1${endpoint}`, {
    method: 'GET',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Prefer: 'return=representation',
    },
  })

  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { raw: text }
  }

  return { status: response.status, data }
}

async function resolveReporterUser(baseUrl, serviceRole, explicitReporter) {
  const direct = String(explicitReporter || '').trim()
  if (direct) return direct

  const fallback = await supabaseGet(
    baseUrl,
    serviceRole,
    '/bug_reports?select=user_id&order=created_at.desc&limit=1'
  )

  if (fallback.status >= 200 && fallback.status < 300 && Array.isArray(fallback.data)) {
    const guessed = String(fallback.data[0]?.user_id || '').trim()
    if (guessed) return guessed
  }

  return ''
}

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase()
}

async function fetchExistingOpenTitles(baseUrl, serviceRole) {
  const res = await supabaseGet(
    baseUrl,
    serviceRole,
    '/bug_reports?select=title,status,created_at&order=created_at.desc&limit=500'
  )

  if (!(res.status >= 200 && res.status < 300) || !Array.isArray(res.data)) {
    return new Set()
  }

  const openTitles = new Set()
  for (const row of res.data) {
    const status = normalizeStatus(row?.status)
    if (status === 'resolved' || status === 'closed' || status === 'dismissed') continue
    const title = String(row?.title || '').trim()
    if (title) openTitles.add(title)
  }

  return openTitles
}

function nowIso() {
  return new Date().toISOString()
}

function mkSummaryReport({ reporterUser, source, title, description, severity = 'low', issueType = 'bug', currentPage = '/bug-reports-log' }) {
  return {
    title,
    description,
    severity,
    issue_type: issueType,
    status: 'submitted',
    current_page: currentPage,
    app_version: `ops-${source}`,
    auto_reported: true,
    admin_notified: false,
    browser_info: {
      source,
      published_at: nowIso(),
    },
    user_id: reporterUser,
    user_role: 'master',
  }
}

function extractCurrentPageFromReport(report) {
  const actions = Array.isArray(report?.actions) ? report.actions : []
  for (let i = actions.length - 1; i >= 0; i -= 1) {
    const action = actions[i]?.action
    if (String(action?.type || '') === 'goto') {
      const url = String(action?.url || '').trim()
      if (url.startsWith('/')) return url
      try {
        const parsed = new URL(url)
        return parsed.pathname || '/bug-reports-log'
      } catch {
        // Ignore invalid URLs and continue scanning.
      }
    }
  }

  const goal = String(report?.goal || report?.config?.goal || '').trim()
  const match = goal.match(/(\/[a-z0-9/_-]+)/i)
  return match?.[1] || '/bug-reports-log'
}

async function main() {
  const supabaseUrl = String(process.env.VITE_SUPABASE_URL || '').trim()
  const serviceRole = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  const reporterUser = await resolveReporterUser(
    supabaseUrl,
    serviceRole,
    String(process.env.SYNTHETIC_MONITOR_USER_ID || '').trim()
  )
  const dryRun = hasFlag('dry-run')
  const emulatorMaxAgeHours = Number.parseFloat(arg('emulator-max-age-hours', '12'))
  const emulatorMaxAgeMs = Number.isFinite(emulatorMaxAgeHours)
    ? Math.max(0, Math.floor(emulatorMaxAgeHours * 60 * 60 * 1000))
    : 12 * 60 * 60 * 1000

  const agenticReportPath = path.resolve(arg('agentic-report', 'tools/bob-agentic-test-runs/latest-run.json'))
  const emulatorReportsRoot = path.resolve(arg('emulator-root', 'tools/agentic-ui-reports'))

  if (!supabaseUrl || !serviceRole) {
    console.warn('[publish-test-failures] Missing required env: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  if (!reporterUser) {
    console.warn('[publish-test-failures] Unable to resolve reporter user ID (set SYNTHETIC_MONITOR_USER_ID or seed an existing bug report)')
    process.exit(1)
  }

  const payloads = []

  if (await exists(agenticReportPath)) {
    const report = await readJson(agenticReportPath)
    const runId = String(report.runId || 'unknown')
    const failedStages = Array.isArray(report.failedStages) ? report.failedStages : []
    const failureContexts = Array.isArray(report.failureContexts) ? report.failureContexts : []
    const summary = report.summary || { passed: 0, failed: 0 }

    payloads.push(mkSummaryReport({
      reporterUser,
      source: 'bob-agentic',
      title: `[Bob Agentic][Run ${runId}] Summary: ${summary.failed > 0 ? 'FAIL' : 'PASS'}`,
      description: [
        `Scope: ${report.scope || 'unknown'} | Batch: ${report.batch || 'unknown'}`,
        `Started: ${report.startedAt || 'unknown'} | Ended: ${report.endedAt || 'in-progress'}`,
        `Stage summary: passed=${summary.passed || 0}, failed=${summary.failed || 0}`,
        `Failure contexts captured: ${failureContexts.length}`,
      ].join('\n'),
      severity: summary.failed > 0 ? 'high' : 'low',
      issueType: 'bug',
    }))

    for (const stage of failedStages) {
      payloads.push(mkSummaryReport({
        reporterUser,
        source: 'bob-agentic',
        title: `[Bob Agentic][Stage Fail] ${stage.id || 'unknown-stage'} — ${stage.description || 'stage failed'}`,
        description: [
          `Run ID: ${runId}`,
          `Stage: ${stage.id || 'unknown'}`,
          `Description: ${stage.description || 'n/a'}`,
          `Exit code: ${String(stage.exitCode ?? 'n/a')}`,
          `Started: ${stage.startedAt || 'n/a'}`,
          `Ended: ${stage.endedAt || 'n/a'}`,
        ].join('\n'),
        severity: 'high',
        issueType: 'bug',
      }))
    }

    for (const ctx of failureContexts.slice(0, 50)) {
      payloads.push(mkSummaryReport({
        reporterUser,
        source: 'bob-agentic',
        title: `[Bob Agentic][Test Failure] ${String(ctx.testName || 'unknown-test').slice(0, 120)}`,
        description: [
          `Run ID: ${runId}`,
          `Location: ${ctx.location || 'n/a'}`,
          `Folder: ${ctx.folder || 'n/a'}`,
          `Error: ${String(ctx.error || '').slice(0, 2000)}`,
        ].join('\n'),
        severity: 'medium',
        issueType: 'bug',
      }))
    }
  } else {
    console.warn(`[publish-test-failures] Agentic report not found: ${agenticReportPath}`)
  }

  if (await exists(emulatorReportsRoot)) {
    const reportFiles = await listReportFiles(emulatorReportsRoot, emulatorMaxAgeMs)
    for (const filePath of reportFiles) {
      const report = await readJson(filePath).catch(() => null)
      if (!report) continue

      const firstActionError = String(report.actions?.[0]?.execution?.error || '')
      if (firstActionError.includes('ERR_CONNECTION_REFUSED') || firstActionError.includes('ECONNREFUSED')) {
        continue
      }

      const reportGoal = report.goal || report.config?.goal || null
      const pack = String(report.pack || reportGoal || path.basename(path.dirname(filePath)))
      const result = String(report.result || 'unknown')
      const level = result === 'completed' ? 'low' : result === 'blocked_auth' ? 'medium' : 'high'

      payloads.push(mkSummaryReport({
        reporterUser,
        source: 'vercel-emulator',
        title: `[Vercel Emulator][${pack}] Result: ${result.toUpperCase()}`,
        description: [
          `Pack: ${pack}`,
          `Goal: ${reportGoal || 'n/a'}`,
          `Result: ${result}`,
          `Started: ${report.started_at || 'n/a'}`,
          `Ended: ${report.ended_at || 'n/a'}`,
          `Actions: ${Array.isArray(report.actions) ? report.actions.length : 0}`,
          `Evidence dir: ${path.dirname(filePath)}`,
          `Findings: ${JSON.stringify(report.compliance_findings || []).slice(0, 2000)}`,
        ].join('\n'),
        severity: level,
        issueType: result === 'completed' ? 'enhancement' : result === 'blocked_auth' ? 'infra' : 'ui_ux',
        currentPage: extractCurrentPageFromReport(report),
      }))
    }
  } else {
    console.warn(`[publish-test-failures] Emulator reports root not found: ${emulatorReportsRoot}`)
  }

  if (payloads.length === 0) {
    console.log('[publish-test-failures] No payloads to publish.')
    return
  }

  let ok = 0
  let failed = 0
  let skippedDuplicates = 0
  const existingOpenTitles = await fetchExistingOpenTitles(supabaseUrl, serviceRole)

  for (const payload of payloads) {
    if (existingOpenTitles.has(payload.title)) {
      skippedDuplicates += 1
      console.log(`[publish-test-failures] skipped duplicate title="${payload.title}"`)
      continue
    }

    if (dryRun) {
      console.log(`[DRY RUN] ${payload.title}`)
      ok += 1
      continue
    }

    const res = await supabasePost(supabaseUrl, serviceRole, '/bug_reports', payload)
    if (res.status >= 200 && res.status < 300) {
      ok += 1
      existingOpenTitles.add(payload.title)
      const id = Array.isArray(res.data) ? res.data[0]?.id : res.data?.id
      console.log(`[publish-test-failures] created bug_report id=${id || '?'} title="${payload.title}"`)
    } else {
      failed += 1
      console.warn(`[publish-test-failures] failed (${res.status}) title="${payload.title}"`)
    }
  }

  console.log(`[publish-test-failures] done: created=${ok}, skipped_duplicates=${skippedDuplicates}, failed=${failed}, total=${payloads.length}`)
  process.exitCode = failed > 0 ? 1 : 0
}

main().catch((error) => {
  console.error('[publish-test-failures] fatal:', error)
  process.exit(1)
})
