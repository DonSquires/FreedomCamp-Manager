#!/usr/bin/env node

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const workspaceRoot = process.cwd()
const defaultWorkflow = 'phase3-ux-baseline-capture.yml'
const defaultOutDir = path.join(workspaceRoot, 'tmp', 'phase3-baseline-artifact')
const defaultWorkbook = path.join(workspaceRoot, 'docs', 'PHASE3_UX_BASELINE_CAPTURE_2026-05-03.md')
const importScript = path.join(workspaceRoot, 'scripts', 'import-phase3-baseline.mjs')

function parseArgs(argv) {
  const args = {
    runId: '',
    workflow: defaultWorkflow,
    outDir: defaultOutDir,
    workbook: defaultWorkbook,
    help: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--help' || token === '-h') {
      args.help = true
      continue
    }
    if (token === '--run-id' && argv[i + 1]) {
      args.runId = String(argv[i + 1])
      i += 1
      continue
    }
    if (token === '--workflow' && argv[i + 1]) {
      args.workflow = String(argv[i + 1])
      i += 1
      continue
    }
    if (token === '--out-dir' && argv[i + 1]) {
      args.outDir = path.resolve(workspaceRoot, argv[i + 1])
      i += 1
      continue
    }
    if (token === '--workbook' && argv[i + 1]) {
      args.workbook = path.resolve(workspaceRoot, argv[i + 1])
      i += 1
      continue
    }
  }

  return args
}

function run(command) {
  return execSync(command, {
    cwd: workspaceRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf-8',
  }).trim()
}

function ensureGhAvailable() {
  try {
    run('gh --version')
  } catch {
    throw new Error('GitHub CLI (gh) is required but not available in PATH')
  }
}

function resolveLatestSuccessfulRunId(workflow) {
  const command = [
    'gh run list',
    `--workflow "${workflow}"`,
    '--limit 30',
    '--json databaseId,status,conclusion',
    '--jq ".[0].databaseId"',
  ].join(' ')

  const output = run(command)
  if (!output || output === 'null') {
    throw new Error(`No runs found for workflow: ${workflow}`)
  }

  return output
}

function cleanDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true })
  fs.mkdirSync(dirPath, { recursive: true })
}

function downloadArtifacts(runId, outDir) {
  const command = `gh run download ${runId} -D "${outDir}"`
  run(command)
}

function findBaselineJson(rootDir) {
  const stack = [rootDir]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue

    const entries = fs.readdirSync(current, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
      } else if (entry.isFile() && entry.name === 'phase3-ux-baseline.json') {
        return fullPath
      }
    }
  }

  return ''
}

function importIntoWorkbook(inputPath, workbook, runId) {
  const command = [
    `node "${importScript}"`,
    `--input "${inputPath}"`,
    `--workbook "${workbook}"`,
    `--run-id "${runId}"`,
  ].join(' ')

  run(command)
}

function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    console.log('Phase 3 baseline fetch+import')
    console.log('')
    console.log('Usage:')
    console.log('  node scripts/fetch-and-import-phase3-baseline.mjs [--run-id <id>] [--workflow <file>] [--out-dir <path>] [--workbook <path>]')
    console.log('')
    console.log('Examples:')
    console.log('  node scripts/fetch-and-import-phase3-baseline.mjs --run-id 123456789')
    console.log('  node scripts/fetch-and-import-phase3-baseline.mjs')
    return
  }

  ensureGhAvailable()

  const runId = args.runId || resolveLatestSuccessfulRunId(args.workflow)
  cleanDir(args.outDir)
  downloadArtifacts(runId, args.outDir)

  const jsonPath = findBaselineJson(args.outDir)
  if (!jsonPath) {
    throw new Error(
      `phase3-ux-baseline.json not found in downloaded artifacts for run ${runId}. ` +
        'Ensure workflow uploads test-results/phase3-ux-baseline.json.'
    )
  }

  importIntoWorkbook(jsonPath, args.workbook, runId)

  console.log('[phase3-baseline-fetch-import] Success')
  console.log(`- Workflow: ${args.workflow}`)
  console.log(`- Run ID: ${runId}`)
  console.log(`- Artifact JSON: ${jsonPath}`)
  console.log(`- Workbook: ${args.workbook}`)
}

try {
  main()
} catch (error) {
  console.error('[phase3-baseline-fetch-import] ERROR:', error.message)
  process.exit(1)
}
