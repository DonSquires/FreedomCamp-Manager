#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

function parseArgs(argv) {
  const args = {
    gateDir: 'tools/human-trial-gate',
    outDir: 'tools/human-trial-gate',
    passThreshold: 85,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '')
    if (token === '--gate-dir') args.gateDir = String(argv[i + 1] || args.gateDir)
    else if (token.startsWith('--gate-dir=')) args.gateDir = token.slice('--gate-dir='.length)
    else if (token === '--out-dir') args.outDir = String(argv[i + 1] || args.outDir)
    else if (token.startsWith('--out-dir=')) args.outDir = token.slice('--out-dir='.length)
    else if (token === '--pass-threshold') args.passThreshold = Number.parseInt(String(argv[i + 1] || args.passThreshold), 10)
    else if (token.startsWith('--pass-threshold=')) args.passThreshold = Number.parseInt(token.slice('--pass-threshold='.length), 10)
  }

  if (!Number.isFinite(args.passThreshold) || args.passThreshold < 1 || args.passThreshold > 100) {
    throw new Error('--pass-threshold must be an integer between 1 and 100')
  }

  return args
}

async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function toArray(value) {
  return Array.isArray(value) ? value : []
}

function scoreReadiness(summary, aiAssist) {
  let score = 100

  const blockers = Number(summary?.counts?.blockers || 0)
  const majors = Number(summary?.counts?.majors || 0)
  const failedSteps = Number(summary?.counts?.failedSteps || 0)

  score -= blockers * 30
  score -= majors * 10
  score -= failedSteps * 20

  const aiSuccess = Boolean(aiAssist?.success)
  if (!aiSuccess) score -= 25

  const capabilityResults = toArray(aiAssist?.capabilityResults)
  const failedCapabilities = capabilityResults.filter((item) => !item?.success)
  score -= failedCapabilities.length * 10

  if (score < 0) score = 0
  if (score > 100) score = 100

  return {
    score,
    blockers,
    majors,
    failedSteps,
    aiSuccess,
    failedCapabilities: failedCapabilities.map((item) => String(item?.capability || 'unknown')),
  }
}

function determineVerdict({ score, blockers, failedSteps, aiSuccess }, passThreshold) {
  if (blockers > 0 || failedSteps > 0 || !aiSuccess) return 'NO_GO'
  if (score >= passThreshold) return 'GO'
  return 'CONDITIONAL_GO'
}

function buildActions({ blockers, failedSteps, aiSuccess, failedCapabilities }) {
  const actions = []

  if (!aiSuccess) {
    actions.push({
      priority: 'P0',
      owner: 'AI Platform',
      action: 'Fix mandatory AI assistance path (OpenAI-style primary or Bob fallback) and rerun gate.',
      verify: 'Mandatory AI preflight and mandatory AI assist must both pass.',
    })
  }

  for (const capability of failedCapabilities) {
    actions.push({
      priority: 'P0',
      owner: 'AI Platform',
      action: `Restore AI capability: ${capability}.`,
      verify: `ai-assist-result.json shows success for capability ${capability}.`,
    })
  }

  if (blockers > 0) {
    actions.push({
      priority: 'P0',
      owner: 'Engineering',
      action: 'Resolve blocker defects before feature expansion.',
      verify: 'summary.json blocker count is 0.',
    })
  }

  if (failedSteps > 0) {
    actions.push({
      priority: 'P0',
      owner: 'Engineering',
      action: 'Fix failed critical gate steps and rerun the same workflow.',
      verify: 'summary.json failedSteps count is 0.',
    })
  }

  if (actions.length === 0) {
    actions.push({
      priority: 'P1',
      owner: 'Product+Ops',
      action: 'Proceed with controlled trial sign-off and launch scheduling.',
      verify: 'Checklist sign-off complete and trial window confirmed.',
    })
  }

  return actions
}

function renderMarkdown(report) {
  const lines = [
    '# Enterprise Readiness Report',
    '',
    `- Generated: ${report.generatedAt}`,
    `- Verdict: ${report.verdict}`,
    `- Readiness score: ${report.score}/100`,
    `- Pass threshold: ${report.passThreshold}`,
    '',
    '## Signals',
    '',
    `- Blockers: ${report.signals.blockers}`,
    `- Majors: ${report.signals.majors}`,
    `- Failed critical steps: ${report.signals.failedSteps}`,
    `- AI mandatory assist success: ${report.signals.aiSuccess ? 'yes' : 'no'}`,
    `- Failed AI capabilities: ${report.signals.failedCapabilities.join(', ') || 'none'}`,
    '',
    '## Required Actions',
    '',
  ]

  for (const item of report.actions) {
    lines.push(`- [${item.priority}] ${item.owner}: ${item.action}`)
    lines.push(`  - verify: ${item.verify}`)
  }

  return `${lines.join('\n')}\n`
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const gateDir = path.resolve(args.gateDir)
  const outDir = path.resolve(args.outDir)

  await fs.mkdir(outDir, { recursive: true })

  const summary = await readJsonIfExists(path.join(gateDir, 'summary.json'))
  const aiAssist = await readJsonIfExists(path.join(gateDir, 'ai-assist-result.json'))

  const scoring = scoreReadiness(summary || {}, aiAssist || {})
  const verdict = determineVerdict(scoring, args.passThreshold)
  const actions = buildActions(scoring)

  const report = {
    generatedAt: new Date().toISOString(),
    passThreshold: args.passThreshold,
    verdict,
    score: scoring.score,
    signals: {
      blockers: scoring.blockers,
      majors: scoring.majors,
      failedSteps: scoring.failedSteps,
      aiSuccess: scoring.aiSuccess,
      failedCapabilities: scoring.failedCapabilities,
    },
    sources: {
      summaryPath: path.join(gateDir, 'summary.json'),
      aiAssistPath: path.join(gateDir, 'ai-assist-result.json'),
    },
    actions,
  }

  const jsonPath = path.join(outDir, 'enterprise-readiness.json')
  const mdPath = path.join(outDir, 'enterprise-readiness.md')

  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await fs.writeFile(mdPath, renderMarkdown(report), 'utf8')

  console.log('[enterprise-readiness-report] wrote:')
  console.log(`- ${jsonPath}`)
  console.log(`- ${mdPath}`)
  console.log(`[enterprise-readiness-report] verdict=${verdict} score=${report.score}`)
}

main().catch((error) => {
  console.error('[enterprise-readiness-report] fatal:', error?.message || error)
  process.exit(1)
})
