#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { execSync } from 'node:child_process'

const DEFAULT_MATRIX_PATH = 'docs/PHASE1_WORKFLOW_MATRIX_2026-05-02.json'
const DEFAULT_OUTPUT_DIR = 'tools/workflow-evidence'
const SAMPLE_LIMIT = 8

function parseArgs(argv) {
  const args = {
    all: false,
    workflow: [],
    status: 'recorded',
    commandIndex: 0,
    matrixPath: DEFAULT_MATRIX_PATH,
    outDir: DEFAULT_OUTPUT_DIR,
    notes: '',
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]

    if (token === '--all') {
      args.all = true
      continue
    }

    if (token.startsWith('--workflow=')) {
      const value = token.split('=')[1]
      if (value) args.workflow.push(...value.split(',').map((v) => v.trim()).filter(Boolean))
      continue
    }

    if (token === '--workflow') {
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        args.workflow.push(...next.split(',').map((v) => v.trim()).filter(Boolean))
        i += 1
      }
      continue
    }

    if (token.startsWith('--status=')) {
      args.status = token.split('=')[1] || args.status
      continue
    }

    if (token === '--status') {
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        args.status = next
        i += 1
      }
      continue
    }

    if (token.startsWith('--command-index=')) {
      const n = Number(token.split('=')[1])
      if (Number.isInteger(n) && n >= 0) args.commandIndex = n
      continue
    }

    if (token === '--command-index') {
      const next = argv[i + 1]
      const n = Number(next)
      if (Number.isInteger(n) && n >= 0) {
        args.commandIndex = n
        i += 1
      }
      continue
    }

    if (token.startsWith('--matrix=')) {
      const value = token.split('=')[1]
      if (value) args.matrixPath = value
      continue
    }

    if (token === '--matrix') {
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        args.matrixPath = next
        i += 1
      }
      continue
    }

    if (token.startsWith('--out-dir=')) {
      const value = token.split('=')[1]
      if (value) args.outDir = value
      continue
    }

    if (token === '--out-dir') {
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        args.outDir = next
        i += 1
      }
      continue
    }

    if (token.startsWith('--notes=')) {
      args.notes = token.split('=')[1] || ''
      continue
    }

    if (token === '--notes') {
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        args.notes = next
        i += 1
      }
    }
  }

  return args
}

function run(command) {
  try {
    return execSync(command, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    }).trim()
  } catch {
    return ''
  }
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

async function fileOrDirStats(targetPath) {
  try {
    return await fs.stat(targetPath)
  } catch {
    return null
  }
}

async function collectDirectorySample(dirPath, maxEntries = SAMPLE_LIMIT) {
  const sample = []
  const stack = ['']

  while (stack.length > 0 && sample.length < maxEntries) {
    const relative = stack.pop()
    const current = relative ? path.join(dirPath, relative) : dirPath

    let entries = []
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (sample.length >= maxEntries) break
      const rel = relative ? path.join(relative, entry.name) : entry.name
      sample.push(rel)
      if (entry.isDirectory()) stack.push(rel)
    }
  }

  return sample
}

async function inspectArtifact(rootPath, artifactPath) {
  const resolved = path.resolve(rootPath, artifactPath)
  const stats = await fileOrDirStats(resolved)

  if (!stats) {
    return {
      path: artifactPath,
      exists: false,
      type: 'missing',
      sample: [],
    }
  }

  if (stats.isDirectory()) {
    const sample = await collectDirectorySample(resolved)
    return {
      path: artifactPath,
      exists: true,
      type: 'directory',
      sample,
    }
  }

  return {
    path: artifactPath,
    exists: true,
    type: 'file',
    sample: [path.basename(artifactPath)],
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const cwd = process.cwd()

  const matrixRaw = await fs.readFile(path.resolve(cwd, args.matrixPath), 'utf8')
  const matrix = JSON.parse(matrixRaw)
  const allWorkflows = Array.isArray(matrix.workflows) ? matrix.workflows : []

  let selected = allWorkflows
  if (!args.all) {
    if (args.workflow.length === 0) {
      throw new Error('Provide --workflow <WF-ID[,WF-ID]> or use --all')
    }

    const wanted = new Set(args.workflow)
    selected = allWorkflows.filter((workflow) => wanted.has(workflow.id))

    if (selected.length !== wanted.size) {
      const found = new Set(selected.map((workflow) => workflow.id))
      const missing = [...wanted].filter((id) => !found.has(id))
      throw new Error(`Unknown workflow id(s): ${missing.join(', ')}`)
    }
  }

  const outputDir = path.resolve(cwd, args.outDir)
  await fs.mkdir(outputDir, { recursive: true })

  const gitBranch = run('git rev-parse --abbrev-ref HEAD') || 'unknown'
  const gitCommit = run('git rev-parse HEAD') || 'unknown'
  const stamp = nowStamp()
  const createdFiles = []

  for (const workflow of selected) {
    const selectedCommand = Array.isArray(workflow.commands) ? workflow.commands[args.commandIndex] || workflow.commands[0] || null : null
    const artifacts = Array.isArray(workflow.artifacts) ? workflow.artifacts : []
    const artifactEvidence = []

    for (const artifact of artifacts) {
      artifactEvidence.push(await inspectArtifact(cwd, artifact))
    }

    const evidence = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      sourceMatrix: args.matrixPath,
      workflow: {
        id: workflow.id,
        name: workflow.name,
        criticality: workflow.criticality,
        owner: workflow.owner,
        testType: workflow.testType,
        matrixStatus: workflow.status,
      },
      execution: {
        recordedStatus: args.status,
        commandIndex: args.commandIndex,
        command: selectedCommand,
        tests: workflow.tests || [],
        notes: args.notes || undefined,
      },
      artifacts: artifactEvidence,
      git: {
        branch: gitBranch,
        commit: gitCommit,
      },
    }

    const fileName = `${workflow.id}-${stamp}.json`
    const filePath = path.join(outputDir, fileName)
    await fs.writeFile(filePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
    createdFiles.push(path.relative(cwd, filePath))

    const indexEntry = {
      workflowId: workflow.id,
      recordedStatus: args.status,
      generatedAt: evidence.generatedAt,
      file: path.relative(cwd, filePath),
      commit: gitCommit,
    }

    await fs.appendFile(path.join(outputDir, 'index.jsonl'), `${JSON.stringify(indexEntry)}\n`, 'utf8')
  }

  console.log(`[workflow-evidence] Created ${createdFiles.length} evidence file(s):`)
  for (const file of createdFiles) {
    console.log(`- ${file}`)
  }
}

main().catch((error) => {
  console.error(`[workflow-evidence] ${error.message}`)
  process.exit(1)
})
