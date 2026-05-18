#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { routeManifest } from '../src/navigation/routeManifest.ts'

const ARTIFACT_PATH = 'docs/route-contract-canonical.json'

function normalizeEntry(entry) {
  return {
    routeId: entry.routeId,
    path: entry.path,
    shell: entry.shell,
    rolesAllowed: [...entry.rolesAllowed].sort(),
    navLabel: entry.navLabel ?? null,
    visibilityMode: entry.visibilityMode,
    preloadPolicy: entry.preloadPolicy,
  }
}

async function main() {
  const artifactPath = path.resolve(process.cwd(), ARTIFACT_PATH)
  const rawArtifact = await fs.readFile(artifactPath, 'utf8')
  const artifact = JSON.parse(rawArtifact)

  if (!artifact || !Array.isArray(artifact.routes)) {
    throw new Error(`Invalid route contract artifact: expected { routes: [...] } in ${ARTIFACT_PATH}`)
  }

  const liveByPath = new Map(routeManifest.map((entry) => [entry.path, normalizeEntry(entry)]))
  const expected = artifact.routes.map(normalizeEntry)

  const mismatches = []

  for (const expectedEntry of expected) {
    const liveEntry = liveByPath.get(expectedEntry.path)
    if (!liveEntry) {
      mismatches.push(`Missing live route for ${expectedEntry.path}`)
      continue
    }

    const expectedJson = JSON.stringify(expectedEntry)
    const liveJson = JSON.stringify(liveEntry)
    if (expectedJson !== liveJson) {
      mismatches.push(`Contract drift for ${expectedEntry.path}`)
      mismatches.push(`  expected: ${expectedJson}`)
      mismatches.push(`  actual:   ${liveJson}`)
    }
  }

  if (mismatches.length > 0) {
    console.error('[route-contract] FAIL: canonical route contract drift detected')
    for (const line of mismatches) {
      console.error(line)
    }
    process.exit(1)
  }

  console.log(`[route-contract] PASS: ${expected.length} governance routes match ${ARTIFACT_PATH}`)
}

main().catch((error) => {
  console.error(`[route-contract] ${error.message}`)
  process.exit(1)
})