#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const DEFAULT_REPORT = 'tools/module-grounding/module-grounding-report.json'

function parseArgs(argv) {
  const args = {
    report: DEFAULT_REPORT,
    strict: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--strict') {
      args.strict = true
      continue
    }
    if (token.startsWith('--report=')) {
      args.report = token.split('=')[1] || args.report
      continue
    }
    if (token === '--report') {
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        args.report = next
        i += 1
      }
    }
  }

  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const reportPath = path.resolve(process.cwd(), args.report)
  const raw = await fs.readFile(reportPath, 'utf8')
  const report = JSON.parse(raw)

  const unresolved = Array.isArray(report.unresolvedRoutes) ? report.unresolvedRoutes : []
  const missing = Array.isArray(report.missingFiles) ? report.missingFiles : []

  if (unresolved.length === 0 && missing.length === 0) {
    console.log('[module-grounding:validate] PASS: all non-redirect routes resolve to known imports and existing files.')
    return
  }

  console.log('[module-grounding:validate] WARN: module grounding issues detected:')

  for (const route of unresolved) {
    console.log(`- unresolved component import for route ${route.path} (${route.componentName || 'unknown'})`)
  }

  for (const route of missing) {
    console.log(`- missing component file for route ${route.path}: ${route.resolvedPath || route.importPath}`)
  }

  if (args.strict) {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(`[module-grounding:validate] ${error.message}`)
  process.exit(1)
})
