#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

function parseArgs(argv) {
  const args = {
    gate: '',
    out: '',
    requiredIds: '',
    evidenceDir: '',
    matrixDir: '',
    strictDocAuthority: false,
    strictRouteRoadmap: false,
    strictRoadmapGrounding: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]

    if (token === '--strict-doc-authority') {
      args.strictDocAuthority = true
      continue
    }

    if (token === '--strict-route-roadmap') {
      args.strictRouteRoadmap = true
      continue
    }

    if (token === '--strict-roadmap-grounding') {
      args.strictRoadmapGrounding = true
      continue
    }

    const withEquals = token.match(/^--([^=]+)=(.*)$/)
    if (withEquals) {
      const key = withEquals[1]
      const value = withEquals[2]
      if (key in args) {
        args[key] = value
      }
      continue
    }

    if (token.startsWith('--')) {
      const key = token.slice(2)
      const next = argv[i + 1]
      if (key in args && next && !next.startsWith('--')) {
        args[key] = next
        i += 1
      }
    }
  }

  return args
}

async function getStats(targetPath) {
  try {
    const stat = await fs.stat(targetPath)
    return {
      exists: true,
      type: stat.isDirectory() ? 'directory' : 'file',
      sizeBytes: stat.size,
    }
  } catch {
    return {
      exists: false,
      type: 'missing',
      sizeBytes: 0,
    }
  }
}

function requireField(value, label) {
  if (!String(value || '').trim()) {
    throw new Error(`Missing required argument: ${label}`)
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  requireField(args.gate, '--gate')
  requireField(args.out, '--out')
  requireField(args.requiredIds, '--requiredIds')
  requireField(args.evidenceDir, '--evidenceDir')
  requireField(args.matrixDir, '--matrixDir')

  const outPath = path.resolve(process.cwd(), args.out)
  const evidenceDir = path.resolve(process.cwd(), args.evidenceDir)
  const matrixDir = path.resolve(process.cwd(), args.matrixDir)

  const requiredWorkflowIds = String(args.requiredIds)
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)

  const evidenceStats = await getStats(evidenceDir)
  const matrixStats = await getStats(matrixDir)

  const summary = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    gate: args.gate,
    git: {
      sha: process.env.GITHUB_SHA || null,
      ref: process.env.GITHUB_REF || null,
      eventName: process.env.GITHUB_EVENT_NAME || null,
      runId: process.env.GITHUB_RUN_ID || null,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
      actor: process.env.GITHUB_ACTOR || null,
    },
    strictControls: {
      docAuthority: Boolean(args.strictDocAuthority),
      routeRoadmap: Boolean(args.strictRouteRoadmap),
      roadmapGrounding: Boolean(args.strictRoadmapGrounding),
    },
    requiredWorkflowIds,
    artifacts: {
      workflowEvidenceDir: {
        path: args.evidenceDir,
        ...evidenceStats,
      },
      routeRoleMatrixDir: {
        path: args.matrixDir,
        ...matrixStats,
      },
    },
    checks: {
      evidenceDirExists: evidenceStats.exists,
      matrixDirExists: matrixStats.exists,
    },
  }

  await fs.mkdir(path.dirname(outPath), { recursive: true })
  await fs.writeFile(outPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')

  console.log(`[governance-summary] Wrote ${path.relative(process.cwd(), outPath)}`)
}

main().catch((error) => {
  console.error(`[governance-summary] ${error.message}`)
  process.exit(1)
})
