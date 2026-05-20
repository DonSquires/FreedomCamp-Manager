#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import process from 'node:process'
import { loadLocalEnv } from './load-local-env.mjs'

loadLocalEnv()

const DEFAULT_SHARED_PROJECTS = ['chromium', 'firefox', 'webkit', 'Mobile Chrome', 'Mobile Safari']

function resolveSharedProjects() {
  const raw = String(process.env.BOB_AGENTIC_PROJECTS || '').trim()
  if (!raw) return DEFAULT_SHARED_PROJECTS

  const parsed = raw
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)

  return parsed.length > 0 ? parsed : DEFAULT_SHARED_PROJECTS
}

const SHARED_PROJECTS = resolveSharedProjects()

const STAGE_CATALOG = {
  lint: {
    id: 'lint',
    description: 'Lint codebase',
    command: 'npm',
    args: ['run', 'lint'],
    bobAssist: true,
  },
  build: {
    id: 'build',
    description: 'Build app',
    command: 'npm',
    args: ['run', 'build'],
    bobAssist: true,
  },
  'nav-parity': {
    id: 'nav-parity',
    description: 'Run navigation parity tests',
    command: 'npm',
    args: ['run', 'test:nav-parity'],
    bobAssist: true,
  },
  unit: {
    id: 'unit',
    description: 'Run unit tests',
    command: 'npm',
    args: ['run', 'test:unit'],
    bobAssist: true,
  },
  api: {
    id: 'api',
    description: 'Run API supporting-function tests',
    command: 'npm',
    args: ['run', 'test:api'],
    bobAssist: true,
  },
  'workflow-e2e-all-projects': {
    id: 'workflow-e2e-all-projects',
    description: 'Run end-to-end workflow tests across desktop/mobile projects',
    command: 'npx',
    args: [
      'playwright',
      'test',
      'tests/e2e/deep-functional.spec.ts',
      'tests/e2e/module-route-access.spec.ts',
      'tests/e2e/module-e2e-comprehensive.spec.ts',
      'tests/e2e/ui-comprehensive.spec.ts',
      'tests/e2e/officer-portal-walkthrough.spec.ts',
      'tests/e2e/crm-business-crossover.spec.ts',
      'tests/e2e/client-portal-isolation.spec.ts',
      'tests/e2e/asset-management-scan.spec.ts',
      'tests/e2e/report-generation.spec.ts',
      'tests/e2e/capability-overview.spec.ts',
      ...SHARED_PROJECTS.flatMap((project) => ['--project', project]),
      '--reporter=list,json',
    ],
    bobAssist: true,
  },
  'visual-e2e-emulation': {
    id: 'visual-e2e-emulation',
    description: 'Run visual regression-style sweeps on desktop and mobile emulation',
    command: 'npx',
    args: [
      'playwright',
      'test',
      'tests/e2e/crm-service-provider-visual.spec.ts',
      '--project',
      'chromium',
      '--project',
      'Mobile Chrome',
      '--project',
      'Mobile Safari',
      '--reporter=list,json',
    ],
    bobAssist: true,
  },
  'human-engine': {
    id: 'human-engine',
    description: 'Run agentic human-test engine for broad UI workflow probing',
    command: 'node',
    args: ['scripts/human-test-engine.mjs'],
    bobAssist: true,
  },
}

const BATCHES = {
  core: ['lint', 'build', 'nav-parity', 'unit', 'api'],
  workflows: ['workflow-e2e-all-projects'],
  visual: ['visual-e2e-emulation'],
  human: ['human-engine'],
}

const RETENTION_LATEST_FILE = 'latest-run.json'
const RETENTION_HISTORY_FILE = 'history.jsonl'

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function parseArgs(argv) {
  const args = {
    scope: 'full',
    installBrowsers: true,
    continueOnFailure: true,
    outRoot: 'tools/bob-agentic-test-runs',
    fallbackCreds: true,
    batch: 'all',
    resume: false,
    resumeRunId: '',
    fromStage: '',
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--help') args.help = true
    else if (token === '--list-batches') args.listBatches = true
    else if (token === '--scope') args.scope = String(argv[i + 1] || 'full')
    else if (token.startsWith('--scope=')) args.scope = token.slice('--scope='.length)
    else if (token === '--batch') args.batch = String(argv[i + 1] || 'all')
    else if (token.startsWith('--batch=')) args.batch = token.slice('--batch='.length)
    else if (token === '--resume') args.resume = true
    else if (token === '--resume-run') args.resumeRunId = String(argv[i + 1] || '')
    else if (token.startsWith('--resume-run=')) args.resumeRunId = token.slice('--resume-run='.length)
    else if (token === '--from-stage') args.fromStage = String(argv[i + 1] || '')
    else if (token.startsWith('--from-stage=')) args.fromStage = token.slice('--from-stage='.length)
    else if (token === '--skip-install-browsers') args.installBrowsers = false
    else if (token === '--fail-fast') args.continueOnFailure = false
    else if (token === '--no-fallback-creds') args.fallbackCreds = false
    else if (token === '--out') args.outRoot = String(argv[i + 1] || args.outRoot)
    else if (token.startsWith('--out=')) args.outRoot = token.slice('--out='.length)
  }

  return args
}

function stageIdsForScope(scope) {
  if (scope === 'quick') {
    return ['lint', 'build', 'nav-parity', 'workflow-e2e-all-projects', 'visual-e2e-emulation']
  }

  return [
    ...BATCHES.core,
    ...BATCHES.workflows,
    ...BATCHES.visual,
    ...BATCHES.human,
  ]
}

function selectStageIds(args) {
  const scopeIds = stageIdsForScope(args.scope)
  if (args.batch === 'all') return scopeIds

  if (!Object.prototype.hasOwnProperty.call(BATCHES, args.batch)) {
    throw new Error(`Unknown batch "${args.batch}". Use --list-batches to view valid values.`)
  }

  const batchSet = new Set(BATCHES[args.batch])
  return scopeIds.filter((id) => batchSet.has(id))
}

function applyFromStage(stageIds, fromStage) {
  if (!fromStage) return stageIds
  const index = stageIds.indexOf(fromStage)
  if (index < 0) {
    throw new Error(`--from-stage value "${fromStage}" was not found in the selected stage set.`)
  }
  return stageIds.slice(index)
}

function stageList(args) {
  const ids = applyFromStage(selectStageIds(args), args.fromStage)
  return ids.map((id) => {
    const stage = STAGE_CATALOG[id]
    if (!stage) throw new Error(`Stage "${id}" is not defined in STAGE_CATALOG.`)
    return stage
  })
}

async function findLatestRunId(outRoot) {
  const root = path.resolve(outRoot)
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  const dirs = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dirPath = path.join(root, entry.name)
    const stat = await fs.stat(dirPath).catch(() => null)
    if (stat) dirs.push({ name: entry.name, mtimeMs: stat.mtimeMs })
  }

  dirs.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return dirs[0]?.name || ''
}

async function loadExistingReport(outRoot, runId) {
  const reportPath = path.join(path.resolve(outRoot), runId, 'report.json')
  const raw = await fs.readFile(reportPath, 'utf8').catch(() => '')
  if (!raw) return null
  return JSON.parse(raw)
}

async function saveReport(outDir, report) {
  const reportJsonPath = path.join(outDir, 'report.json')
  const reportMdPath = path.join(outDir, 'report.md')
  await fs.writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await fs.writeFile(reportMdPath, `${toMd(report)}\n`, 'utf8')
}

function recalcSummary(report) {
  report.summary = report.stages.reduce(
    (acc, stage) => {
      if (stage.status === 'pass') acc.passed += 1
      if (stage.status === 'fail') acc.failed += 1
      return acc
    },
    { passed: 0, failed: 0 }
  )
}

function upsertStage(report, stageEntry) {
  const existingIndex = report.stages.findIndex((stage) => stage.id === stageEntry.id)
  if (existingIndex >= 0) report.stages[existingIndex] = stageEntry
  else report.stages.push(stageEntry)
  recalcSummary(report)
}

function runCommand(command, args, env = process.env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env,
      shell: false,
    })

    child.on('close', (code, signal) => {
      if (signal) return resolve(1)
      resolve(code ?? 1)
    })

    child.on('error', () => resolve(1))
  })
}

function commandExists(command) {
  const probe = spawnSync('sh', ['-lc', `command -v ${command}`], {
    stdio: 'ignore',
    shell: false,
  })

  return !probe.error && probe.status === 0
}

function resolveToolchain() {
  const hasNpm = commandExists('npm')
  const hasNpx = commandExists('npx')

  if (!hasNpm) {
    throw new Error('npm is not available in PATH. Cannot run orchestrator stages.')
  }

  if (!hasNpx) {
    throw new Error('npx is not available in PATH. Cannot run Playwright stages.')
  }

  return {
    scriptRunner: 'npm',
    packageExecutor: 'npx',
  }
}

function resolveStageInvocation(stage, toolchain) {
  if (stage.command === 'npm') {
    return {
      command: toolchain.scriptRunner,
      args: stage.args,
    }
  }

  if (stage.command === 'npx') {
    return {
      command: toolchain.packageExecutor,
      args: stage.args,
    }
  }

  return {
    command: stage.command,
    args: stage.args,
  }
}

function withBobAssist(command, args) {
  const runtime = process.execPath || 'node'
  return {
    command: runtime,
    args: ['scripts/run-test-with-bob-assist.mjs', '--', command, ...args],
  }
}

function hasBugReporterEnv(env) {
  return Boolean(
    String(env.VITE_SUPABASE_URL || '').trim() &&
    String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  )
}

async function autoPublishBugReports({ env, args }) {
  const autoPublishEnabled = String(env.BOB_AUTO_PUBLISH_BUG_REPORTS || '1').trim() !== '0'
  if (!autoPublishEnabled) {
    console.log('[bob-agentic-test-orchestrator] Auto publish to bug_reports disabled by BOB_AUTO_PUBLISH_BUG_REPORTS=0')
    return { attempted: false, skipped: 'disabled', exitCode: 0 }
  }

  if (!hasBugReporterEnv(env)) {
    console.log('[bob-agentic-test-orchestrator] Skipping bug_report publish: missing VITE_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY')
    return { attempted: false, skipped: 'missing-env', exitCode: 0 }
  }

  const publisher = process.execPath || 'node'
  const latestReportPath = path.join(path.resolve(args.outRoot), RETENTION_LATEST_FILE)
  const emulatorRoot = path.resolve('tools/agentic-ui-reports')

  const exitCode = await runCommand(
    publisher,
    [
      'scripts/publish-test-failures-to-bug-reports.mjs',
      '--agentic-report',
      latestReportPath,
      '--emulator-root',
      emulatorRoot,
    ],
    env
  )

  if (exitCode === 0) {
    console.log('[bob-agentic-test-orchestrator] bug_reports publish completed')
  } else {
    console.warn('[bob-agentic-test-orchestrator] bug_reports publish failed')
  }

  return { attempted: true, skipped: null, exitCode }
}

function toMd(report) {
  return [
    '# Bob Agentic Test Orchestrator Report',
    '',
    `- Run ID: ${report.runId}`,
    `- Batch: ${report.batch}`,
    `- Scope: ${report.scope}`,
    `- Started: ${report.startedAt}`,
    `- Ended: ${report.endedAt}`,
    `- Resume Mode: ${report.resumeMode}`,
    `- Continue On Failure: ${report.continueOnFailure}`,
    `- Browser Install Attempted: ${report.browserInstallAttempted}`,
    `- Browser Install Exit Code: ${report.browserInstallExitCode}`,
    `- Passed: ${report.summary.passed}`,
    `- Failed: ${report.summary.failed}`,
    '',
    '## Stage Results',
    '',
    ...report.stages.map((stage) => `- ${stage.status.toUpperCase()} ${stage.id}: ${stage.description} (exit=${stage.exitCode}, durationMs=${stage.durationMs})`),
    '',
  ].join('\n')
}

function parseFailureContext(raw, folderName) {
  const text = String(raw || '')
  const testName = text.match(/^- Name:\s*(.+)$/m)?.[1]?.trim() || 'unknown'
  const location = text.match(/^- Location:\s*(.+)$/m)?.[1]?.trim() || ''
  const errorBlock = text.match(/# Error details\s+[\s\S]*?```([\s\S]*?)```/m)?.[1] || ''
  const firstErrorLine = errorBlock
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0) || ''

  return {
    folder: folderName,
    testName,
    location,
    error: firstErrorLine,
  }
}

async function collectFailureContexts(maxItems = 20) {
  const testResultsRoot = path.resolve('test-results')
  const entries = await fs.readdir(testResultsRoot, { withFileTypes: true }).catch(() => [])
  const contexts = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const contextPath = path.join(testResultsRoot, entry.name, 'error-context.md')
    const raw = await fs.readFile(contextPath, 'utf8').catch(() => '')
    if (!raw) continue
    contexts.push(parseFailureContext(raw, entry.name))
    if (contexts.length >= maxItems) break
  }

  return contexts
}

async function saveKnowledgeRetention(rootDir, report) {
  const root = path.resolve(rootDir)
  const latestPath = path.join(root, RETENTION_LATEST_FILE)
  const historyPath = path.join(root, RETENTION_HISTORY_FILE)

  const failureContexts = await collectFailureContexts(30)
  const latestPayload = {
    updatedAt: new Date().toISOString(),
    runId: report.runId,
    batch: report.batch,
    scope: report.scope,
    resumeMode: report.resumeMode,
    continueOnFailure: report.continueOnFailure,
    startedAt: report.startedAt,
    endedAt: report.endedAt,
    summary: report.summary,
    failedStages: report.stages
      .filter((stage) => stage.status === 'fail')
      .map((stage) => ({ id: stage.id, exitCode: stage.exitCode, durationMs: stage.durationMs })),
    failureContexts,
  }

  await fs.writeFile(latestPath, `${JSON.stringify(latestPayload, null, 2)}\n`, 'utf8')

  const historyEntry = {
    timestamp: new Date().toISOString(),
    runId: report.runId,
    batch: report.batch,
    scope: report.scope,
    endedAt: report.endedAt,
    summary: report.summary,
    failedStageIds: latestPayload.failedStages.map((stage) => stage.id),
    topFailureTests: failureContexts.slice(0, 8).map((item) => item.testName),
  }
  await fs.appendFile(historyPath, `${JSON.stringify(historyEntry)}\n`, 'utf8')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const toolchain = resolveToolchain()

  if (args.listBatches) {
    console.log('Available batches:')
    for (const [batchName, ids] of Object.entries(BATCHES)) {
      console.log(`- ${batchName}: ${ids.join(', ')}`)
    }
    process.exit(0)
  }

  if (args.help) {
    console.log(`Bob Agentic Test Orchestrator\n\nUsage:\n  node scripts/bob-agentic-test-orchestrator.mjs [--scope full|quick] [--batch all|core|workflows|visual|human] [--from-stage <id>] [--resume] [--resume-run <id>] [--skip-install-browsers] [--fail-fast] [--no-fallback-creds] [--out <path>]\n\nNotes:\n  - Runs desktop + mobile emulation projects for full workflow/visual coverage.\n  - Uses Bob pre/post assist on each stage via scripts/run-test-with-bob-assist.mjs.\n  - Mobile testing uses Playwright emulation projects (Mobile Chrome + Mobile Safari).\n  - Use --list-batches to inspect available batch definitions.`)
    process.exit(0)
  }

  let runId = nowStamp()
  let resumeMode = false

  if (args.resumeRunId) {
    runId = args.resumeRunId
    resumeMode = true
  } else if (args.resume) {
    const latest = await findLatestRunId(args.outRoot)
    if (!latest) {
      throw new Error('No previous run found to resume. Run once without --resume first.')
    }
    runId = latest
    resumeMode = true
  }

  const outDir = path.resolve(args.outRoot, runId)
  await fs.mkdir(outDir, { recursive: true })

  const env = { ...process.env }
  if (args.fallbackCreds) {
    env.PLAYWRIGHT_ALLOW_SHARED_CREDENTIAL_FALLBACK = '1'
  }

  const existingReport = resumeMode ? await loadExistingReport(args.outRoot, runId) : null

  const report = existingReport || {
    runId,
    batch: args.batch,
    scope: args.scope,
    startedAt: new Date().toISOString(),
    endedAt: null,
    resumeMode,
    continueOnFailure: args.continueOnFailure,
    browserInstallAttempted: args.installBrowsers,
    browserInstallExitCode: null,
    stages: [],
    summary: {
      passed: 0,
      failed: 0,
    },
  }

  report.batch = args.batch
  report.scope = args.scope
  report.resumeMode = resumeMode
  report.continueOnFailure = args.continueOnFailure
  recalcSummary(report)

  if (args.installBrowsers && !resumeMode) {
    report.browserInstallExitCode = await runCommand(toolchain.scriptRunner, ['run', 'install:playwright'], env)
    await saveReport(outDir, report)
    await saveKnowledgeRetention(args.outRoot, report)
  }

  const stages = stageList(args)
  const completedPassStageIds = new Set(
    report.stages.filter((stage) => stage.status === 'pass').map((stage) => stage.id)
  )

  for (const stage of stages) {
    if (completedPassStageIds.has(stage.id)) {
      continue
    }

    const started = Date.now()

    const stageInvocation = resolveStageInvocation(stage, toolchain)

    const invocation = stage.bobAssist
      ? withBobAssist(stageInvocation.command, stageInvocation.args)
      : stageInvocation

    const exitCode = await runCommand(invocation.command, invocation.args, env)
    const status = exitCode === 0 ? 'pass' : 'fail'

    upsertStage(report, {
      id: stage.id,
      description: stage.description,
      command: invocation.command,
      args: invocation.args,
      exitCode,
      status,
      durationMs: Date.now() - started,
    })

    await saveReport(outDir, report)
    await saveKnowledgeRetention(args.outRoot, report)

    if (status === 'fail' && !args.continueOnFailure) {
      break
    }
  }

  report.endedAt = new Date().toISOString()
  await saveReport(outDir, report)
  await saveKnowledgeRetention(args.outRoot, report)

  const publishResult = await autoPublishBugReports({ env, args })
  report.bugReportPublish = {
    attempted: publishResult.attempted,
    skipped: publishResult.skipped,
    exitCode: publishResult.exitCode,
    completedAt: new Date().toISOString(),
  }
  await saveReport(outDir, report)
  await saveKnowledgeRetention(args.outRoot, report)

  const reportJsonPath = path.join(outDir, 'report.json')
  const reportMdPath = path.join(outDir, 'report.md')

  console.log(`\nBob agentic orchestrator complete.\nReport: ${reportJsonPath}\nSummary: ${reportMdPath}`)

  if (report.summary.failed > 0) {
    process.exit(1)
  }

  if (publishResult.attempted && publishResult.exitCode !== 0) {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error('[bob-agentic-test-orchestrator] fatal:', error?.message || error)
  process.exit(1)
})
