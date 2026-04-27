#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import process from 'node:process'
import { loadLocalEnv } from './load-local-env.mjs'

loadLocalEnv()

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
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--help') args.help = true
    else if (token === '--scope') args.scope = String(argv[i + 1] || 'full')
    else if (token.startsWith('--scope=')) args.scope = token.slice('--scope='.length)
    else if (token === '--skip-install-browsers') args.installBrowsers = false
    else if (token === '--fail-fast') args.continueOnFailure = false
    else if (token === '--no-fallback-creds') args.fallbackCreds = false
    else if (token === '--out') args.outRoot = String(argv[i + 1] || args.outRoot)
    else if (token.startsWith('--out=')) args.outRoot = token.slice('--out='.length)
  }

  return args
}

function stageList(scope) {
  const sharedProjects = ['chromium', 'firefox', 'webkit', 'Mobile Chrome', 'Mobile Safari']

  const workflowSpecs = [
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
  ]

  const stageDefs = [
    {
      id: 'lint',
      description: 'Lint codebase',
      command: 'bun',
      args: ['run', 'lint'],
      bobAssist: true,
    },
    {
      id: 'build',
      description: 'Build app',
      command: 'bun',
      args: ['run', 'build'],
      bobAssist: true,
    },
    {
      id: 'nav-parity',
      description: 'Run navigation parity tests',
      command: 'bun',
      args: ['run', 'test:nav-parity'],
      bobAssist: true,
    },
    {
      id: 'unit',
      description: 'Run unit tests',
      command: 'bun',
      args: ['run', 'test:unit'],
      bobAssist: true,
    },
    {
      id: 'api',
      description: 'Run API supporting-function tests',
      command: 'bun',
      args: ['run', 'test:api'],
      bobAssist: true,
    },
    {
      id: 'workflow-e2e-all-projects',
      description: 'Run end-to-end workflow tests across desktop/mobile projects',
      command: 'bunx',
      args: [
        'playwright',
        'test',
        ...workflowSpecs,
        ...sharedProjects.flatMap((project) => ['--project', project]),
        '--reporter=list,html,json',
      ],
      bobAssist: true,
    },
    {
      id: 'visual-e2e-emulation',
      description: 'Run visual regression-style sweeps on desktop and mobile emulation',
      command: 'bunx',
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
        '--reporter=list,html,json',
      ],
      bobAssist: true,
    },
    {
      id: 'human-engine',
      description: 'Run agentic human-test engine for broad UI workflow probing',
      command: 'node',
      args: ['scripts/human-test-engine.mjs'],
      bobAssist: true,
    },
  ]

  if (scope === 'quick') {
    return stageDefs.filter((s) => ['lint', 'build', 'nav-parity', 'workflow-e2e-all-projects', 'visual-e2e-emulation'].includes(s.id))
  }

  return stageDefs
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

function withBobAssist(command, args) {
  return {
    command: 'node',
    args: ['scripts/run-test-with-bob-assist.mjs', '--', command, ...args],
  }
}

function toMd(report) {
  return [
    '# Bob Agentic Test Orchestrator Report',
    '',
    `- Run ID: ${report.runId}`,
    `- Scope: ${report.scope}`,
    `- Started: ${report.startedAt}`,
    `- Ended: ${report.endedAt}`,
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

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    console.log(`Bob Agentic Test Orchestrator\n\nUsage:\n  node scripts/bob-agentic-test-orchestrator.mjs [--scope full|quick] [--skip-install-browsers] [--fail-fast] [--no-fallback-creds] [--out <path>]\n\nNotes:\n  - Runs desktop + mobile emulation projects for full workflow/visual coverage.\n  - Uses Bob pre/post assist on each stage via scripts/run-test-with-bob-assist.mjs.\n  - Mobile testing uses Playwright emulation projects (Mobile Chrome + Mobile Safari).`) 
    process.exit(0)
  }

  const runId = nowStamp()
  const outDir = path.resolve(args.outRoot, runId)
  await fs.mkdir(outDir, { recursive: true })

  const env = { ...process.env }
  if (args.fallbackCreds) {
    env.PLAYWRIGHT_ALLOW_SHARED_CREDENTIAL_FALLBACK = '1'
  }

  const report = {
    runId,
    scope: args.scope,
    startedAt: new Date().toISOString(),
    endedAt: null,
    continueOnFailure: args.continueOnFailure,
    browserInstallAttempted: args.installBrowsers,
    browserInstallExitCode: null,
    stages: [],
    summary: {
      passed: 0,
      failed: 0,
    },
  }

  if (args.installBrowsers) {
    report.browserInstallExitCode = await runCommand('bun', ['run', 'install:playwright'], env)
  }

  const stages = stageList(args.scope)

  for (const stage of stages) {
    const started = Date.now()

    const invocation = stage.bobAssist
      ? withBobAssist(stage.command, stage.args)
      : { command: stage.command, args: stage.args }

    const exitCode = await runCommand(invocation.command, invocation.args, env)
    const status = exitCode === 0 ? 'pass' : 'fail'

    report.stages.push({
      id: stage.id,
      description: stage.description,
      command: invocation.command,
      args: invocation.args,
      exitCode,
      status,
      durationMs: Date.now() - started,
    })

    if (status === 'pass') report.summary.passed += 1
    else report.summary.failed += 1

    if (status === 'fail' && !args.continueOnFailure) {
      break
    }
  }

  report.endedAt = new Date().toISOString()

  const reportJsonPath = path.join(outDir, 'report.json')
  const reportMdPath = path.join(outDir, 'report.md')
  await fs.writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await fs.writeFile(reportMdPath, `${toMd(report)}\n`, 'utf8')

  console.log(`\nBob agentic orchestrator complete.\nReport: ${reportJsonPath}\nSummary: ${reportMdPath}`)

  if (report.summary.failed > 0) {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error('[bob-agentic-test-orchestrator] fatal:', error?.message || error)
  process.exit(1)
})
