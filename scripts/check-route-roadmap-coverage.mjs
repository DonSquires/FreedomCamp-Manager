#!/usr/bin/env node

import { execSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const APP_PATH = 'src/App.tsx'
const ROADMAP_PATH = 'docs/MODULE_ROADMAP.md'

function run(command) {
  try {
    return execSync(command, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    }).trim()
  } catch {
    return ''
  }
}

function parseFiles(raw) {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function getChangedFiles() {
  const explicitRange = String(process.env.ROUTE_ROADMAP_DIFF_RANGE || process.env.DOC_AUTHORITY_DIFF_RANGE || '').trim()
  if (explicitRange) {
    const fromRange = run(`git diff --name-only ${explicitRange}`)
    return fromRange ? parseFiles(fromRange) : []
  }

  const staged = run('git diff --cached --name-only')
  if (staged) return parseFiles(staged)

  const unstaged = run('git diff --name-only')
  if (unstaged) return parseFiles(unstaged)

  const headDiff = run('git diff --name-only HEAD~1..HEAD')
  return headDiff ? parseFiles(headDiff) : []
}

function getAppDiffPatch() {
  const explicitRange = String(process.env.ROUTE_ROADMAP_DIFF_RANGE || process.env.DOC_AUTHORITY_DIFF_RANGE || '').trim()

  if (explicitRange) {
    const patch = run(`git diff -U0 ${explicitRange} -- ${APP_PATH}`)
    if (patch) return patch
  }

  const staged = run(`git diff --cached -U0 -- ${APP_PATH}`)
  if (staged) return staged

  const unstaged = run(`git diff -U0 -- ${APP_PATH}`)
  if (unstaged) return unstaged

  return run(`git diff -U0 HEAD~1..HEAD -- ${APP_PATH}`)
}

function extractChangedRoutes(patch) {
  const changed = new Set()
  const lines = patch.split('\n')

  for (const line of lines) {
    if (!line.startsWith('+') && !line.startsWith('-')) continue
    if (line.startsWith('+++') || line.startsWith('---')) continue

    const match = line.match(/path\s*=\s*['\"]([^'\"]+)['\"]/)
    if (!match) continue

    const route = String(match[1]).trim()
    if (!route || route === '*') continue
    changed.add(route)
  }

  return [...changed].sort()
}

async function main() {
  const strict = String(process.env.ROUTE_ROADMAP_STRICT || '').toLowerCase() === 'true'
  const changedFiles = getChangedFiles()

  if (!changedFiles.includes(APP_PATH)) {
    console.log('[route-roadmap] PASS: src/App.tsx is unchanged in current diff scope.')
    return
  }

  const patch = getAppDiffPatch()
  const changedRoutes = extractChangedRoutes(patch)

  if (changedRoutes.length === 0) {
    console.log('[route-roadmap] PASS: src/App.tsx changed but no route path additions/removals detected.')
    return
  }

  const roadmapRaw = await fs.readFile(path.resolve(process.cwd(), ROADMAP_PATH), 'utf8')
  const roadmapText = roadmapRaw.toLowerCase()
  const missing = changedRoutes.filter((route) => !roadmapText.includes(route.toLowerCase()))

  if (missing.length === 0) {
    console.log('[route-roadmap] PASS: changed routes are represented in docs/MODULE_ROADMAP.md.')
    return
  }

  console.log('[route-roadmap] WARN: changed routes missing from docs/MODULE_ROADMAP.md:')
  for (const route of missing) {
    console.log(`- ${route}`)
  }

  if (strict) {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(`[route-roadmap] ${error.message}`)
  process.exit(1)
})
