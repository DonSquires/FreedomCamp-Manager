import { test, expect } from '@playwright/test'
import { loginAs, isCredentialConfigured } from './auth'
import { bobAssessPage } from './bob-ui-assess'
import { assertRouteBlocked, assertRouteLoads, assertRouteLoadsOrRedirects } from './helpers/route-access-helpers'

test.use({ screenshot: 'on' })

const sharedFallbackMode = process.env.PLAYWRIGHT_ALLOW_SHARED_CREDENTIAL_FALLBACK === '1'

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
    test.skip(!isCredentialConfigured('officerOrg1'), 'Officer credentials not configured in this environment.')
    await loginAs(page, 'officerOrg1')
    await assertRouteLoads(page, '/officer-home')
    await bobAssessPage(page, testInfo, 'officer-home')
  })

  test('officer loads /field-officer', async ({ page }, testInfo) => {
    test.skip(sharedFallbackMode, 'Shared fallback single account cannot guarantee officer portal access role.')
    await loginAs(page, 'officerOrg1')
    await page.goto('/field-officer', { waitUntil: 'domcontentloaded' })
    const currentPath = new URL(page.url()).pathname
    expect(['/field-officer', '/officer-home', '/admin', '/portal-selection']).toContain(currentPath)
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
    test.skip(!isCredentialConfigured('clientViewer'), 'ClientViewer credentials not configured in this environment.')
    await loginClientViewerOrSkip(page)
    await assertRouteLoads(page, '/client-portal')
    await bobAssessPage(page, testInfo, 'client-viewer-portal')
  })

  for (const route of ['/admin', '/users', '/compliance', '/officer-home', '/asset-management', '/invoicing'] as const) {
    test(`clientViewer is BLOCKED from ${route}`, async ({ page }) => {
      test.skip(sharedFallbackMode, 'Shared fallback account cannot guarantee client-viewer role restrictions.')
      await loginClientViewerOrSkip(page)
      await assertRouteBlocked(page, route)
    })
  }
})

test.describe('nzscv_monitor – restricted access', () => {
  test('nzscv_monitor is BLOCKED from /admin (general)', async ({ page }) => {
    test.skip(!isCredentialConfigured('nzscv_monitor'), 'NZSCV monitor credentials not configured in this environment.')
    await loginAs(page, 'nzscv_monitor')
    await assertRouteBlocked(page, '/admin')
  })
})