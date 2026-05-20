#!/usr/bin/env node

import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

function run(command) {
  try {
    return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch (error) {
    return ''
  }
}

function runJson(command) {
  const output = run(command)
  if (!output) return null
  try {
    return JSON.parse(output)
  } catch {
    return null
  }
}

function readJsonFile(filePath) {
  try {
    const raw = readFileSync(filePath, 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function number(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toDate(value) {
  if (value == null) return null
  if (typeof value === 'number' || /^\d+$/.test(String(value))) {
    const n = Number(value)
    const ms = n < 1_000_000_000_000 ? n * 1000 : n
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const d = new Date(String(value))
  return Number.isNaN(d.getTime()) ? null : d
}

async function fetchGithubRuns({ owner, repo, sha, token }) {
  if (!token || !sha) return { workflow_runs: [] }
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/runs?head_sha=${sha}&per_page=100`
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'fieldops-live-scorecard',
    },
  })
  if (!res.ok) {
    return { workflow_runs: [], error: `GitHub API HTTP ${res.status}` }
  }
  return res.json()
}

function summarizeRuns(workflowRuns) {
  const activeStatuses = new Set(['queued', 'in_progress', 'pending', 'waiting'])
  const byStatus = {}
  const byConclusion = {}

  for (const run of workflowRuns) {
    const status = run.status || 'unknown'
    const conclusion = run.conclusion || 'null'
    byStatus[status] = (byStatus[status] || 0) + 1
    byConclusion[conclusion] = (byConclusion[conclusion] || 0) + 1
  }

  const active = workflowRuns
    .filter((r) => activeStatuses.has(String(r.status || '')))
    .map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      url: r.html_url,
    }))

  const failed = workflowRuns
    .filter((r) => r.conclusion === 'failure')
    .map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      conclusion: r.conclusion,
      url: r.html_url,
    }))

  return {
    total: workflowRuns.length,
    byStatus,
    byConclusion,
    active,
    failed,
  }
}

function resolveSupabaseProjectRef() {
  const fromEnv = process.env.SUPABASE_PROJECT_REF || process.env.PROJECT_REF || process.env.BOB_PROJECT_REF
  if (fromEnv) return fromEnv

  const projects = runJson('supabase projects list --output json')
  if (!Array.isArray(projects) || projects.length === 0) return null

  const linked = projects.find((p) => p?.linked === true)
  return linked?.reference_id || projects[0]?.reference_id || null
}

function summarizeFunctions(functions) {
  const versions = functions
    .map((f) => number(f.version, NaN))
    .filter((v) => Number.isFinite(v))

  const now = Date.now()
  let olderThan30d = 0
  let olderThan90d = 0

  for (const fn of functions) {
    const d = toDate(fn.updated_at)
    if (!d) continue
    const ageDays = (now - d.getTime()) / (1000 * 60 * 60 * 24)
    if (ageDays > 30) olderThan30d += 1
    if (ageDays > 90) olderThan90d += 1
  }

  return {
    total: functions.length,
    version: {
      min: versions.length ? Math.min(...versions) : null,
      max: versions.length ? Math.max(...versions) : null,
      avg: versions.length ? Number((versions.reduce((a, b) => a + b, 0) / versions.length).toFixed(2)) : null,
    },
    stale: {
      olderThan30d,
      olderThan90d,
    },
    newest: functions
      .slice()
      .sort((a, b) => {
        const da = toDate(a.updated_at)?.getTime() || 0
        const db = toDate(b.updated_at)?.getTime() || 0
        return db - da
      })
      .slice(0, 10)
      .map((f) => ({ name: f.name, version: f.version, updated_at: f.updated_at })),
  }
}

async function main() {
  const outputArg = process.argv.find((arg) => arg.startsWith('--out='))
  const outPath = resolve(process.cwd(), outputArg ? outputArg.split('=')[1] : 'data/live-stack-scorecard.json')

  const owner = process.env.GITHUB_OWNER || 'DonSquires'
  const repo = process.env.GITHUB_REPO || 'FreedomCamp-Manager'
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || ''
  const sha = run('git rev-parse HEAD')

  const gh = await fetchGithubRuns({ owner, repo, sha, token })
  const workflowRuns = Array.isArray(gh.workflow_runs) ? gh.workflow_runs : []

  const projectRef = resolveSupabaseProjectRef()
  const functions = projectRef
    ? runJson(`supabase functions list --project-ref ${projectRef} --output json`) || []
    : []

  const payload = {
    generatedAt: new Date().toISOString(),
    repository: {
      owner,
      repo,
      headSha: sha,
    },
    ci: {
      source: 'github_actions',
      error: gh.error || null,
      runs: workflowRuns.map((r) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        conclusion: r.conclusion,
        created_at: r.created_at,
        updated_at: r.updated_at,
        url: r.html_url,
      })),
      ...summarizeRuns(workflowRuns),
    },
    supabase: {
      projectRef,
      source: projectRef ? 'supabase_cli' : 'unavailable',
      ...summarizeFunctions(Array.isArray(functions) ? functions : []),
    },
  }

  const monitorHeartbeat = readJsonFile(resolve(process.cwd(), 'data/monitor-heartbeat.json'))
  const liveSessionDiagnostics = readJsonFile(resolve(process.cwd(), 'data/live-session-diagnostics-summary.json'))
  const runpodSelfTest = readJsonFile(resolve(process.cwd(), 'data/bob-last-runpod-self-test.json'))

  const hasCiFailure = (payload.ci.byConclusion.failure || 0) > 0
  const liveDiagStatus = String(liveSessionDiagnostics?.status || 'unknown')
  const monitorErrorCount = number(monitorHeartbeat?.error_count, 0)

  payload.selfHealing = {
    source: 'existing-repo-self-heal-system',
    monitorHeartbeat,
    liveSessionDiagnostics,
    runpodSelfTest,
    posture: {
      ciFailuresPresent: hasCiFailure,
      monitorHealthy: monitorErrorCount === 0,
      liveDiagnosticsHealthy: liveDiagStatus === 'healthy',
      requiresAction: hasCiFailure || liveDiagStatus === 'warning' || liveDiagStatus === 'stale' || liveDiagStatus === 'unavailable',
    },
    bridgeDraft: hasCiFailure
      ? {
          title: 'CI Self-Heal Review Request',
          workflow: 'ci-self-heal-bridge',
          summary: `CI has ${payload.ci.byConclusion.failure || 0} failed workflow(s) on ${sha.slice(0, 8)} with self-heal telemetry attached.`,
          report: {
            severity: (payload.ci.byConclusion.failure || 0) >= 2 ? 'high' : 'medium',
            expected_behavior: 'All required CI workflows complete successfully for the head commit.',
            actual_behavior: `${payload.ci.byConclusion.failure || 0} workflow(s) failed; ${payload.ci.active.length} still active.`,
            reproduction_steps: [
              'Run npm run research:stack:scorecard to refresh CI + self-heal telemetry.',
              'Review ci.failed list and linked workflow URLs.',
              'Submit report to /self-heal/bug-report or Bob collaboration queue for remediation planning.',
            ],
            evidence: {
              failed_workflows: payload.ci.failed,
              active_workflows: payload.ci.active,
              monitor_heartbeat: monitorHeartbeat,
              live_session_diagnostics: liveSessionDiagnostics,
            },
          },
        }
      : null,
  }

  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8')

  console.log(`scorecard=${outPath}`)
  console.log(`ci_total=${payload.ci.total}`)
  console.log(`ci_active=${payload.ci.active.length}`)
  console.log(`supabase_functions=${payload.supabase.total}`)
  console.log(`self_heal_requires_action=${payload.selfHealing.posture.requiresAction}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
