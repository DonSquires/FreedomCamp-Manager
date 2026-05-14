#!/usr/bin/env node

/**
 * Phase B Module Migration Validator
 *
 * Verifies repository-grounded readiness for Phase B slices (B1-B4):
 * - Required migrations
 * - Required hooks
 * - Required route integrations
 * - Required CI workflows
 * - Required E2E specs
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

const requiredFiles = [
  'supabase/migrations/20260504000005_phase_b1_bridge_to_case_model.sql',
  'supabase/migrations/20260506000009_phase_b2_dispatch_case_bridge.sql',
  'supabase/migrations/20260506000004_phase_b3_radio_comms_case_bridge.sql',
  'supabase/migrations/20260506000010_phase_b4_enforcement_case_bridge.sql',
  'src/hooks/usePatrolB1.ts',
  'src/hooks/useDispatchB2.ts',
  'src/hooks/useCommsB3.ts',
  'src/hooks/useEnforcementB4.ts',
  '.github/workflows/ci-phase-b1-patrol-gate.yml',
  '.github/workflows/ci-phase-b2-dispatch-gate.yml',
  '.github/workflows/ci-phase-b3-communications-gate.yml',
  '.github/workflows/ci-phase-b4-enforcement-gate.yml',
  'tests/e2e/phase-b1-patrol-and-respond.spec.ts',
  'tests/e2e/phase-b2-dispatch-command.spec.ts',
  'tests/e2e/phase-b3-communications.spec.ts',
  'tests/e2e/phase-b4-enforcement-timeline.spec.ts',
  'scripts/advance-canary-stage.sh',
  'scripts/rollback-feature-flag.sh',
]

const contentChecks = [
  {
    file: 'src/pages/FieldOfficerPortal.tsx',
    includes: ['useCreatePatrolEvent', "useFeatureFlag('FF_PHASE_B_PATROL_EVENTS')"],
    label: 'B1 route integration',
  },
  {
    file: 'src/pages/DispatchConsole.tsx',
    includes: ['useCreateDispatchEvent', "useFeatureFlag('FF_PHASE_B_DISPATCH_EVENTS')"],
    label: 'B2 route integration',
  },
  {
    file: 'src/pages/EnforcementActions.tsx',
    includes: ['useCreateEnforcementEvent', "useFeatureFlag('FF_PHASE_B_ENFORCEMENT_EVENTS')"],
    label: 'B4 route integration',
  },
]

function readFileSafe(relPath) {
  const fullPath = path.join(rootDir, relPath)
  if (!fs.existsSync(fullPath)) return null
  return fs.readFileSync(fullPath, 'utf8')
}

function validateFiles() {
  const missing = requiredFiles.filter((relPath) => !fs.existsSync(path.join(rootDir, relPath)))
  return {
    passed: missing.length === 0,
    missing,
  }
}

function validateContent() {
  const failures = []

  for (const check of contentChecks) {
    const content = readFileSafe(check.file)
    if (!content) {
      failures.push(`${check.label}: file missing (${check.file})`)
      continue
    }

    const missingTokens = check.includes.filter((token) => !content.includes(token))
    if (missingTokens.length > 0) {
      failures.push(`${check.label}: missing ${missingTokens.join(', ')}`)
    }
  }

  return {
    passed: failures.length === 0,
    failures,
  }
}

function printHeader(title) {
  console.log(`\n${title}`)
  console.log('='.repeat(title.length))
}

function main() {
  printHeader('Phase B Module Migration Validator')

  const fileResult = validateFiles()
  const contentResult = validateContent()

  printHeader('Artifact Check')
  if (fileResult.passed) {
    console.log('PASS: All required Phase B artifacts are present.')
  } else {
    console.log(`FAIL: Missing ${fileResult.missing.length} required artifact(s).`)
    for (const relPath of fileResult.missing) {
      console.log(`  - ${relPath}`)
    }
  }

  printHeader('Integration Check')
  if (contentResult.passed) {
    console.log('PASS: Required route-level Phase B integrations are present.')
  } else {
    console.log(`FAIL: ${contentResult.failures.length} integration issue(s).`)
    for (const failure of contentResult.failures) {
      console.log(`  - ${failure}`)
    }
  }

  const pass = fileResult.passed && contentResult.passed

  printHeader('Summary')
  if (pass) {
    console.log('PASS: Phase B module migration artifacts and integrations are repository-ready.')
    process.exit(0)
  }

  console.log('FAIL: Phase B module migration validation did not pass.')
  process.exit(1)
}

main()
