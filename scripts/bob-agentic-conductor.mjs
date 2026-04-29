#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import process from 'node:process'
import { loadLocalEnv } from './load-local-env.mjs'

loadLocalEnv()

const DEFAULT_MOVEMENTS = ['core', 'workflows', 'visual', 'human']
const VALID_MOVEMENTS = new Set(DEFAULT_MOVEMENTS)

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function parseArgs(argv) {
  const args = {
    scope: 'full',
    movements: [...DEFAULT_MOVEMENTS],
    maxRetries: 1,
    outRoot: 'tools/bob-agentic-test-runs/conductor',
    installBrowsers: true,
    fallbackCreds: true,
    continueOnFailure: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--help') args.help = true
    else if (token === '--scope') args.scope = String(argv[i + 1] || args.scope)
    else if (token.startsWith('--scope=')) args.scope = token.slice('--scope='.length)
    else if (token === '--movements') args.movements = String(argv[i + 1] || '').split(',').map((v) => v.trim()).filter(Boolean)
    else if (token.startsWith('--movements=')) args.movements = token.slice('--movements='.length).split(',').map((v) => v.trim()).filter(Boolean)
    else if (token === '--max-retries') args.maxRetries = Number.parseInt(String(argv[i + 1] || args.maxRetries), 10)
    else if (token.startsWith('--max-retries=')) args.maxRetries = Number.parseInt(token.slice('--max-retries='.length), 10)
    else if (token === '--out') args.outRoot = String(argv[i + 1] || args.outRoot)
    else if (token.startsWith('--out=')) args.outRoot = token.slice('--out='.length)
    else if (token === '--skip-install-browsers') args.installBrowsers = false
    else if (token === '--no-fallback-creds') args.fallbackCreds = false
    else if (token === '--continue-on-failure') args.continueOnFailure = true
  }

  if (!Number.isFinite(args.maxRetries) || args.maxRetries < 0) {
    throw new Error('--max-retries must be a non-negative integer')
  }

  const invalidMovement = args.movements.find((movement) => !VALID_MOVEMENTS.has(movement))
  if (invalidMovement) {
    throw new Error(`Unknown movement "${invalidMovement}". Valid values: ${[...VALID_MOVEMENTS].join(', ')}`)
  }

  return args
}

function runCommand(command, args, env = process.env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: false,
      env,
    })

    child.on('close', (code, signal) => {
      if (signal) return resolve(1)
      resolve(code ?? 1)
    })

    child.on('error', () => resolve(1))
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

async function loadReport(outRoot, runId) {
  const reportPath = path.join(path.resolve(outRoot), runId, 'report.json')
  const raw = await fs.readFile(reportPath, 'utf8').catch(() => '')
  if (!raw) return null
  return JSON.parse(raw)
}

function printSummary(conductorReport) {
  const failed = conductorReport.movements.filter((movement) => movement.status !== 'pass')
  console.log('\nBob conductor summary')
  console.log(`- Conductor run: ${conductorReport.conductorRunId}`)
  console.log(`- Scope: ${conductorReport.scope}`)
  console.log(`- Movements: ${conductorReport.movements.map((movement) => movement.movement).join(', ')}`)
  console.log(`- Failed movements: ${failed.length}`)
  if (failed.length > 0) {
    for (const movement of failed) {
      console.log(`  - ${movement.movement}: exit=${movement.exitCode}, attempts=${movement.attempts}`)
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    console.log(`Bob Agentic Conductor\n\nUsage:\n  node scripts/bob-agentic-conductor.mjs [--scope full|quick] [--movements core,workflows,visual,human] [--max-retries 1] [--out <path>] [--skip-install-browsers] [--no-fallback-creds] [--continue-on-failure]\n\nNotes:\n  - Directs orchestrator runs movement-by-movement with retry/resume policy.\n  - Each movement gets its own run bucket and retry attempts resume the same run id.\n  - Writes conductor summary to <out>/<conductorRunId>/conductor-report.json.`)
    process.exit(0)
  }

  const conductorRunId = nowStamp()
  const conductorRoot = path.resolve(args.outRoot, conductorRunId)
  await fs.mkdir(conductorRoot, { recursive: true })

  const env = { ...process.env }
  if (args.fallbackCreds) {
    env.PLAYWRIGHT_ALLOW_SHARED_CREDENTIAL_FALLBACK = '1'
  }

  const conductorReport = {
    conductorRunId,
    startedAt: new Date().toISOString(),
    endedAt: null,
    scope: args.scope,
    movements: [],
  }

  for (const movement of args.movements) {
    const movementOutRoot = path.join(conductorRoot, movement)
    await fs.mkdir(movementOutRoot, { recursive: true })

    let attempt = 0
    let lastExitCode = 1
    let runId = ''
    let finalReport = null

    while (attempt <= args.maxRetries) {
      const orchestratorArgs = [
        'scripts/bob-agentic-test-orchestrator.mjs',
        '--scope',
        args.scope,
        '--batch',
        movement,
        '--out',
        movementOutRoot,
      ]

      if (!args.installBrowsers || attempt > 0) {
        orchestratorArgs.push('--skip-install-browsers')
      }

      if (!args.fallbackCreds) {
        orchestratorArgs.push('--no-fallback-creds')
      }

      if (runId) {
        orchestratorArgs.push('--resume-run', runId)
      }

      const exitCode = await runCommand(process.execPath || 'node', orchestratorArgs, env)
      lastExitCode = exitCode

      if (!runId) {
        runId = await findLatestRunId(movementOutRoot)
      }
      if (runId) {
        finalReport = await loadReport(movementOutRoot, runId)
      }

      if (exitCode === 0) {
        break
      }

      attempt += 1
      if (attempt > args.maxRetries) {
        break
      }
      console.warn(`[bob-agentic-conductor] movement ${movement} failed, retrying attempt ${attempt}/${args.maxRetries}`)
    }

    const movementResult = {
      movement,
      attempts: Math.min(attempt + 1, args.maxRetries + 1),
      exitCode: lastExitCode,
      status: lastExitCode === 0 ? 'pass' : 'fail',
      runId,
      reportSummary: finalReport?.summary || null,
      reportPath: runId ? path.join(movementOutRoot, runId, 'report.json') : null,
    }
    conductorReport.movements.push(movementResult)

    if (movementResult.status === 'fail' && !args.continueOnFailure) {
      break
    }
  }

  conductorReport.endedAt = new Date().toISOString()
  const conductorReportPath = path.join(conductorRoot, 'conductor-report.json')
  const conductorReportMdPath = path.join(conductorRoot, 'conductor-report.md')
  const failedCount = conductorReport.movements.filter((movement) => movement.status === 'fail').length

  const md = [
    '# Bob Agentic Conductor Report',
    '',
    `- Conductor Run: ${conductorReport.conductorRunId}`,
    `- Scope: ${conductorReport.scope}`,
    `- Started: ${conductorReport.startedAt}`,
    `- Ended: ${conductorReport.endedAt}`,
    `- Failed Movements: ${failedCount}`,
    '',
    '## Movement Results',
    '',
    ...conductorReport.movements.map((movement) => `- ${movement.status.toUpperCase()} ${movement.movement} (attempts=${movement.attempts}, exit=${movement.exitCode}, runId=${movement.runId || 'n/a'})`),
    '',
  ].join('\n')

  await fs.writeFile(conductorReportPath, `${JSON.stringify(conductorReport, null, 2)}\n`, 'utf8')
  await fs.writeFile(conductorReportMdPath, `${md}\n`, 'utf8')

  printSummary(conductorReport)
  console.log(`- Conductor report: ${conductorReportPath}`)
  console.log(`- Conductor markdown: ${conductorReportMdPath}`)

  if (failedCount > 0) {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error('[bob-agentic-conductor] fatal:', error?.message || error)
  process.exit(1)
})
