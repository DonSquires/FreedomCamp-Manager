import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const contractPaths = {
  organizationContext: 'src/hooks/useOrganization.ts',
  operationalOrganization: 'src/hooks/useOperationalOrganization.ts',
  clientOrgIds: 'src/hooks/useClientOrgIds.ts',
  organizationBoundary: 'src/hooks/useOrganizationBoundary.ts',
  orgUtils: 'src/lib/orgUtils.ts',
  dataIntegrityDashboard: 'src/pages/DataIntegrityDashboard.tsx',
  realignmentPlan: 'docs/BUILD_REALIGNMENT_PLAN_2026-05-04.md',
}

function repoPath(relativePath: string) {
  return path.resolve(process.cwd(), relativePath)
}

function source(relativePath: string) {
  return fs.readFileSync(repoPath(relativePath), 'utf8')
}

test.describe('Phase E2 — Enterprise hardening and tenancy-safety gate', () => {
  test('E2 shared tenancy contract files remain present', () => {
    for (const [label, relativePath] of Object.entries(contractPaths)) {
      expect(fs.existsSync(repoPath(relativePath)), `${label} should remain at ${relativePath}`).toBe(true)
    }
  })

  test('operational organization selection stays bounded to authorized organizations', () => {
    const hook = source(contractPaths.operationalOrganization)

    expect(hook).toContain('authorizedOrganizationIds')
    expect(hook).toContain('user?.organization_id')
    expect(hook).toContain('user?.employer_organization_id')
    expect(hook).toContain('user?.authorized_work_locations')
    expect(hook).toContain('user?.extra_organization_ids')
    expect(hook).toContain('authorizedOrganizationIds.includes(organizationId)')
  })

  test('client organization contract preserves descendant scoping for non-grand-master users', () => {
    const hook = source(contractPaths.clientOrgIds)

    expect(hook).toContain("role === 'grand_master'")
    expect(hook).toContain('get_descendant_organizations')
    expect(hook).toContain("queryKey: ['org-descendant-ids', orgId]")
    expect(hook).toContain('enabled: !!orgId && !isGrandMaster')
    expect(hook).toContain('if (isGrandMaster) return { orgIds: null')
    expect(hook).toContain('if (!orgId)        return { orgIds: []')
  })

  test('organization boundary reads remain parameter-scoped and disabled without an org id', () => {
    const hook = source(contractPaths.organizationBoundary)

    expect(hook).toContain("queryKey: ['organization-boundary', organizationId]")
    expect(hook).toContain("from('organizations')")
    expect(hook).toContain(".eq('id', organizationId)")
    expect(hook).toContain('enabled: !!organizationId')
  })

  test('effective org utility preserves master-selected and user-org fallback rules', () => {
    const utility = source(contractPaths.orgUtils)

    expect(utility).toContain('export function getEffectiveOrgId')
    expect(utility).toContain("if (user.role === 'master') return selectedOrgId ?? null")
    expect(utility).toContain('return user.organization_id ?? null')
  })

  test('E2 scope remains anchored to audit completeness and domain query metrics', () => {
    const plan = source(contractPaths.realignmentPlan)

    expect(plan).toContain('Slice E2, Data Platform Lead: audit dashboards, event completeness checks, domain query metrics')
    expect(plan).toContain('Add governance dashboards and event completeness checks')
    expect(plan).toContain('Data Platform Lead owns the data-access audit rule, CI drift checks, and domain query metrics')
  })

  test('Data Integrity Dashboard exposes E2 audit completeness and domain query metric coverage', () => {
    const dashboard = source(contractPaths.dataIntegrityDashboard)

    expect(dashboard).toContain('E2 Domain Query Metrics')
    expect(dashboard).toContain('Audit dashboard coverage for event completeness, tenancy scope, and domain query ownership.')
    expect(dashboard).toContain('Evidence completeness')
    expect(dashboard).toContain('Enforcement event completeness')
    expect(dashboard).toContain('Configuration completeness')
    expect(dashboard).toContain('Identity completeness')
    expect(dashboard).toContain('Vehicle data movement')
    expect(dashboard).toContain("if (orgFilter) gpsQuery = gpsQuery.eq('organization_id', orgFilter)")
    expect(dashboard).toContain("gpsQuery = gpsQuery.or('gps_latitude.is.null,gps_longitude.is.null')")
  })
})
