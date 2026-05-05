import { test } from '@playwright/test'
import { loginAs } from './auth'
import { bobAssessPage } from './bob-ui-assess'
import { assertRouteLoads } from './helpers/route-access-helpers'

test.use({ screenshot: 'on' })

test.describe('admin – enforcement and analytics modules', () => {
  test.describe.configure({ mode: 'serial' })

  const adminRoutes = [
    ['/infringements', 'admin-infringements'],
    ['/patrol-checkpoints', 'admin-patrol-checkpoints'],
    ['/patrol-schedule', 'admin-patrol-schedule'],
    ['/patrol-kpis', 'admin-patrol-kpis'],
    ['/live-patrol', 'admin-live-patrol'],
    ['/custom-reports', 'admin-custom-reports'],
    ['/ai-analysis', 'admin-ai-analysis'],
    ['/hotspots', 'admin-hotspots'],
    ['/spatial-compliance', 'admin-spatial-compliance'],
    ['/compliance-analytics', 'admin-compliance-analytics'],
    ['/incident-reports', 'admin-incident-reports'],
    ['/observations', 'admin-observations'],
    ['/enforcement-review', 'admin-enforcement-review'],
    ['/investigations', 'admin-investigations'],
    ['/notice-to-vacate', 'admin-notice-to-vacate'],
    ['/disputes', 'admin-disputes'],
    ['/admin/discrepancies', 'admin-discrepancies'],
    ['/admin/nzscv', 'admin-nzscv'],
    ['/officer-welfare', 'admin-officer-welfare'],
  ] as const

  for (const [route, assessmentId] of adminRoutes) {
    test(`admin loads ${route}`, async ({ page }, testInfo) => {
      await loginAs(page, 'adminOrg1')
      await assertRouteLoads(page, route)
      await bobAssessPage(page, testInfo, assessmentId)
    })
  }
})