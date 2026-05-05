import { test } from '@playwright/test'
import { loginAs } from './auth'
import { bobAssessPage } from './bob-ui-assess'
import { assertRouteLoads } from './helpers/route-access-helpers'

test.use({ screenshot: 'on' })

test.describe('admin – records, finance, and registry modules', () => {
  test.describe.configure({ mode: 'serial' })

  const adminRoutes = [
    ['/privacy-curtain', 'admin-privacy-curtain'],
    ['/person-records', 'admin-person-records'],
    ['/identity-verification', 'admin-identity-verification'],
    ['/import-data', 'admin-import-data'],
    ['/parking', 'admin-parking'],
    ['/noise-control', 'admin-noise-control'],
    ['/biosecurity-control', 'admin-biosecurity-control'],
    ['/smoke-control', 'admin-smoke-control'],
    ['/vehicle-registry', 'admin-vehicle-registry'],
    ['/admin/canonical-records', 'admin-canonical-records'],
    ['/asset-management', 'admin-asset-management'],
    ['/invoicing', 'admin-invoicing'],
    ['/pricing', 'admin-pricing'],
    ['/timesheets', 'admin-timesheets'],
  ] as const

  for (const [route, assessmentId] of adminRoutes) {
    test(`admin loads ${route}`, async ({ page }, testInfo) => {
      await loginAs(page, 'adminOrg1')
      await assertRouteLoads(page, route)
      await bobAssessPage(page, testInfo, assessmentId)
    })
  }
})