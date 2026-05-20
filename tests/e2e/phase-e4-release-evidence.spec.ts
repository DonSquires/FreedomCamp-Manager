import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const contractPaths = {
  realignmentPlan: 'docs/BUILD_REALIGNMENT_PLAN_2026-05-04.md',
  moduleRoadmap: 'docs/MODULE_ROADMAP.md',
  staging: 'docs/STAGING.md',
  packageJson: 'package.json',
  e1Spec: 'tests/e2e/phase-e1-data-access-consolidation.spec.ts',
  e2Spec: 'tests/e2e/phase-e2-enterprise-hardening-tenancy.spec.ts',
  e3Spec: 'tests/e2e/phase-e3-communications-audit-retry.spec.ts',
  e4Spec: 'tests/e2e/phase-e4-release-evidence.spec.ts',
  e1Workflow: '.github/workflows/ci-phase-e1-data-access-consolidation-gate.yml',
  e2Workflow: '.github/workflows/ci-phase-e2-enterprise-hardening-tenancy-gate.yml',
  e3Workflow: '.github/workflows/ci-phase-e3-communications-audit-retry-gate.yml',
  e4Workflow: '.github/workflows/ci-phase-e4-release-evidence-gate.yml',
}

function repoPath(relativePath: string) {
  return path.resolve(process.cwd(), relativePath)
}

function source(relativePath: string) {
  return fs.readFileSync(repoPath(relativePath), 'utf8')
}

test.describe('Phase E4 — Release evidence and rollout sign-off gate', () => {
  test('E1 through E4 gate files remain present', () => {
    for (const [label, relativePath] of Object.entries(contractPaths)) {
      expect(fs.existsSync(repoPath(relativePath)), `${label} should remain at ${relativePath}`).toBe(true)
    }
  })

  test('roadmap preserves Phase E completion requirements and E4 evidence anchors', () => {
    const roadmap = source(contractPaths.moduleRoadmap)

    expect(roadmap).toContain('### Phase E kickoff order (E1 → E4)')
    expect(roadmap).toContain('E4 — Final release evidence pack and cross-module rollout sign-off.')
    expect(roadmap).toContain('E1–E4 gate suites and CI workflows all present and passing.')
    expect(roadmap).toContain('No unresolved blockers in staging handoff logs for tenant isolation, replay safety, or rollout rollback.')
    expect(roadmap).toContain('Canonical docs (`STAGING.md`, `MODULE_ROADMAP.md`) updated with final evidence references.')
    expect(roadmap).toContain('### E4 release evidence gate artifacts')
    expect(roadmap).toContain('tests/e2e/phase-e4-release-evidence.spec.ts')
    expect(roadmap).toContain('.github/workflows/ci-phase-e4-release-evidence-gate.yml')
    expect(roadmap).toContain('Phase E release evidence pack locks E1–E3 gate coverage')
    expect(roadmap).toContain('### Phase E closeout validation status')
    expect(roadmap).toContain('Phase E final validation is recorded as green')
    expect(roadmap).toContain('E1, E2, E3, and E4 focused gates: PASS (`110 passed`)')
  })

  test('staging records E4 release evidence and rollback-ready handoff', () => {
    const staging = source(contractPaths.staging)

    expect(staging).toContain('Phase E4 Release Evidence Gate Kickoff')
    expect(staging).toContain('E4 release evidence checkpoint')
    expect(staging).toContain('lint/build plus E1, E2, E3, and E4 gates')
    expect(staging).toContain('tenant isolation, degraded communications outcomes, data-access drift, and rollback-ready docs')
    expect(staging).toContain('Treat any `UNRESOLVED PHASE E BLOCKER` staging entry as a merge blocker until resolved.')
    expect(staging).toContain('Phase E Final Closeout Validation')
    expect(staging).toContain('`npm run lint` → PASS')
    expect(staging).toContain('`npm run build` → PASS')
    expect(staging).toContain('E1/E2/E3/E4 focused gates → PASS (`110 passed`)')
  })

  test('release evidence includes all prior Phase E slice gates and workflows', () => {
    const roadmap = source(contractPaths.moduleRoadmap)
    const staging = source(contractPaths.staging)
    const packageJson = source(contractPaths.packageJson)

    for (const relativePath of [
      contractPaths.e1Spec,
      contractPaths.e2Spec,
      contractPaths.e3Spec,
      contractPaths.e4Spec,
      contractPaths.e1Workflow,
      contractPaths.e2Workflow,
      contractPaths.e3Workflow,
      contractPaths.e4Workflow,
    ]) {
      expect(roadmap + staging).toContain(relativePath)
    }

    expect(packageJson).toContain('"lint": "eslint ."')
    expect(packageJson).toContain('"build": "tsc -b && vite build"')
  })

  test('E4 workflow is path-filtered to Phase E release evidence anchors', () => {
    const workflow = source(contractPaths.e4Workflow)

    expect(workflow).toContain('CI Phase E4 Release Evidence Gate')
    expect(workflow).toContain('tests/e2e/phase-e4-release-evidence.spec.ts')
    expect(workflow).toContain('tests/e2e/phase-e1-data-access-consolidation.spec.ts')
    expect(workflow).toContain('tests/e2e/phase-e2-enterprise-hardening-tenancy.spec.ts')
    expect(workflow).toContain('tests/e2e/phase-e3-communications-audit-retry.spec.ts')
    expect(workflow).toContain('docs/BUILD_REALIGNMENT_PLAN_2026-05-04.md')
    expect(workflow).toContain('docs/MODULE_ROADMAP.md')
    expect(workflow).toContain('docs/STAGING.md')
    expect(workflow).toContain('npx playwright test')
  })
})
