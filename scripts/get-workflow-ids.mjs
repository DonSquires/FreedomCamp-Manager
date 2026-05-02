#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const DEFAULT_MATRIX = 'docs/PHASE1_WORKFLOW_MATRIX_2026-05-02.json'

function parseArgs(argv) {
  const args = {
    matrix: DEFAULT_MATRIX,
    criticality: '',
    status: '',
    format: 'csv',
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]

    if (token.startsWith('--matrix=')) {
      args.matrix = token.split('=')[1] || args.matrix
      continue
    }

    if (token === '--matrix') {
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        args.matrix = next
        i += 1
      }
      continue
    }

    if (token.startsWith('--criticality=')) {
      args.criticality = token.split('=')[1] || ''
      continue
    }

    if (token === '--criticality') {
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        args.criticality = next
        i += 1
      }
      continue
    }

    if (token.startsWith('--status=')) {
      args.status = token.split('=')[1] || ''
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

    if (token.startsWith('--format=')) {
      args.format = token.split('=')[1] || args.format
      continue
    }

    if (token === '--format') {
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        args.format = next
        i += 1
      }
    }
  }

  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const matrixPath = path.resolve(process.cwd(), args.matrix)
  const matrixRaw = await fs.readFile(matrixPath, 'utf8')
  const matrix = JSON.parse(matrixRaw)
  const workflows = Array.isArray(matrix.workflows) ? matrix.workflows : []

  let selected = workflows
  if (args.criticality) {
    selected = selected.filter((workflow) => String(workflow.criticality || '').toUpperCase() === String(args.criticality).toUpperCase())
  }

  if (args.status) {
    selected = selected.filter((workflow) => String(workflow.status || '').toLowerCase() === String(args.status).toLowerCase())
  }

  const ids = selected
    .map((workflow) => String(workflow.id || '').trim())
    .filter(Boolean)

  if (ids.length === 0) {
    throw new Error('No workflow IDs matched the provided filters')
  }

  if (args.format === 'json') {
    process.stdout.write(`${JSON.stringify(ids)}\n`)
    return
  }

  process.stdout.write(`${ids.join(',')}\n`)
}

main().catch((error) => {
  console.error(`[get-workflow-ids] ${error.message}`)
  process.exit(1)
})
