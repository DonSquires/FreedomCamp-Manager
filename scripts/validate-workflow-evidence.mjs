#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const DEFAULT_REQUIRED = ['WF-01', 'WF-07', 'WF-11']

function parseArgs(argv) {
  const args = {
    dir: '',
    required: [...DEFAULT_REQUIRED],
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]

    if (token.startsWith('--dir=')) {
      args.dir = token.split('=')[1] || ''
      continue
    }

    if (token === '--dir') {
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        args.dir = next
        i += 1
      }
      continue
    }

    if (token.startsWith('--required=')) {
      const value = token.split('=')[1]
      if (value) args.required = value.split(',').map((v) => v.trim()).filter(Boolean)
      continue
    }

    if (token === '--required') {
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        args.required = next.split(',').map((v) => v.trim()).filter(Boolean)
        i += 1
      }
    }
  }

  return args
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

function toTs(value) {
  const t = Date.parse(String(value || ''))
  return Number.isFinite(t) ? t : 0
}

function validateEvidenceShape(evidence) {
  const errors = []

  if (!evidence || typeof evidence !== 'object') {
    errors.push('Evidence payload is not an object')
    return errors
  }

  if (evidence.schemaVersion !== 1) {
    errors.push('schemaVersion must be 1')
  }

  const workflowId = evidence.workflow?.id
  if (!workflowId || typeof workflowId !== 'string') {
    errors.push('workflow.id is missing')
  }

  const command = evidence.execution?.command
  if (!command || typeof command !== 'string') {
    errors.push('execution.command is missing')
  }

  const tests = evidence.execution?.tests
  if (!Array.isArray(tests) || tests.length === 0) {
    errors.push('execution.tests must be a non-empty array')
  }

  const artifacts = evidence.artifacts
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    errors.push('artifacts must be a non-empty array')
  }

  return errors
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const evidenceDir = path.resolve(process.cwd(), args.dir || '')

  if (!args.dir) {
    throw new Error('Provide --dir <evidence-directory>')
  }

  if (!(await exists(evidenceDir))) {
    throw new Error(`Evidence directory not found: ${args.dir}`)
  }

  const entries = await fs.readdir(evidenceDir)
  const evidenceFiles = entries.filter((name) => name.endsWith('.json') && name !== 'index.json')

  if (evidenceFiles.length === 0) {
    throw new Error(`No evidence JSON files found in ${args.dir}`)
  }

  const byWorkflow = new Map()

  for (const fileName of evidenceFiles) {
    const absolute = path.join(evidenceDir, fileName)
    let parsed = null

    try {
      parsed = JSON.parse(await fs.readFile(absolute, 'utf8'))
    } catch (error) {
      throw new Error(`Failed to parse ${path.join(args.dir, fileName)}: ${error.message}`)
    }

    const workflowId = parsed?.workflow?.id
    if (!workflowId) {
      throw new Error(`Missing workflow.id in ${path.join(args.dir, fileName)}`)
    }

    const current = byWorkflow.get(workflowId)
    if (!current || toTs(parsed.generatedAt) >= toTs(current.parsed.generatedAt)) {
      byWorkflow.set(workflowId, { fileName, parsed })
    }
  }

  const failures = []
  const summary = []

  for (const workflowId of args.required) {
    const hit = byWorkflow.get(workflowId)
    if (!hit) {
      failures.push(`${workflowId}: missing evidence file`)
      continue
    }

    const shapeErrors = validateEvidenceShape(hit.parsed)
    if (shapeErrors.length > 0) {
      failures.push(`${workflowId}: ${shapeErrors.join('; ')}`)
      continue
    }

    summary.push({
      workflowId,
      file: hit.fileName,
      generatedAt: hit.parsed.generatedAt,
      status: hit.parsed.execution?.recordedStatus || 'unknown',
    })
  }

  const indexPath = path.join(evidenceDir, 'index.jsonl')
  if (!(await exists(indexPath))) {
    failures.push('index.jsonl is missing')
  }

  if (failures.length > 0) {
    console.error('[workflow-evidence:validate] FAIL')
    for (const line of failures) {
      console.error(`- ${line}`)
    }
    process.exit(1)
  }

  console.log('[workflow-evidence:validate] PASS')
  for (const row of summary) {
    console.log(`- ${row.workflowId}: ${row.file} (${row.status})`) 
  }
}

main().catch((error) => {
  console.error(`[workflow-evidence:validate] ${error.message}`)
  process.exit(1)
})
