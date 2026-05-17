#!/usr/bin/env node

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

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

function readJson(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return fallback
  }
}

function readJsonl(path) {
  if (!existsSync(path)) return []
  const lines = readFileSync(path, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)
  const out = []
  for (const line of lines) {
    try {
      out.push(JSON.parse(line))
    } catch {
      // ignore malformed line
    }
  }
  return out
}

function ratio(n, d) {
  if (!d) return null
  return Number((n / d).toFixed(4))
}

function main() {
  const out = resolve(process.cwd(), getArg('out', 'data/research-self-heal-safety-scorecard.json'))
  const listPath = resolve(process.cwd(), getArg('list', 'data/ci-self-heal-list.json'))
  const actionsPath = resolve(process.cwd(), getArg('actions', 'data/ci-self-heal-actions.json'))
  const queuePath = resolve(process.cwd(), getArg('queue', 'data/ci-escalation-queue.jsonl'))

  const list = readJson(listPath, {}) || {}
  const actions = readJson(actionsPath, {}) || {}
  const queue = readJsonl(queuePath)

  const failed = Number(list?.ciTotals?.failed || 0)
  const failedRuns = Array.isArray(list?.failedRuns) ? list.failedRuns.length : 0
  const tasks = Array.isArray(actions?.tasks) ? actions.tasks : []

  const policy = list?.fixing?.policy || {}
  const gateRequired = Boolean(policy?.codeFixesRequireHumanApproval)
  const gateAnnotated = Boolean(policy?.humanGate?.required)
  const gateApproved = Boolean(policy?.humanGate?.approved)

  const escalated = queue.length
  const latestEscalation = queue[queue.length - 1] || null
  const rerunAttempted = Boolean(list?.escalation?.rerunAttempted)

  const openTasks = tasks.filter((t) => String(t?.state || '').toLowerCase() === 'open').length
  const coverageByTask = ratio(tasks.length, failedRuns || failed)

  const payload = {
    generatedAt: new Date().toISOString(),
    inputs: {
      listPath,
      actionsPath,
      queuePath,
      queueEntries: queue.length,
    },
    posture: {
      failures: failedRuns || failed,
      activeFixPlan: String(actions?.status || 'unknown'),
      rerunAttempted,
      escalated,
    },
    metrics: {
      gateDefinedRate: ratio(gateAnnotated ? 1 : 0, 1),
      gateApprovalRate: ratio(gateApproved ? 1 : 0, 1),
      actionTaskCoverage: coverageByTask,
      openTaskRate: ratio(openTasks, tasks.length || 0),
      escalationCoverage: ratio(escalated > 0 || failed === 0 ? 1 : 0, 1),
    },
    checks: {
      codeFixGateRequired: gateRequired,
      codeFixGateAnnotated: gateAnnotated,
      codeFixGateApproved: gateApproved,
      rerunsAutomatic: Boolean(policy?.rerunsAutomatic),
      actionTasksMatchFailures: tasks.length >= (failedRuns || failed),
    },
    riskFlags: [
      !gateAnnotated ? 'missing-human-gate-annotation' : null,
      failed > 0 && tasks.length === 0 ? 'no-action-tasks-for-active-failures' : null,
      failed > 0 && !latestEscalation ? 'no-escalation-entry-for-active-failures' : null,
      gateApproved && !gateRequired ? 'approval-true-without-required-gate' : null,
    ].filter(Boolean),
    recommendations: [
      'Keep workflow reruns automatic but block code mutation until human gate is approved.',
      'Require task coverage >= failed run count to preserve remediation traceability.',
      'Retain escalation queue entries for each new failure fingerprint.',
    ],
  }

  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')

  console.log(`self_heal_safety=${out}`)
  console.log(`failures=${payload.posture.failures}`)
  console.log(`risk_flags=${payload.riskFlags.length}`)
}

main()
