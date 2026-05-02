#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const APP_PATH = 'src/App.tsx'
const DEFAULT_OUT = 'tools/route-role-matrix/route-role-matrix.json'

function parseArgs(argv) {
  const args = {
    app: APP_PATH,
    out: DEFAULT_OUT,
    print: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]

    if (token === '--print') {
      args.print = true
      continue
    }

    if (token.startsWith('--app=')) {
      args.app = token.split('=')[1] || args.app
      continue
    }

    if (token === '--app') {
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        args.app = next
        i += 1
      }
      continue
    }

    if (token.startsWith('--out=')) {
      args.out = token.split('=')[1] || args.out
      continue
    }

    if (token === '--out') {
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        args.out = next
        i += 1
      }
    }
  }

  return args
}

function collectRouteChunks(source) {
  const chunks = []
  let cursor = 0

  while (cursor < source.length) {
    const start = source.indexOf('<Route', cursor)
    if (start === -1) break

    const end = source.indexOf('/>', start)
    if (end === -1) break

    chunks.push(source.slice(start, end + 2))
    cursor = end + 2
  }

  return chunks
}

function parseRoles(segment) {
  const rolesMatch = segment.match(/allowedRoles\s*=\s*\{\s*\[([\s\S]*?)\]\s*\}/)
  if (!rolesMatch) return []

  return rolesMatch[1]
    .split(',')
    .map((value) => value.replace(/['"\s]/g, '').trim())
    .filter(Boolean)
}

function buildRouteEntry(routeChunk, index) {
  const pathMatch = routeChunk.match(/path\s*=\s*['\"]([^'\"]+)['\"]/)
  if (!pathMatch) return null

  const routePath = String(pathMatch[1]).trim()
  if (!routePath || routePath === '*') return null

  const isProtected = routeChunk.includes('<ProtectedRoute>')
  const isRoleRoute = routeChunk.includes('<RoleRoute')
  const isAreaRoute = routeChunk.includes('<AreaRoute')
  const isNavigate = routeChunk.includes('<Navigate')

  const roles = parseRoles(routeChunk)
  const areaMatch = routeChunk.match(/area\s*=\s*['\"]([^'\"]+)['\"]/)
  const area = areaMatch ? String(areaMatch[1]).trim() : null

  let accessType = 'public'
  if (isNavigate) {
    accessType = 'redirect'
  } else if (isAreaRoute) {
    accessType = 'protected-area'
  } else if (isRoleRoute) {
    accessType = 'protected-role'
  } else if (isProtected) {
    accessType = 'protected-authenticated'
  }

  return {
    path: routePath,
    accessType,
    roles,
    area,
    protected: isProtected,
    sourceIndex: index + 1,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const appPath = path.resolve(process.cwd(), args.app)
  const outPath = path.resolve(process.cwd(), args.out)

  const appRaw = await fs.readFile(appPath, 'utf8')
  const routeChunks = collectRouteChunks(appRaw)

  const routes = []
  for (let i = 0; i < routeChunks.length; i += 1) {
    const entry = buildRouteEntry(routeChunks[i], i)
    if (entry) routes.push(entry)
  }

  const byPath = new Map()
  for (const route of routes) {
    const existing = byPath.get(route.path) || []
    existing.push(route)
    byPath.set(route.path, existing)
  }

  const duplicates = [...byPath.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([routePath, items]) => ({
      path: routePath,
      count: items.length,
      sourceIndexes: items.map((item) => item.sourceIndex),
    }))

  const payload = {
    generatedAt: new Date().toISOString(),
    source: args.app,
    routeCount: routes.length,
    duplicatePathCount: duplicates.length,
    duplicates,
    routes,
  }

  if (args.print) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
    return
  }

  await fs.mkdir(path.dirname(outPath), { recursive: true })
  await fs.writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')

  console.log(`[route-role-matrix] Wrote ${path.relative(process.cwd(), outPath)}`)
  console.log(`[route-role-matrix] Route count: ${routes.length}`)
  if (duplicates.length > 0) {
    console.log(`[route-role-matrix] Duplicate path entries detected: ${duplicates.length}`)
  }
}

main().catch((error) => {
  console.error(`[route-role-matrix] ${error.message}`)
  process.exit(1)
})
