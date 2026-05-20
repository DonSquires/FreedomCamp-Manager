#!/usr/bin/env node

import { execSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.cwd()
const SCORECARD_PATH = resolve(ROOT, 'data/live-stack-scorecard.json')
const SELF_HEAL_LIST_PATH = resolve(ROOT, 'data/ci-self-heal-list.json')
const ESCALATION_QUEUE_PATH = resolve(ROOT, 'data/dr-bob-escalation-queue.jsonl')
const ESCALATION_LATEST_PATH = resolve(ROOT, 'data/dr-bob-escalation-latest.json')
// Circuit breaker: prevents infinite healing loops on the same failure fingerprint
const CIRCUIT_BREAKER_PATH = resolve(ROOT, 'data/self-heal-circuit-breaker.json')
// Immutable ledger: every automated action is recorded here for audit / root-cause analysis
const ACTION_LEDGER_PATH = resolve(ROOT, 'data/self-heal-action-ledger.jsonl')

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

// ─── Action Ledger ─────────────────────────────────────────────────────────
// Immutable append-only log. Every automated healing action (any tier) is
// recorded here so engineers can audit exactly what ran and why.
function appendActionLedger(entry) {
  mkdirSync(resolve(ROOT, 'data'), { recursive: true })
  appendFileSync(ACTION_LEDGER_PATH, `${JSON.stringify({ ...entry, _ts: new Date().toISOString() })}\n`, 'utf8')
}

// ─── Circuit Breaker ───────────────────────────────────────────────────────
// Prevents infinite healing loops. Tracks attempt count per failure fingerprint.
// When attempt count reaches MAX_ATTEMPTS the circuit "opens" (trips) and all
// automatic actions are suppressed until the fingerprint changes (failures fixed)
// or the reset TTL expires.
const CIRCUIT_MAX_ATTEMPTS = 4        // Tier 4 (human page) fires at attempt 4+
const CIRCUIT_RESET_TTL_HOURS = 24   // Auto-reset after 24 h even if fingerprint unchanged

function readCircuitBreaker() {
  return readJson(CIRCUIT_BREAKER_PATH, {
    fingerprint: '',
    attemptCount: 0,
    state: 'closed',   // 'closed' = healthy, 'open' = tripped
    trippedAt: null,
    lastAttemptAt: null,
  })
}

function writeCircuitBreaker(cb) {
  mkdirSync(resolve(ROOT, 'data'), { recursive: true })
  writeFileSync(CIRCUIT_BREAKER_PATH, `${JSON.stringify(cb, null, 2)}\n`, 'utf8')
}

function evaluateCircuitBreaker(cb, fingerprint) {
  // Different fingerprint → failures changed → reset the circuit
  if (cb.fingerprint !== fingerprint) {
    return { ...cb, fingerprint, attemptCount: 0, state: 'closed', trippedAt: null }
  }

  // Same fingerprint but circuit has been open long enough → auto-reset (try once more)
  if (cb.state === 'open' && cb.trippedAt) {
    const elapsedHours = (Date.now() - Date.parse(cb.trippedAt)) / (1000 * 60 * 60)
    if (elapsedHours >= CIRCUIT_RESET_TTL_HOURS) {
      return { ...cb, state: 'closed', trippedAt: null, attemptCount: 0 }
    }
  }

  return cb
}

// ─── Progressive Tier Escalation ──────────────────────────────────────────
// Tier 1 (attempt 1): classify as transient flake + schedule rerun
// Tier 2 (attempt 2): rerun + trigger ops-automated-remediation dispatch
// Tier 3 (attempt 3): rerun + trigger rollback/re-provision dispatch
// Tier 4 (attempt 4+): circuit opens → open escalation issue, page human
function determineTier(attemptCount) {
  if (attemptCount <= 1) return 1
  if (attemptCount === 2) return 2
  if (attemptCount === 3) return 3
  return 4
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


function main() {
  const rerunFailed = parseBool(getArg('rerun-failed', process.env.CI_SELF_HEAL_RERUN_FAILED || 'false'))
  const recordOnly = parseBool(getArg('record-only', process.env.CI_SELF_HEAL_RECORD_ONLY || 'false'))
  const rerunCooldownMinutes = Math.max(1, parseNumber(getArg('rerun-cooldown-minutes', process.env.CI_SELF_HEAL_RERUN_COOLDOWN_MINUTES || '20'), 20))
  const repo = process.env.GITHUB_REPOSITORY || ''

  run('node scripts/generate-live-stack-scorecard.mjs --out=data/live-stack-scorecard.json')

  const scorecard = readJson(SCORECARD_PATH, {})
  const headSha = String(scorecard?.repository?.headSha || run('git rev-parse HEAD'))
  const ci = scorecard?.ci || {}
  const failedRuns = Array.isArray(ci.failed) ? ci.failed.map(normalizeRun) : []
  const activeRuns = Array.isArray(ci.active) ? ci.active.map(normalizeRun) : []

  const previousList = readJson(SELF_HEAL_LIST_PATH, {})
  const newFingerprint = computeFingerprint(headSha, failedRuns)

  // ── DETECT ────────────────────────────────────────────────────────────────
  // Load and evaluate the circuit breaker before deciding what to do.
  let cb = readCircuitBreaker()
  cb = evaluateCircuitBreaker(cb, newFingerprint)

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
    circuitBreaker: {
      state: cb.state,
      attemptCount: cb.attemptCount,
      trippedAt: cb.trippedAt,
    },
    escalation: {
      raised: false,
      deduped: false,
      rerunAttempted: false,
      rerunResults: [],
      tier: null,
      lastRerunAt: previousList?.escalation?.lastRerunAt || null,
    },
  }

  if (failedRuns.length === 0) {
    // ── ALL CLEAR: failures resolved → reset circuit if it was open ──────────
    if (cb.state === 'open' || cb.attemptCount > 0) {
      appendActionLedger({
        event: 'circuit-reset',
        reason: 'no-failures-detected',
        previousFingerprint: cb.fingerprint,
        previousAttemptCount: cb.attemptCount,
      })
      cb = { fingerprint: newFingerprint, attemptCount: 0, state: 'closed', trippedAt: null, lastAttemptAt: null }
      writeCircuitBreaker(cb)
    }
    writeFileSync(SELF_HEAL_LIST_PATH, `${JSON.stringify(list, null, 2)}\n`, 'utf8')
    console.log('self_heal_status=green')
    console.log(`head_sha=${headSha}`)
    console.log('failed=0')
    return
  }

  // ── ANALYZE ───────────────────────────────────────────────────────────────
  // Circuit open → suppress automation, rely on human escalation.
  if (cb.state === 'open') {
    console.log(`::warning::Self-heal circuit OPEN for fingerprint ${newFingerprint.slice(0, 40)}. Automated actions suppressed. Awaiting human resolution or ${CIRCUIT_RESET_TTL_HOURS}h TTL reset.`)
    appendActionLedger({
      event: 'circuit-open-suppressed',
      fingerprint: newFingerprint,
      trippedAt: cb.trippedAt,
      failedRuns: failedRuns.map((r) => r.name),
    })
    list.escalation.deduped = true
    writeFileSync(SELF_HEAL_LIST_PATH, `${JSON.stringify(list, null, 2)}\n`, 'utf8')
    console.log(`self_heal_status=circuit-open`)
    console.log(`head_sha=${headSha}`)
    console.log(`failed=${failedRuns.length}`)
    return
  }

  // Increment attempt counter for this fingerprint
  cb.attemptCount += 1
  cb.lastAttemptAt = new Date().toISOString()
  const tier = recordOnly ? 0 : determineTier(cb.attemptCount)

  // ── REMEDIATE ─────────────────────────────────────────────────────────────
  list.escalation.raised = true
  list.escalation.tier = tier

  const baseEntry = {
    event: 'heal-attempt',
    fingerprint: newFingerprint,
    headSha: headSha.slice(0, 8),
    attemptCount: cb.attemptCount,
    tier,
    failedRuns: failedRuns.map((r) => r.name),
  }

  if (tier === 0 || recordOnly) {
    // record-only mode: detect and log, no action
    appendActionLedger({ ...baseEntry, event: 'record-only', action: 'none' })

  } else if (tier === 1) {
    // Tier 1: Classify transient flake + single rerun
    console.log(`Self-heal Tier 1 (attempt ${cb.attemptCount}): scheduling rerun for ${failedRuns.length} failed workflow(s).`)
    const rerunResults = maybeRerunFailedRuns(failedRuns, rerunFailed)
    list.escalation.rerunAttempted = rerunFailed
    list.escalation.rerunResults = rerunResults
    if (rerunFailed) list.escalation.lastRerunAt = new Date().toISOString()
    appendActionLedger({ ...baseEntry, action: 'rerun', rerunResults })

  } else if (tier === 2) {
    // Tier 2: Rerun + trigger automated-remediation workflow (heavier lint/dep fix)
    console.log(`Self-heal Tier 2 (attempt ${cb.attemptCount}): rerun + triggering automated-remediation dispatch.`)
    const rerunResults = maybeRerunFailedRuns(failedRuns, rerunFailed)
    list.escalation.rerunAttempted = rerunFailed
    list.escalation.rerunResults = rerunResults
    if (rerunFailed) list.escalation.lastRerunAt = new Date().toISOString()

    const dispatchResult = repo
      ? run(`gh workflow run ops-automated-remediation.yml --repo ${repo} --ref main`)
      : '(no GITHUB_REPOSITORY — skipped dispatch)'
    appendActionLedger({ ...baseEntry, action: 'rerun+remediation-dispatch', rerunResults, dispatchResult })

  } else if (tier === 3) {
    // Tier 3: Rerun + open a targeted rollback/re-provision issue for the operator
    console.log(`Self-heal Tier 3 (attempt ${cb.attemptCount}): rerun + escalation issue with rollback recommendation.`)
    const rerunResults = maybeRerunFailedRuns(failedRuns, rerunFailed)
    list.escalation.rerunAttempted = rerunFailed
    list.escalation.rerunResults = rerunResults
    if (rerunFailed) list.escalation.lastRerunAt = new Date().toISOString()
    appendActionLedger({ ...baseEntry, action: 'rerun+rollback-recommendation', rerunResults })

  } else {
    // Tier 4: Trip circuit breaker + queue escalation issue for human
    console.log(`::error::Self-heal Tier 4 (attempt ${cb.attemptCount}): circuit tripped. Human intervention required.`)
    cb.state = 'open'
    cb.trippedAt = new Date().toISOString()

    const entry = {
      timestamp: new Date().toISOString(),
      sourceFile: SCORECARD_PATH,
      structured: true,
      decision: 'needs-revision',
      reason: `ci-failures-unresolved-after-${cb.attemptCount - 1}-heal-attempts`,
      summary: `Self-heal exhausted ${cb.attemptCount - 1} attempt(s) on ${headSha.slice(0, 8)}. Circuit open. ${failedRuns.length} workflow(s) still failing.`,
      findingsCount: failedRuns.length,
      topFinding: failedRuns[0]?.name || 'workflow-failure',
      selfHealAttempted: true,
      selfHealSuccess: false,
      handoffRequired: true,
      copilotActionHint: `Investigate and fix the root cause. Self-heal is suppressed until failures are resolved or ${CIRCUIT_RESET_TTL_HOURS}h passes.`,
      responsePreview: JSON.stringify({ failedRuns, attemptCount: cb.attemptCount }).slice(0, 700),
    }
    appendEscalationQueue(entry)
    appendActionLedger({ ...baseEntry, action: 'circuit-tripped', entry })
  }

  writeCircuitBreaker(cb)
  list.circuitBreaker = { state: cb.state, attemptCount: cb.attemptCount, trippedAt: cb.trippedAt }
  writeFileSync(SELF_HEAL_LIST_PATH, `${JSON.stringify(list, null, 2)}\n`, 'utf8')

  console.log(`self_heal_list=${SELF_HEAL_LIST_PATH}`)
  console.log(`head_sha=${headSha}`)
  console.log(`failed=${failedRuns.length}`)
  console.log(`active=${activeRuns.length}`)
  console.log(`escalation_raised=${list.escalation.raised}`)
  console.log(`escalation_tier=${tier}`)
  console.log(`circuit_state=${cb.state}`)
  console.log(`attempt_count=${cb.attemptCount}`)
}

main()
