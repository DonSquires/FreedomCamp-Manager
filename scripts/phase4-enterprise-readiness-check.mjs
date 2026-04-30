#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()

function read(relPath) {
  const abs = path.join(root, relPath)
  if (!fs.existsSync(abs)) {
    throw new Error(`Missing required file: ${relPath}`)
  }
  return fs.readFileSync(abs, 'utf8')
}

function checkContains(relPath, needle, label) {
  const content = read(relPath)
  const pass = content.includes(needle)
  return {
    label,
    file: relPath,
    pass,
    detail: pass ? 'ok' : `missing snippet: ${needle}`,
  }
}

const checks = [
  checkContains(
    'docs/PHASE4_DR_PLAYBOOKS_AND_RESTORE_DRILLS_2026-04-25.md',
    'scripts/rollback-emergency.sh',
    'DR artifact references emergency rollback coordinator',
  ),
  checkContains(
    'docs/PHASE4_DR_PLAYBOOKS_AND_RESTORE_DRILLS_2026-04-25.md',
    'docs/DB_MIGRATION_ROLLBACK_MATRIX.md',
    'DR artifact references rollback matrix',
  ),
  checkContains(
    'docs/PHASE4_DR_PLAYBOOKS_AND_RESTORE_DRILLS_2026-04-25.md',
    'scripts/post-deployment-smoke-test.sh',
    'DR artifact references post deployment smoke test',
  ),
  checkContains(
    'docs/PHASE4_TENANT_ISOLATION_CERTIFICATION_REPORT_2026-04-25.md',
    'tests/e2e/org-isolation-proof.spec.ts',
    'Tenant certification references UI/API isolation proof tests',
  ),
  checkContains(
    'docs/PHASE4_TENANT_ISOLATION_CERTIFICATION_REPORT_2026-04-25.md',
    '.github/workflows/ci-org-scope-audit.yml',
    'Tenant certification references org scope CI gate',
  ),
  checkContains(
    'docs/PHASE4_TENANT_ISOLATION_CERTIFICATION_REPORT_2026-04-25.md',
    'supabase/migrations/20260215000005_multi_organization_hierarchy.sql',
    'Tenant certification references multi org hierarchy migration',
  ),
  checkContains(
    'docs/PHASE4_OPS_HANDOVER_AND_RUNBOOKS_2026-04-25.md',
    '.github/workflows/synthetic-monitor.yml',
    'Ops handover references synthetic monitoring workflow',
  ),
  checkContains(
    'docs/PHASE4_OPS_HANDOVER_AND_RUNBOOKS_2026-04-25.md',
    '.github/workflows/ops-bob-human-interaction-smoke.yml',
    'Ops handover references human interaction smoke workflow',
  ),
  checkContains(
    'docs/PHASE4_OPS_HANDOVER_AND_RUNBOOKS_2026-04-25.md',
    'docs/PTT_SELF_HOSTED_OPERATIONS_STANDARD.md',
    'Ops handover references PTT operations standard',
  ),
  checkContains(
    'scripts/rollback-emergency.sh',
    'MIGRATION_COUNT',
    'Rollback script includes migration verification checkpoint',
  ),
  checkContains(
    '.github/workflows/synthetic-monitor.yml',
    'Evaluate overall health',
    'Synthetic monitor workflow has explicit health evaluation gate',
  ),
  checkContains(
    '.github/workflows/ops-railway-wiring-audit.yml',
    'check-services-health',
    'Railway wiring audit checks edge health function',
  ),
]

let passed = 0

for (const check of checks) {
  if (check.pass) {
    passed += 1
  }
}

const failed = checks.length - passed

console.log('Phase 4 Enterprise Readiness Check')
console.log(`Checks: ${checks.length}`)
console.log(`Passed: ${passed}`)
console.log(`Failed: ${failed}`)
console.log('')

for (const check of checks) {
  const status = check.pass ? 'PASS' : 'FAIL'
  console.log(`[${status}] ${check.label} (${check.file})`)
  if (!check.pass) {
    console.log(`  -> ${check.detail}`)
  }
}

if (failed > 0) {
  process.exit(1)
}
