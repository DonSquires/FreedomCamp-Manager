import { test } from '@playwright/test'
import { loginAs } from './auth'
import { bobAssessPage } from './bob-ui-assess'
import { assertRouteBlocked, assertRouteLoads } from './helpers/route-access-helpers'

test.use({ screenshot: 'on' })

test.describe('master – full platform access', () => {
  test.describe.configure({ mode: 'serial' })

  test('master loads /platform', async ({ page }, testInfo) => {
    await loginAs(page, 'master')
    await assertRouteLoads(page, '/platform')
    await bobAssessPage(page, testInfo, 'master-platform')
  })

  test('master loads /organizations', async ({ page }, testInfo) => {
    await loginAs(page, 'master')
    await assertRouteLoads(page, '/organizations')
    await bobAssessPage(page, testInfo, 'master-organizations')
  })

  test('master loads /intel-approvals', async ({ page }, testInfo) => {
    await loginAs(page, 'master')
    await assertRouteLoads(page, '/intel-approvals')
    await bobAssessPage(page, testInfo, 'master-intel-approvals')
  })

  test('master loads /users', async ({ page }, testInfo) => {
    await loginAs(page, 'master')
    await assertRouteLoads(page, '/users')
    await bobAssessPage(page, testInfo, 'master-users')
  })

  test('master loads /access-control', async ({ page }, testInfo) => {
    await loginAs(page, 'master')
    await assertRouteLoads(page, '/access-control')
    await bobAssessPage(page, testInfo, 'master-access-control')
  })

  test('master loads /admin/service-provider-access', async ({ page }, testInfo) => {
    await loginAs(page, 'master')
    await assertRouteLoads(page, '/admin/service-provider-access')
    await bobAssessPage(page, testInfo, 'master-service-provider-access')
  })
})

test.describe('admin – platform and reporting modules', () => {
  test.describe.configure({ mode: 'serial' })

  const adminRoutes = [
    ['/admin', 'admin-hub'],
    ['/admin/dashboard', 'admin-dashboard'],
    ['/compliance', 'admin-compliance'],
    ['/breaches', 'admin-breaches'],
    ['/vehicles', 'admin-vehicles'],
    ['/zones', 'admin-zones'],
    ['/data', 'admin-data'],
    ['/users', 'admin-users'],
    ['/reports', 'admin-reports'],
    ['/live-tracking', 'admin-live-tracking'],
    ['/organization-profile', 'admin-org-profile'],
    ['/audit-log', 'admin-audit-log'],
  ] as const

  for (const [route, assessmentId] of adminRoutes) {
    test(`admin loads ${route}`, async ({ page }, testInfo) => {
      await loginAs(page, 'adminOrg1')
      await assertRouteLoads(page, route)
      await bobAssessPage(page, testInfo, assessmentId)
    })
  }

  test('admin is BLOCKED from /platform (grand_master only)', async ({ page }) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteBlocked(page, '/platform')
  })

  test('admin is BLOCKED from /organizations (master+ only)', async ({ page }) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteBlocked(page, '/organizations')
  })

  test('admin is BLOCKED from /intel-approvals (master+ only)', async ({ page }) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteBlocked(page, '/intel-approvals')
  })
})