#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { spawn } from 'node:child_process'
import { loadLocalEnv } from './load-local-env.mjs'

loadLocalEnv()

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function parseArgs(argv) {
  const args = {
    scope: 'full',
    outRoot: 'tools/bob-human-ux-audit-runs',
    maxRetries: 1,
    continueOnFailure: true,
    strictTraining: true,
    movements: ['workflows', 'visual', 'human'],
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '')
    if (token === '--help') args.help = true
    else if (token === '--scope') args.scope = String(argv[i + 1] || args.scope)
    else if (token.startsWith('--scope=')) args.scope = token.slice('--scope='.length)
    else if (token === '--out') args.outRoot = String(argv[i + 1] || args.outRoot)
    else if (token.startsWith('--out=')) args.outRoot = token.slice('--out='.length)
    else if (token === '--max-retries') args.maxRetries = Number.parseInt(String(argv[i + 1] || args.maxRetries), 10)
    else if (token.startsWith('--max-retries=')) args.maxRetries = Number.parseInt(token.slice('--max-retries='.length), 10)
    else if (token === '--fail-fast') args.continueOnFailure = false
    else if (token === '--non-strict-training') args.strictTraining = false
    else if (token === '--movements') args.movements = String(argv[i + 1] || '').split(',').map((v) => v.trim()).filter(Boolean)
    else if (token.startsWith('--movements=')) args.movements = token.slice('--movements='.length).split(',').map((v) => v.trim()).filter(Boolean)
  }

  if (!Number.isFinite(args.maxRetries) || args.maxRetries < 0) {
    throw new Error('--max-retries must be a non-negative integer')
  }

  return args
}

function runCommand(command, args, env = process.env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: false,
      env,
      cwd: process.cwd(),
    })

    child.on('close', (code, signal) => {
      if (signal) return resolve(1)
      resolve(code ?? 1)
    })

    child.on('error', () => resolve(1))
  })
}

function classifyIssue(text) {
  const body = String(text || '').toLowerCase()

  // Infra/runtime failures should be treated as architecture blockers, not UX copy defects.
  if (/(browsertype\.launch|target page, context or browser has been closed|symbol not found|error relocating|exitcode=127|failed to launch|missing libraries|playwright.*browser)/.test(body)) {
    return { id: 'architecture', title: 'Architecture/flow' }
  }

  const dimensions = [
    { id: 'ui-layout', title: 'UI layout', re: /layout|grid|responsive|overflow|viewport|alignment|sidebar|header|footer/ },
    { id: 'wording', title: 'Wording', re: /copy|label|text|wording|grammar|spelling|message|placeholder/ },
    { id: 'architecture', title: 'Architecture/flow', re: /route|redirect|navigation|state|session|auth|portal|permission/ },
    { id: 'colour', title: 'Colour/contrast', re: /color|colour|contrast|theme|palette|dark mode|light mode|readability/ },
    { id: 'placement', title: 'Placement/priority', re: /placement|position|z-index|overlap|hidden|occluded|stacking|modal/ },
    { id: 'overwriting', title: 'Overwriting/collision', re: /overwrite|overwriting|collision|replace|clobber|mutate/ },
    { id: 'practicality', title: 'Practicality', re: /workflow|usability|practical|friction|too many steps|slow|confusing/ },
    { id: 'simplicity', title: 'Simplicity', re: /simple|simplicity|complex|noise|clutter|cognitive load/ },
  ]

  for (const d of dimensions) {
    if (d.re.test(body)) return d
  }

  return { id: 'general', title: 'General UX/quality' }
}

function uniqueBy(items, keyFn) {
  const seen = new Set()
  const out = []
  for (const item of items) {
    const k = keyFn(item)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(item)
  }
  return out
}

async function collectFailureContexts() {
  const root = path.resolve('test-results')
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  const contexts = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const contextPath = path.join(root, entry.name, 'error-context.md')
    const raw = await fs.readFile(contextPath, 'utf8').catch(() => '')
    if (!raw) continue

    const name = raw.match(/^- Name:\s*(.+)$/m)?.[1]?.trim() || entry.name
    const location = raw.match(/^- Location:\s*(.+)$/m)?.[1]?.trim() || ''
    const errorBlock = raw.match(/# Error details\s+[\s\S]*?```([\s\S]*?)```/m)?.[1] || ''
    const error = errorBlock
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0) || ''

    contexts.push({ testName: name, location, error, folder: entry.name })
  }

  return contexts
}

function toIssueRecords(contexts, movement) {
  return uniqueBy(
    contexts.map((ctx) => {
      const source = `${ctx.testName} ${ctx.location} ${ctx.error}`.trim()
      const dim = classifyIssue(source)
      const stableKey = [movement, ctx.testName || '', ctx.location || '', ctx.error || ''].join('|').toLowerCase()
      return {
        id: stableKey,
        movement,
        dimension: dim.id,
        dimensionTitle: dim.title,
        testName: ctx.testName,
        location: ctx.location,
        error: ctx.error,
        sourceFolder: ctx.folder,
      }
    }),
    (item) => item.id
  )
}

async function writeIssueArtifacts(outDir, allIssues) {
  const byDimension = {}
  for (const issue of allIssues) {
    byDimension[issue.dimension] ||= []
    byDimension[issue.dimension].push(issue)
  }

  const issuesJsonPath = path.join(outDir, 'issues.json')
  await fs.writeFile(issuesJsonPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), count: allIssues.length, issues: allIssues }, null, 2)}\n`, 'utf8')

  const lines = [
    '# Bob Human UX Audit Issues',
    '',
    `- Generated: ${new Date().toISOString()}`,
    `- Total issues: ${allIssues.length}`,
    '',
    '## By Dimension',
    '',
  ]

  const orderedDimensions = ['ui-layout', 'wording', 'architecture', 'colour', 'placement', 'overwriting', 'practicality', 'simplicity', 'general']
  for (const dimension of orderedDimensions) {
    const group = byDimension[dimension] || []
    if (group.length === 0) continue
    lines.push(`### ${group[0].dimensionTitle}`)
    lines.push('')
    for (const issue of group) {
      lines.push(`- [${issue.movement}] ${issue.testName}`)
      if (issue.location) lines.push(`  - location: ${issue.location}`)
      if (issue.error) lines.push(`  - error: ${issue.error}`)
    }
    lines.push('')
  }

  const issuesMdPath = path.join(outDir, 'issues.md')
  await fs.writeFile(issuesMdPath, `${lines.join('\n')}\n`, 'utf8')

  return { issuesJsonPath, issuesMdPath }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    console.log('Bob Human UX Audit\n\nUsage:\n  node scripts/bob-human-ux-audit.mjs [--scope full|quick] [--max-retries 1] [--out tools/bob-human-ux-audit-runs] [--fail-fast] [--non-strict-training]\n\nFlow:\n  1) Verify Bob training wiring\n  2) Run Bob-led movements (workflows, visual, human)\n  3) Extract and classify issues continuously by UX dimension\n  4) Write issues.json and issues.md artifacts\n')
    process.exit(0)
  }

  const runId = nowStamp()
  const outDir = path.resolve(args.outRoot, runId)
  await fs.mkdir(outDir, { recursive: true })

  const summary = {
    runId,
    startedAt: new Date().toISOString(),
    endedAt: null,
    trainingWiring: { status: 'unknown', report: null },
    movements: [],
    totalIssues: 0,
    issueArtifacts: {},
  }

  const env = {
    ...process.env,
    PLAYWRIGHT_ALLOW_SHARED_CREDENTIAL_FALLBACK: process.env.PLAYWRIGHT_ALLOW_SHARED_CREDENTIAL_FALLBACK || '1',
    PLAYWRIGHT_SKIP_ROLE_ASSERTIONS: process.env.PLAYWRIGHT_SKIP_ROLE_ASSERTIONS || '1',
  }

  console.log('\n[bob-human-ux-audit] Verifying Bob training wiring...')
  const trainingArgs = ['scripts/verify-bob-training-wiring.mjs', '--json-only']
  if (!args.strictTraining) trainingArgs.push('--non-strict')
  const trainingExit = await runCommand(process.execPath || 'node', trainingArgs, env)
  summary.trainingWiring.status = trainingExit === 0 ? 'pass' : 'fail'

  const movements = args.movements
  const allIssues = []

  for (const movement of movements) {
    console.log(`\n[bob-human-ux-audit] Running movement=${movement} ...`)

    const movementOut = path.join(outDir, movement)
    await fs.mkdir(movementOut, { recursive: true })

    let exitCode = 1
    let attempts = 0

    while (attempts <= args.maxRetries) {
      attempts += 1

      // Clear previous failure contexts so each movement gets isolated issue extraction.
      await fs.rm(path.resolve('test-results'), { recursive: true, force: true }).catch(() => {})

      const cmdArgs = [
        'scripts/bob-agentic-test-orchestrator.mjs',
        '--scope', args.scope,
        '--batch', movement,
        '--out', movementOut,
        '--skip-install-browsers',
      ]

      // Orchestrator defaults to continue-on-failure unless --fail-fast is passed.
      if (!args.continueOnFailure) cmdArgs.push('--fail-fast')

      exitCode = await runCommand(process.execPath || 'node', cmdArgs, env)
      if (exitCode === 0) break

      if (attempts <= args.maxRetries) {
        console.warn(`[bob-human-ux-audit] movement=${movement} failed; retry ${attempts}/${args.maxRetries}`)
      }
    }

    const contexts = await collectFailureContexts()
    const movementIssues = toIssueRecords(contexts, movement)
    allIssues.push(...movementIssues)

    summary.movements.push({
      movement,
      status: exitCode === 0 ? 'pass' : 'fail',
      exitCode,
      attempts,
      detectedIssues: movementIssues.length,
    })

    console.log(`[bob-human-ux-audit] movement=${movement} status=${exitCode === 0 ? 'pass' : 'fail'} attempts=${attempts} issues=${movementIssues.length}`)

    if (exitCode !== 0 && !args.continueOnFailure) break
  }

  const uniqueIssues = uniqueBy(allIssues, (i) => i.id)
  summary.totalIssues = uniqueIssues.length
  summary.issueArtifacts = await writeIssueArtifacts(outDir, uniqueIssues)
  summary.endedAt = new Date().toISOString()

  const summaryPath = path.join(outDir, 'summary.json')
  await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')

  console.log('\n[bob-human-ux-audit] Completed')
  console.log(`- Summary: ${summaryPath}`)
  console.log(`- Issues JSON: ${summary.issueArtifacts.issuesJsonPath}`)
  console.log(`- Issues MD: ${summary.issueArtifacts.issuesMdPath}`)

  const hasFailures = summary.trainingWiring.status !== 'pass' || summary.movements.some((m) => m.status !== 'pass')
  if (hasFailures) process.exit(1)
}

main().catch((error) => {
  console.error('[bob-human-ux-audit] fatal:', error?.message || error)
  process.exit(1)
})
