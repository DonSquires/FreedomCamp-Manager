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

function normalizeRoles(roles) {
  return [...new Set(roles.map((role) => String(role).trim()).filter(Boolean))].sort()
}

function parseExpectedGate(specRaw) {
  const spec = String(specRaw || '').trim()
  const areaMatch = spec.match(/\(area=([^)]+)\)/i)
  const area = areaMatch ? String(areaMatch[1]).trim() : null

  if (/authenticated users/i.test(spec)) {
    return { type: 'protected-authenticated', roles: [], area }
  }

  const withoutParens = spec.replace(/\([^)]*\)/g, '').trim()
  const roles = normalizeRoles(withoutParens.split(',').map((v) => v.trim()))
  return { type: 'roles', roles, area }
}

function extractRoutes(text) {
  const hits = text.match(/\/[A-Za-z0-9:_\/-]+/g)
  return hits ? [...new Set(hits)] : []
}

function parseRoadmapExpectations(roadmapRaw) {
  const lines = roadmapRaw.split('\n')
  const expectations = []

  for (const line of lines) {
    const marker = '- Related route gates:'
    const idx = line.indexOf(marker)
    if (idx === -1) continue

    const payload = line.slice(idx + marker.length).trim()
    if (!payload) continue

    const clauses = payload.split(';').map((part) => part.trim()).filter(Boolean)

    for (const clause of clauses) {
      if (!clause.includes('=')) continue
      const [left, right] = clause.split('=').map((part) => part.trim())
      if (!left || !right) continue

      if (/inherit/i.test(right)) continue
      if (/redirect/i.test(right)) continue

      const routes = extractRoutes(left)
      if (routes.length === 0) continue

      const expected = parseExpectedGate(right)
      for (const routePath of routes) {
        expectations.push({ routePath, expected })
      }
    }
  }

  return expectations
}

function stringifyRoles(roles) {
  return normalizeRoles(roles).join(', ')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const cwd = process.cwd()

  const matrixRaw = await fs.readFile(path.resolve(cwd, args.matrix), 'utf8')
  const roadmapRaw = await fs.readFile(path.resolve(cwd, args.roadmap), 'utf8')

  const matrix = JSON.parse(matrixRaw)
  const routes = Array.isArray(matrix.routes) ? matrix.routes : []
  const duplicates = Array.isArray(matrix.duplicates) ? matrix.duplicates : []
  const expectations = parseRoadmapExpectations(roadmapRaw)

  const byPath = new Map()
  for (const route of routes) {
    const pathKey = String(route.path || '').trim()
    if (!pathKey) continue
    const list = byPath.get(pathKey) || []
    list.push(route)
    byPath.set(pathKey, list)
  }

  const failures = []

  if (duplicates.length > 0) {
    failures.push(`Duplicate route paths detected in App matrix: ${duplicates.map((d) => d.path).join(', ')}`)
  }

  for (const { routePath, expected } of expectations) {
    const matches = byPath.get(routePath) || []
    if (matches.length === 0) {
      failures.push(`${routePath}: expected in route matrix but was not found`)
      continue
    }

    const chosen = matches.find((entry) => entry.accessType !== 'redirect') || matches[0]

    if (expected.type === 'protected-authenticated') {
      if (chosen.accessType !== 'protected-authenticated') {
        failures.push(`${routePath}: expected protected-authenticated, got ${chosen.accessType}`)
      }
      continue
    }

    const actualRoles = normalizeRoles(Array.isArray(chosen.roles) ? chosen.roles : [])
    const expectedRoles = normalizeRoles(expected.roles)

    if (actualRoles.join('|') !== expectedRoles.join('|')) {
      failures.push(`${routePath}: role mismatch (expected: ${stringifyRoles(expectedRoles)} | actual: ${stringifyRoles(actualRoles)})`)
    }

    if (expected.area) {
      const actualArea = chosen.area ? String(chosen.area).trim() : ''
      if (actualArea !== expected.area) {
        failures.push(`${routePath}: area mismatch (expected: ${expected.area} | actual: ${actualArea || 'none'})`)
      }
    }
  }

  if (failures.length === 0) {
    console.log('[roadmap-role-gates] PASS: related route gate expectations match route-role matrix.')
    return
  }

  console.log('[roadmap-role-gates] WARN: route-gate mismatches detected:')
  for (const failure of failures) {
    console.log(`- ${failure}`)
  }

  if (args.strict) {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(`[roadmap-role-gates] ${error.message}`)
  process.exit(1)
})
