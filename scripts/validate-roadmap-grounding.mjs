#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const DEFAULT_MATRIX = 'tools/route-role-matrix/route-role-matrix.json'
const DEFAULT_ROADMAP = 'docs/MODULE_ROADMAP.md'

function parseArgs(argv) {
  const args = {
    matrix: DEFAULT_MATRIX,
    roadmap: DEFAULT_ROADMAP,
    strict: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]

    if (token === '--strict') {
      args.strict = true
      continue
    }

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

    if (token.startsWith('--roadmap=')) {
      args.roadmap = token.split('=')[1] || args.roadmap
      continue
    }

    if (token === '--roadmap') {
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        args.roadmap = next
        i += 1
      }
    }
  }

  return args
}

function extractRoadmapRoutes(markdown) {
  const routes = new Set()
  // Only match route paths that are NOT embedded inside slash-delimited word lists
  // (e.g. "status/alarm_type/date" filter descriptions) or file paths (src/navigation/...).
  // Negative lookbehind ensures the leading / is not preceded by a word character.
  //
  // Matches:  /admin/users   /crm   /crm/client/:orgId
  // Excludes: status/alarm_type   src/navigation/routes.ts   word/word/word
  const regex = /(?<![a-zA-Z0-9_])\/[a-z][a-z0-9_-]*(?:\/(?:[a-z][a-z0-9_-]*|:[a-z][a-zA-Z0-9_-]*))*/g
  const ignore = new Set(['/'])

  let match
  while ((match = regex.exec(markdown)) !== null) {
    const route = String(match[0]).trim()
    if (!route || ignore.has(route)) continue
    routes.add(route)
  }

  return [...routes]
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const cwd = process.cwd()

  const matrixRaw = await fs.readFile(path.resolve(cwd, args.matrix), 'utf8')
  const roadmapRaw = await fs.readFile(path.resolve(cwd, args.roadmap), 'utf8')

  const matrix = JSON.parse(matrixRaw)
  const appRoutes = new Set((Array.isArray(matrix.routes) ? matrix.routes : []).map((route) => String(route.path).trim()))
  const roadmapRoutes = extractRoadmapRoutes(roadmapRaw)

  const missing = roadmapRoutes.filter((route) => !appRoutes.has(route))

  if (missing.length === 0) {
    console.log('[roadmap-grounding] PASS: all roadmap routes are present in src/App.tsx route matrix.')
    return
  }

  console.log('[roadmap-grounding] WARN: routes documented in MODULE_ROADMAP are missing in App route matrix:')
  for (const route of missing) {
    console.log(`- ${route}`)
  }

  if (args.strict) {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(`[roadmap-grounding] ${error.message}`)
  process.exit(1)
})
