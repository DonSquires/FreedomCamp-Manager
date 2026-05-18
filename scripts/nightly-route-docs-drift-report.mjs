#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const ARTIFACT_PATH = 'docs/route-contract-canonical.json'
const DOC_SOURCES = [
  'docs/INSTRUCTION_MANUAL.md',
  'docs/ROUTE_CONSOLIDATION_MANIFEST.md',
  'docs/BOB_SYSTEM_ROUTE_MAP.md',
]

function parseArgs(argv) {
  const args = {
    out: '',
    strict: true,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--no-strict') {
      args.strict = false
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

function isCovered(routePath, content) {
  return content.includes(routePath)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const root = process.cwd()
  const artifactRaw = await fs.readFile(path.resolve(root, ARTIFACT_PATH), 'utf8')
  const artifact = JSON.parse(artifactRaw)
  const docContents = await Promise.all(
    DOC_SOURCES.map(async (docPath) => ({
      path: docPath,
      content: await fs.readFile(path.resolve(root, docPath), 'utf8'),
    }))
  )

  if (!artifact || !Array.isArray(artifact.routes)) {
    throw new Error(`Invalid route contract artifact in ${ARTIFACT_PATH}`)
  }

  const lines = []
  const missing = []

  lines.push('# Nightly Docs vs Router Drift Report')
  lines.push('')
  lines.push(`- Generated: ${new Date().toISOString()}`)
  lines.push(`- Canonical route slice: ${ARTIFACT_PATH}`)
  lines.push(`- Docs checked: ${DOC_SOURCES.join(', ')}`)
  lines.push('')
  lines.push('| Route | Docs coverage |')
  lines.push('|---|---|')

  for (const route of artifact.routes) {
    const coverage = docContents
      .filter(({ content }) => isCovered(route.path, content))
      .map(({ path: docPath }) => docPath)

    if (coverage.length === 0) {
      missing.push(route.path)
    }

    lines.push(`| ${route.path} | ${coverage.length > 0 ? coverage.join(', ') : 'MISSING'} |`)
  }

  lines.push('')
  lines.push(`- Missing routes: ${missing.length}`)

  if (missing.length > 0) {
    lines.push('')
    lines.push('## Missing Coverage')
    for (const routePath of missing) {
      lines.push(`- ${routePath}`)
    }
  }

  const report = `${lines.join('\n')}\n`

  if (args.out) {
    const outPath = path.resolve(root, args.out)
    await fs.mkdir(path.dirname(outPath), { recursive: true })
    await fs.writeFile(outPath, report, 'utf8')
  } else {
    process.stdout.write(report)
  }

  if (missing.length > 0) {
    console.error(`[route-doc-drift] FAIL: ${missing.length} route paths are missing from the checked docs`)
    if (args.strict) process.exit(1)
    return
  }

  console.log(`[route-doc-drift] PASS: ${artifact.routes.length} routes are documented across the checked sources`)
}

main().catch((error) => {
  console.error(`[route-doc-drift] ${error.message}`)
  process.exit(1)
})