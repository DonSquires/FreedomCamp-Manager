#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const APP_PATH = 'src/App.tsx'
const DEFAULT_OUT = 'tools/module-grounding/module-grounding-report.json'

function parseArgs(argv) {
  const args = {
    app: APP_PATH,
    out: DEFAULT_OUT,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
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

function extractLazyImports(source) {
  const map = new Map()
  const regex = /const\s+([A-Za-z0-9_]+)\s*=\s*lazy\s*\(\(\)\s*=>\s*import\(\s*['\"]([^'\"]+)['\"]\s*\)/g
  let match
  while ((match = regex.exec(source)) !== null) {
    map.set(match[1], match[2])
  }
  return map
}

function normalizeImportPath(importPath) {
  const value = String(importPath || '').trim()
  if (!value) return ''
  if (value.startsWith('@/')) {
    return `src/${value.slice(2)}.tsx`
  }
  if (value.startsWith('./') || value.startsWith('../')) {
    return value
  }
  return ''
}

async function exists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

function extractPrimaryComponent(routeChunk) {
  const pathMatch = routeChunk.match(/path\s*=\s*['\"]([^'\"]+)['\"]/)
  if (!pathMatch) return null

  const routePath = String(pathMatch[1]).trim()
  if (!routePath || routePath === '*') return null

  if (routeChunk.includes('<Navigate')) {
    return { routePath, componentName: 'Navigate', isRedirect: true }
  }

  const componentMatches = [...routeChunk.matchAll(/<([A-Z][A-Za-z0-9_]*)\s*\/?\s*>/g)]
  const ignore = new Set(['Route', 'ProtectedRoute', 'RoleRoute', 'AreaRoute'])

  for (const hit of componentMatches) {
    const name = String(hit[1])
    if (ignore.has(name)) continue
    return { routePath, componentName: name, isRedirect: false }
  }

  return { routePath, componentName: null, isRedirect: false }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const cwd = process.cwd()
  const appPath = path.resolve(cwd, args.app)
  const outPath = path.resolve(cwd, args.out)

  const appRaw = await fs.readFile(appPath, 'utf8')
  const lazyImports = extractLazyImports(appRaw)
  const routeChunks = collectRouteChunks(appRaw)

  const routes = []

  for (const chunk of routeChunks) {
    const primary = extractPrimaryComponent(chunk)
    if (!primary) continue

    const importPath = primary.componentName ? lazyImports.get(primary.componentName) || '' : ''
    const resolved = normalizeImportPath(importPath)
    const existsFlag = resolved ? await exists(path.resolve(cwd, resolved)) : false

    routes.push({
      path: primary.routePath,
      componentName: primary.componentName,
      importPath,
      resolvedPath: resolved,
      isRedirect: primary.isRedirect,
      importResolved: Boolean(importPath),
      fileExists: primary.isRedirect ? true : existsFlag,
    })
  }

  const unresolvedRoutes = routes.filter((route) => !route.isRedirect && !route.importResolved)
  const missingFiles = routes.filter((route) => !route.isRedirect && route.importResolved && !route.fileExists)

  const payload = {
    generatedAt: new Date().toISOString(),
    source: args.app,
    routeCount: routes.length,
    unresolvedRouteCount: unresolvedRoutes.length,
    missingFileCount: missingFiles.length,
    unresolvedRoutes,
    missingFiles,
    routes,
  }

  await fs.mkdir(path.dirname(outPath), { recursive: true })
  await fs.writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')

  console.log(`[module-grounding] Wrote ${path.relative(cwd, outPath)}`)
  console.log(`[module-grounding] Routes: ${routes.length} | unresolved: ${unresolvedRoutes.length} | missing files: ${missingFiles.length}`)
}

main().catch((error) => {
  console.error(`[module-grounding] ${error.message}`)
  process.exit(1)
})
