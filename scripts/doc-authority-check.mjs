#!/usr/bin/env node

import { execSync } from 'node:child_process'
import process from 'node:process'

function run(command) {
  try {
    return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch {
    return ''
  }
}

function parseFiles(raw) {
  return raw
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean)
}

function getChangedFilesFromRange(range) {
  const fromRange = run(`git diff --name-only ${range}`)
  return fromRange ? parseFiles(fromRange) : []
}

function getChangedFiles() {
  const explicitRange = String(process.env.DOC_AUTHORITY_DIFF_RANGE || '').trim()
  if (explicitRange) {
    return getChangedFilesFromRange(explicitRange)
  }

  const staged = run('git diff --cached --name-only')
  if (staged) {
    return parseFiles(staged)
  }

  const unstaged = run('git diff --name-only')
  if (unstaged) {
    return parseFiles(unstaged)
  }

  const headDiff = run('git diff --name-only HEAD~1..HEAD')
  return headDiff ? parseFiles(headDiff) : []
}

function includesPath(files, path) {
  return files.includes(path)
}

function startsWithPath(files, prefix) {
  return files.some((f) => f.startsWith(prefix))
}

function main() {
  const changed = getChangedFiles()
  if (changed.length === 0) {
    console.log('[doc-authority] No changes detected; nothing to validate.')
    return
  }

  const warnings = []

  const routeChanged = includesPath(changed, 'src/App.tsx')
  const edgeChanged = startsWithPath(changed, 'supabase/functions/')
  const schemaChanged = startsWithPath(changed, 'supabase/migrations/')

  const roadmapUpdated = includesPath(changed, 'docs/MODULE_ROADMAP.md')
  const canonicalUpdated = includesPath(changed, 'docs/ENTERPRISE_PAIR_REVIEW_CANONICAL.md')

  if (routeChanged && !roadmapUpdated) {
    warnings.push('Route topology changed in src/App.tsx without docs/MODULE_ROADMAP.md update.')
  }

  if ((routeChanged || edgeChanged || schemaChanged) && !canonicalUpdated) {
    warnings.push('Architecture-impacting change detected without docs/ENTERPRISE_PAIR_REVIEW_CANONICAL.md update.')
  }

  if (warnings.length === 0) {
    console.log('[doc-authority] PASS: canonical documentation updates detected for changed scope.')
    return
  }

  console.log('[doc-authority] WARN: potential documentation authority drift detected:')
  for (const warning of warnings) {
    console.log(`- ${warning}`)
  }

  console.log('[doc-authority] Suggested follow-up docs:')
  console.log('- docs/MODULE_ROADMAP.md')
  console.log('- docs/ENTERPRISE_PAIR_REVIEW_CANONICAL.md')

  if (String(process.env.DOC_AUTHORITY_STRICT || '').toLowerCase() === 'true') {
    process.exit(1)
  }
}

main()
