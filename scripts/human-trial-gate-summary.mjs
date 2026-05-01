#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

function parseArgs(argv) {
  const args = {
    outDir: 'tools/human-trial-gate',
    bobRunsRoot: 'tools/bob-human-ux-audit-runs',
    testResultsRoot: 'test-results',
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '')
    if (token === '--out-dir') args.outDir = String(argv[i + 1] || args.outDir)
    else if (token.startsWith('--out-dir=')) args.outDir = token.slice('--out-dir='.length)
    else if (token === '--bob-runs-root') args.bobRunsRoot = String(argv[i + 1] || args.bobRunsRoot)
    else if (token.startsWith('--bob-runs-root=')) args.bobRunsRoot = token.slice('--bob-runs-root='.length)
    else if (token === '--test-results-root') args.testResultsRoot = String(argv[i + 1] || args.testResultsRoot)
    else if (token.startsWith('--test-results-root=')) args.testResultsRoot = token.slice('--test-results-root='.length)
  }

  return args
}

async function fileExists(target) {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

function safeText(value) {
  return String(value || '').trim()
}

function classifyPlaywrightSeverity(text) {
  const body = safeText(text).toLowerCase()
  if (!body) return 'major'

  if (/(browsertype\.launch|target page, context or browser has been closed|error relocating|symbol not found|failed to launch|missing libraries|exitcode=127)/.test(body)) {
    return 'blocker'
  }

  if (/(preview server never became ready|web server|econnrefused|err_connection_refused|navigation timeout|timed out|timeout\s+of\s+\d+ms)/.test(body)) {
    return 'blocker'
  }

  return 'major'
}

function classifyBobSeverity(issue) {
  const dimension = safeText(issue?.dimension).toLowerCase()

  if (dimension === 'architecture') return 'blocker'
  if (dimension === 'wording' || dimension === 'general') return 'minor'

  return 'major'
}

async function findLatestTimestampDir(root) {
  const absRoot = path.resolve(root)
  const entries = await fs.readdir(absRoot, { withFileTypes: true }).catch(() => [])
  const dirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a))

  if (dirs.length === 0) return null
  return path.join(absRoot, dirs[0])
}

async function collectBobIssues(bobRunsRoot) {
  const latestRunDir = await findLatestTimestampDir(bobRunsRoot)
  if (!latestRunDir) {
    return { source: null, summary: null, issues: [] }
  }

  const issuesPath = path.join(latestRunDir, 'issues.json')
  const summaryPath = path.join(latestRunDir, 'summary.json')

  const issuesRaw = await fs.readFile(issuesPath, 'utf8').catch(() => '')
  const summaryRaw = await fs.readFile(summaryPath, 'utf8').catch(() => '')

  let issuesJson = null
  let summaryJson = null

  try {
    issuesJson = issuesRaw ? JSON.parse(issuesRaw) : null
  } catch {
    issuesJson = null
  }

  try {
    summaryJson = summaryRaw ? JSON.parse(summaryRaw) : null
  } catch {
    summaryJson = null
  }

  const issues = Array.isArray(issuesJson?.issues) ? issuesJson.issues : []
  return { source: latestRunDir, summary: summaryJson, issues }
}

async function collectPlaywrightFailures(testResultsRoot) {
  const absRoot = path.resolve(testResultsRoot)
  const entries = await fs.readdir(absRoot, { withFileTypes: true }).catch(() => [])
  const failures = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const contextPath = path.join(absRoot, entry.name, 'error-context.md')
    if (!(await fileExists(contextPath))) continue

    const raw = await fs.readFile(contextPath, 'utf8').catch(() => '')
    if (!raw) continue

    const testName = raw.match(/^- Name:\s*(.+)$/m)?.[1]?.trim() || entry.name
    const location = raw.match(/^- Location:\s*(.+)$/m)?.[1]?.trim() || ''
    const errorBlock = raw.match(/# Error details\s+[\s\S]*?```([\s\S]*?)```/m)?.[1] || ''

    const error = errorBlock
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0) || ''

    const severity = classifyPlaywrightSeverity(`${testName} ${location} ${error}`)

    failures.push({
      id: `playwright|${entry.name}`,
      source: 'playwright',
      severity,
      testName,
      location,
      error,
    })
  }

  return failures
}

function collectStepOutcomesFromEnv() {
  const mapping = [
    ['verify_training', process.env.OUTCOME_VERIFY_TRAINING],
    ['validate_credentials', process.env.OUTCOME_VALIDATE_CREDENTIALS],
    ['lint', process.env.OUTCOME_LINT],
    ['nav_parity', process.env.OUTCOME_NAV_PARITY],
    ['build', process.env.OUTCOME_BUILD],
    ['api_suite', process.env.OUTCOME_API_SUITE],
    ['focused_suite', process.env.OUTCOME_FOCUSED_SUITE],
    ['human_modules', process.env.OUTCOME_HUMAN_MODULES],
    ['deep_suite', process.env.OUTCOME_DEEP_SUITE],
  ]

  return mapping
    .filter(([, status]) => safeText(status).length > 0)
    .map(([id, status]) => ({ id, status: safeText(status).toLowerCase() }))
}

function buildSummary({ bobData, playwrightFailures, stepOutcomes }) {
  const items = []

  for (const issue of bobData.issues) {
    const severity = classifyBobSeverity(issue)
    items.push({
      id: `bob|${safeText(issue?.id) || Math.random().toString(36).slice(2)}`,
      source: 'bob-audit',
      severity,
      testName: safeText(issue?.testName),
      location: safeText(issue?.location),
      error: safeText(issue?.error),
      dimension: safeText(issue?.dimension),
    })
  }

  items.push(...playwrightFailures)

  const blockers = items.filter((item) => item.severity === 'blocker')
  const majors = items.filter((item) => item.severity === 'major')
  const minors = items.filter((item) => item.severity === 'minor')

  const failedSteps = stepOutcomes.filter((step) => step.status === 'failure' || step.status === 'cancelled')

  const verdict = blockers.length > 0 || failedSteps.length > 0
    ? 'NO_GO'
    : majors.length > 0
      ? 'CONDITIONAL_GO'
      : 'GO'

  return {
    generatedAt: new Date().toISOString(),
    verdict,
    counts: {
      blockers: blockers.length,
      majors: majors.length,
      minors: minors.length,
      failedSteps: failedSteps.length,
    },
    gate: {
      stepOutcomes,
      failedSteps,
    },
    sources: {
      bobAuditRunDir: bobData.source,
      bobAuditMovementSummary: bobData.summary?.movements || [],
      playwrightFailureCount: playwrightFailures.length,
    },
    issues: {
      blockers,
      majors,
      minors,
    },
  }
}

function renderSummaryMarkdown(summary) {
  const lines = [
    '# Human Trial Gate Summary',
    '',
    `- Generated: ${summary.generatedAt}`,
    `- Verdict: ${summary.verdict}`,
    `- Blockers: ${summary.counts.blockers}`,
    `- Majors: ${summary.counts.majors}`,
    `- Minors: ${summary.counts.minors}`,
    `- Failed gate steps: ${summary.counts.failedSteps}`,
    '',
    '## Gate Step Outcomes',
    '',
  ]

  if (summary.gate.stepOutcomes.length === 0) {
    lines.push('- No step outcomes were provided by the workflow environment.')
  } else {
    for (const step of summary.gate.stepOutcomes) {
      lines.push(`- ${step.id}: ${step.status}`)
    }
  }

  lines.push('', '## Blockers', '')
  if (summary.issues.blockers.length === 0) {
    lines.push('- None')
  } else {
    for (const issue of summary.issues.blockers) {
      lines.push(`- [${issue.source}] ${issue.testName || issue.id}`)
      if (issue.location) lines.push(`  - location: ${issue.location}`)
      if (issue.error) lines.push(`  - error: ${issue.error}`)
      if (issue.dimension) lines.push(`  - dimension: ${issue.dimension}`)
    }
  }

  lines.push('', '## Majors', '')
  if (summary.issues.majors.length === 0) {
    lines.push('- None')
  } else {
    for (const issue of summary.issues.majors) {
      lines.push(`- [${issue.source}] ${issue.testName || issue.id}`)
      if (issue.location) lines.push(`  - location: ${issue.location}`)
      if (issue.error) lines.push(`  - error: ${issue.error}`)
      if (issue.dimension) lines.push(`  - dimension: ${issue.dimension}`)
    }
  }

  lines.push('', '## Minors', '')
  if (summary.issues.minors.length === 0) {
    lines.push('- None')
  } else {
    for (const issue of summary.issues.minors) {
      lines.push(`- [${issue.source}] ${issue.testName || issue.id}`)
      if (issue.location) lines.push(`  - location: ${issue.location}`)
      if (issue.error) lines.push(`  - error: ${issue.error}`)
      if (issue.dimension) lines.push(`  - dimension: ${issue.dimension}`)
    }
  }

  return `${lines.join('\n')}\n`
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  const bobData = await collectBobIssues(args.bobRunsRoot)
  const playwrightFailures = await collectPlaywrightFailures(args.testResultsRoot)
  const stepOutcomes = collectStepOutcomesFromEnv()

  const summary = buildSummary({ bobData, playwrightFailures, stepOutcomes })
  const outDir = path.resolve(args.outDir)

  await fs.mkdir(outDir, { recursive: true })

  const summaryJsonPath = path.join(outDir, 'summary.json')
  const summaryMdPath = path.join(outDir, 'summary.md')

  await fs.writeFile(summaryJsonPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  await fs.writeFile(summaryMdPath, renderSummaryMarkdown(summary), 'utf8')

  console.log('[human-trial-gate-summary] wrote:')
  console.log(`- ${summaryJsonPath}`)
  console.log(`- ${summaryMdPath}`)
  console.log(`[human-trial-gate-summary] verdict=${summary.verdict} blockers=${summary.counts.blockers} majors=${summary.counts.majors} minors=${summary.counts.minors}`)
}

main().catch((error) => {
  console.error('[human-trial-gate-summary] fatal:', error?.message || error)
  process.exit(1)
})
