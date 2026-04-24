#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'

function findLatestRolloutDir() {
  const tmpRoot = '/tmp'
  const entries = readdirSync(tmpRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('fc_rollout_'))
    .map((entry) => join(tmpRoot, entry.name))
    .sort()

  return entries.at(-1) ?? null
}

function readLog(filePath) {
  return existsSync(filePath) ? readFileSync(filePath, 'utf8') : ''
}

function matchNumber(log, pattern) {
  const match = log.match(pattern)
  return match ? Number(match[1]) : null
}

function lineStatus(ok, measured = true) {
  if (!measured) return 'not_measured'
  return ok ? 'pass' : 'fail'
}

const rolloutDir = process.argv[2] || findLatestRolloutDir()
if (!rolloutDir) {
  console.error('No rollout log directory found. Run scripts/run-staged-rollout.sh first.')
  process.exit(1)
}

const lintLog = readLog(join(rolloutDir, '1_lint.log'))
const buildLog = readLog(join(rolloutDir, '2_build.log'))
const budgetLog = readLog(join(rolloutDir, '3_budget.log'))
const governanceLog = readLog(join(rolloutDir, '4_governance.log'))
const capabilityLog = readLog(join(rolloutDir, '5_capability.log'))

const buildSeconds = (() => {
  const match = buildLog.match(/built in ([\d.]+)s/)
  return match ? Number(match[1]) : null
})()
const governancePassed = matchNumber(governanceLog, /(\d+) passed \(/)
const capabilityPassed = matchNumber(capabilityLog, /(\d+) passed \(/)
const lintPassed = lintLog.includes('$ eslint .') && !/error/i.test(lintLog.replace('$ eslint .', ''))
const budgetPassed = budgetLog.includes('All bundle budgets satisfied.')

const scorecard = [
  {
    metric: 'Officer core task completion >95%',
    status: lineStatus(null, false),
    evidence: 'No task-completion telemetry in rollout logs',
  },
  {
    metric: 'Admin breach triage median <3 min',
    status: lineStatus(null, false),
    evidence: 'No runtime triage timing telemetry in rollout logs',
  },
  {
    metric: 'Incident high-severity acknowledgment <10 min',
    status: lineStatus(null, false),
    evidence: 'No incident-ack telemetry in rollout logs',
  },
  {
    metric: 'Route/navigation error rate <0.5%',
    status: lineStatus((governancePassed ?? 0) >= 24 && (capabilityPassed ?? 0) >= 77),
    evidence: `Governance ${governancePassed ?? 0}/24; Capability ${capabilityPassed ?? 0}/77 passed`,
  },
  {
    metric: 'Critical accessibility defects = 0 before release',
    status: lineStatus(null, false),
    evidence: 'No dedicated accessibility scan in rollout logs',
  },
  {
    metric: 'P95 interactive targets met per shell budgets',
    status: lineStatus(budgetPassed && buildSeconds !== null),
    evidence: budgetPassed
      ? `Bundle budgets satisfied; production build ${buildSeconds?.toFixed(2) ?? 'n/a'}s`
      : 'Bundle budget failed',
  },
  {
    metric: 'Rollback drill success = 100%',
    status: lineStatus(null, false),
    evidence: 'Rollback drill not exercised in rollout logs',
  },
]

console.log(`Rollout directory: ${rolloutDir}`)
console.log('')
console.log('Validation Gates')
console.log(`- lint: ${lintPassed ? 'pass' : 'fail'}`)
console.log(`- build: ${buildSeconds !== null ? `pass (${buildSeconds.toFixed(2)}s)` : 'fail'}`)
console.log(`- budget: ${budgetPassed ? 'pass' : 'fail'}`)
console.log(`- governance regression: ${governancePassed !== null ? `${governancePassed} passed` : 'fail'}`)
console.log(`- capability regression: ${capabilityPassed !== null ? `${capabilityPassed} passed` : 'fail'}`)
console.log('')
console.log('KPI Scorecard')
for (const row of scorecard) {
  console.log(`- [${row.status}] ${row.metric} — ${row.evidence}`)
}

const measuredFails = scorecard.filter((row) => row.status === 'fail')
if (measuredFails.length > 0 || !lintPassed || buildSeconds === null || !budgetPassed) {
  process.exit(2)
}
