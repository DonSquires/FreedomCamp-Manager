#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const workspaceRoot = process.cwd()
const defaultInput = path.join(workspaceRoot, 'test-results', 'phase3-ux-baseline.json')
const defaultWorkbook = path.join(workspaceRoot, 'docs', 'PHASE3_UX_BASELINE_CAPTURE_2026-05-03.md')

function parseArgs(argv) {
  const args = {
    input: defaultInput,
    workbook: defaultWorkbook,
    runId: 'local',
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--input' && argv[i + 1]) {
      args.input = path.resolve(workspaceRoot, argv[i + 1])
      i += 1
      continue
    }
    if (token === '--workbook' && argv[i + 1]) {
      args.workbook = path.resolve(workspaceRoot, argv[i + 1])
      i += 1
      continue
    }
    if (token === '--run-id' && argv[i + 1]) {
      args.runId = String(argv[i + 1])
      i += 1
      continue
    }
  }

  return args
}

function loadJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Baseline JSON not found: ${filePath}`)
  }

  const raw = fs.readFileSync(filePath, 'utf-8')
  const parsed = JSON.parse(raw)

  if (!Array.isArray(parsed.rows)) {
    throw new Error('Baseline JSON must contain an array at "rows"')
  }

  return parsed.rows
}

function toCell(value) {
  if (value == null) return 'pending'
  return String(value)
}

function statusFromRow(row) {
  const hasMetrics =
    row.clickDepth != null &&
    row.timeToPrimaryActionSeconds != null &&
    row.errorProneActions != null

  return hasMetrics ? 'captured' : 'partial'
}

function updateWorkbook(workbookPath, rows, runId) {
  if (!fs.existsSync(workbookPath)) {
    throw new Error(`Workbook not found: ${workbookPath}`)
  }

  const rowByRoute = new Map(rows.map((r) => [r.route, r]))
  const lines = fs.readFileSync(workbookPath, 'utf-8').split('\n')

  const updated = lines.map((line) => {
    const routeMatch = line.match(/^\|\s*(\/[a-z0-9-]+)\s*\|/i)
    if (!routeMatch) return line

    const route = routeMatch[1]
    const row = rowByRoute.get(route)
    if (!row) return line

    const cells = [
      route,
      toCell(row.clickDepth),
      toCell(row.timeToPrimaryActionSeconds),
      toCell(row.errorProneActions),
      runId,
      statusFromRow(row),
    ]

    return `| ${cells[0]} | ${cells[1]} | ${cells[2]} | ${cells[3]} | ${cells[4]} | ${cells[5]} |`
  })

  fs.writeFileSync(workbookPath, updated.join('\n'))
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const rows = loadJson(args.input)
  updateWorkbook(args.workbook, rows, args.runId)

  console.log('[phase3-baseline-import] Updated workbook')
  console.log(`- Input: ${args.input}`)
  console.log(`- Workbook: ${args.workbook}`)
  console.log(`- Run ID: ${args.runId}`)
  console.log(`- Rows processed: ${rows.length}`)
}

try {
  main()
} catch (error) {
  console.error('[phase3-baseline-import] ERROR:', error.message)
  process.exit(1)
}
