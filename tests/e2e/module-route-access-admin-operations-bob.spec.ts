import { test } from '@playwright/test'
import { loginAs } from './auth'
import { bobAssessPage } from './bob-ui-assess'
import { assertRouteLoads } from './helpers/route-access-helpers'

test.use({ screenshot: 'on' })

test.describe('admin – operations, CRM, and Bob modules', () => {
  test.describe.configure({ mode: 'serial' })

  const adminRoutes = [
    ['/open-shifts', 'admin-open-shifts'],
    ['/dispatch', 'admin-dispatch'],
    ['/dispatch-monitor', 'admin-dispatch-monitor'],
    ['/dispatch-wizard', 'admin-dispatch-wizard'],
    ['/dispatched-jobs', 'admin-dispatched-jobs'],
    ['/job-map', 'admin-job-map'],
    ['/operations-map', 'admin-operations-map'],
    ['/client-sites', 'admin-client-sites'],
    ['/client-master-list', 'admin-client-master-list'],
    ['/roster', 'admin-roster'],
    ['/officer-skills', 'admin-officer-skills'],
    ['/crm', 'admin-crm'],
    ['/bob-intake-queue', 'admin-bob-intake'],
    ['/bob-assistant', 'admin-bob-assistant'],
    ['/live-plan-reviews', 'admin-live-plan-reviews'],
  ] as const

  for (const [route, assessmentId] of adminRoutes) {
    test(`admin loads ${route}`, async ({ page }, testInfo) => {
      await loginAs(page, 'adminOrg1')
      await assertRouteLoads(page, route)
      await bobAssessPage(page, testInfo, assessmentId)
    })
  }
})