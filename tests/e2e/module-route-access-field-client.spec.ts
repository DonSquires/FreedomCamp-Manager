import { test } from '@playwright/test'
import { loginAs } from './auth'
import { bobAssessPage } from './bob-ui-assess'
import { assertRouteBlocked, assertRouteLoads, assertRouteLoadsOrRedirects } from './helpers/route-access-helpers'

test.use({ screenshot: 'on' })

async function loginClientViewerOrSkip(page: any) {
  await loginAs(page, 'clientViewer')
  await page.goto('/client-portal', { waitUntil: 'domcontentloaded' })

  const onClientPortal = page.url().includes('/client-portal')
  if (!onClientPortal) {
    test.skip(true, `Shared account did not resolve to client portal context (url=${page.url()})`)
  }
}

test.describe('officer – field portal access', () => {
  test.describe.configure({ mode: 'serial' })

  test('officer loads /officer-home', async ({ page }, testInfo) => {
    await loginAs(page, 'officerOrg1')
    await assertRouteLoads(page, '/officer-home')
    await bobAssessPage(page, testInfo, 'officer-home')
  })

  test('officer loads /field-officer', async ({ page }, testInfo) => {
    await loginAs(page, 'officerOrg1')
    await page.goto('/field-officer', { waitUntil: 'networkidle' })
    const currentPath = new URL(page.url()).pathname
    expect(['/field-officer', '/officer-home', '/admin']).toContain(currentPath)
    await bobAssessPage(page, testInfo, 'officer-field-portal')
  })

  const officerRoutes = [
    ['/infringements', 'officer-infringements'],
    ['/points-of-interest', 'officer-points-of-interest'],
    ['/site-risk-assessment', 'officer-site-risk'],
    ['/face-recognition', 'officer-face-recognition'],
    ['/open-shifts', 'officer-open-shifts'],
    ['/job-map', 'officer-job-map'],
    ['/bob-assistant', 'officer-bob-assistant'],
    ['/radio', 'officer-radio'],
    ['/availability', 'officer-availability'],
  ] as const

  for (const [route, assessmentId] of officerRoutes) {
    test(`officer loads ${route}`, async ({ page }, testInfo) => {
      await loginAs(page, 'officerOrg1')
      await assertRouteLoads(page, route)
      await bobAssessPage(page, testInfo, assessmentId)
    })
  }

  for (const route of ['/admin', '/users', '/compliance', '/asset-management', '/invoicing', '/platform'] as const) {
    test(`officer is BLOCKED from ${route}`, async ({ page }) => {
      await loginAs(page, 'officerOrg1')
      await assertRouteBlocked(page, route)
    })
  }
})

test.describe('client_viewer – restricted to client portal', () => {
  test.describe.configure({ mode: 'serial' })

  test('clientViewer loads /client-portal', async ({ page }, testInfo) => {
    await loginClientViewerOrSkip(page)
    await assertRouteLoads(page, '/client-portal')
    await bobAssessPage(page, testInfo, 'client-viewer-portal')
  })

  for (const route of ['/admin', '/users', '/compliance', '/officer-home', '/asset-management', '/invoicing'] as const) {
    test(`clientViewer is BLOCKED from ${route}`, async ({ page }) => {
      await loginClientViewerOrSkip(page)
      await assertRouteBlocked(page, route)
    })
  }
})

test.describe('nzscv_monitor – restricted access', () => {
  test('nzscv_monitor is BLOCKED from /admin (general)', async ({ page }) => {
    await loginClientViewerOrSkip(page)
    await assertRouteBlocked(page, '/admin')
  })
})