#!/usr/bin/env node

import { execSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.cwd()
const SCORECARD_PATH = resolve(ROOT, 'data/live-stack-scorecard.json')
const SELF_HEAL_LIST_PATH = resolve(ROOT, 'data/ci-self-heal-list.json')
const ESCALATION_QUEUE_PATH = resolve(ROOT, 'data/dr-bob-escalation-queue.jsonl')
const ESCALATION_LATEST_PATH = resolve(ROOT, 'data/dr-bob-escalation-latest.json')

function run(command) {
  try {
    return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch {
    return ''
  }
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return fallback
  }
}

function getArg(name, fallback = '') {
  const key = `--${name}`
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '')
    if (token === key) return argv[i + 1] || fallback
    if (token.startsWith(`${key}=`)) return token.slice(key.length + 1)
  }
  return fallback
}

function parseBool(value, fallback = false) {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return fallback
  if (['1', 'true', 'yes', 'y', 'on'].includes(raw)) return true
  if (['0', 'false', 'no', 'n', 'off'].includes(raw)) return false
  return fallback
}

function parseNumber(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function normalizeRun(run) {
  return {
    id: run?.id,
    name: String(run?.name || 'unknown'),
    status: String(run?.status || 'unknown'),
    conclusion: run?.conclusion == null ? null : String(run.conclusion),
    url: String(run?.url || ''),
    updated_at: run?.updated_at || null,
  }
}

function computeFingerprint(headSha, failedRuns) {
  const ids = [...failedRuns].map((r) => String(r.id || '')).sort().join(',')
  return `${headSha || 'unknown'}::${ids}`
}

function appendEscalationQueue(entry) {
  mkdirSync(resolve(ROOT, 'data'), { recursive: true })
  appendFileSync(ESCALATION_QUEUE_PATH, `${JSON.stringify(entry)}\n`, 'utf8')
  writeFileSync(ESCALATION_LATEST_PATH, `${JSON.stringify(entry, null, 2)}\n`, 'utf8')
}

function maybeRerunFailedRuns(failedRuns, enableRerun) {
  const rerunResults = []
  if (!enableRerun) return rerunResults

  for (const failed of failedRuns) {
    const runId = String(failed.id || '').trim()
    if (!runId) continue
    const output = run(`gh run rerun ${runId}`)
    rerunResults.push({
      runId,
      name: failed.name,
      attempted: true,
      success: output.length > 0 || output === '',
      message: output || 'rerun invoked',
    })
  }

  return rerunResults
}

function shouldRerunNow(previousList, fingerprint, cooldownMinutes) {
  const previousFingerprint = String(previousList?.failureFingerprint || '')
  if (previousFingerprint !== fingerprint) return true

  const previousRerunAt = String(previousList?.escalation?.lastRerunAt || '')
  if (!previousRerunAt) return true

  const previousMs = Date.parse(previousRerunAt)
  if (!Number.isFinite(previousMs)) return true

  const elapsedMinutes = (Date.now() - previousMs) / (1000 * 60)
  return elapsedMinutes >= cooldownMinutes
}

function main() {
  const rerunFailed = parseBool(getArg('rerun-failed', process.env.CI_SELF_HEAL_RERUN_FAILED || 'false'))
  const recordOnly = parseBool(getArg('record-only', process.env.CI_SELF_HEAL_RECORD_ONLY || 'false'))
  const rerunCooldownMinutes = Math.max(1, parseNumber(getArg('rerun-cooldown-minutes', process.env.CI_SELF_HEAL_RERUN_COOLDOWN_MINUTES || '20'), 20))

  run('node scripts/generate-live-stack-scorecard.mjs --out=data/live-stack-scorecard.json')

  const scorecard = readJson(SCORECARD_PATH, {})
  const headSha = String(scorecard?.repository?.headSha || run('git rev-parse HEAD'))
  const ci = scorecard?.ci || {}
  const failedRuns = Array.isArray(ci.failed) ? ci.failed.map(normalizeRun) : []
  const activeRuns = Array.isArray(ci.active) ? ci.active.map(normalizeRun) : []

  const previousList = readJson(SELF_HEAL_LIST_PATH, {})
  const previousFingerprint = String(previousList?.failureFingerprint || '')
  const newFingerprint = computeFingerprint(headSha, failedRuns)

  const list = {
    updatedAt: new Date().toISOString(),
    headSha,
    ciTotals: {
      total: Number(ci.total || 0),
      failed: failedRuns.length,
      active: activeRuns.length,
      byStatus: ci.byStatus || {},
      byConclusion: ci.byConclusion || {},
    },
    failedRuns,
    activeRuns,
    selfHealing: {
      requiresAction: Boolean(scorecard?.selfHealing?.posture?.requiresAction),
      ciFailuresPresent: Boolean(scorecard?.selfHealing?.posture?.ciFailuresPresent),
      monitorHealthy: Boolean(scorecard?.selfHealing?.posture?.monitorHealthy),
      liveDiagnosticsHealthy: Boolean(scorecard?.selfHealing?.posture?.liveDiagnosticsHealthy),
    },
    failureFingerprint: newFingerprint,
    escalation: {
      raised: false,
      deduped: false,
      rerunAttempted: false,
      rerunResults: [],
      lastRerunAt: previousList?.escalation?.lastRerunAt || null,
    },
  }

  if (failedRuns.length > 0) {
    const shouldRaise = previousFingerprint !== newFingerprint
    if (shouldRaise) {
      const entry = {
        timestamp: new Date().toISOString(),
        sourceFile: SCORECARD_PATH,
        structured: true,
        decision: 'needs-revision',
        reason: 'ci-failures-detected',
        summary: `CI self-heal detected ${failedRuns.length} failed workflow(s) on ${headSha.slice(0, 8)}.`,
        findingsCount: failedRuns.length,
        topFinding: failedRuns[0]?.name || 'workflow-failure',
        selfHealAttempted: !recordOnly,
        selfHealSuccess: false,
        handoffRequired: true,
        copilotActionHint: 'Inspect failed runs and apply targeted fixes; rerun failed workflows after patching.',
        responsePreview: JSON.stringify({ failedRuns, activeRuns }).slice(0, 700),
      }

      appendEscalationQueue(entry)
      list.escalation.raised = true

      if (!recordOnly) {
        const rerunResults = maybeRerunFailedRuns(failedRuns, rerunFailed)
        list.escalation.rerunAttempted = rerunFailed
        list.escalation.rerunResults = rerunResults
        if (rerunFailed) list.escalation.lastRerunAt = new Date().toISOString()
      }
    } else {
      list.escalation.deduped = true

      if (!recordOnly && rerunFailed && shouldRerunNow(previousList, newFingerprint, rerunCooldownMinutes)) {
        const rerunResults = maybeRerunFailedRuns(failedRuns, true)
        list.escalation.rerunAttempted = true
        list.escalation.rerunResults = rerunResults
        list.escalation.lastRerunAt = new Date().toISOString()
      }
    }
  }

  writeFileSync(SELF_HEAL_LIST_PATH, `${JSON.stringify(list, null, 2)}\n`, 'utf8')

  console.log(`self_heal_list=${SELF_HEAL_LIST_PATH}`)
  console.log(`head_sha=${headSha}`)
  console.log(`failed=${failedRuns.length}`)
  console.log(`active=${activeRuns.length}`)
  console.log(`escalation_raised=${list.escalation.raised}`)
  console.log(`escalation_deduped=${list.escalation.deduped}`)
}

main()
