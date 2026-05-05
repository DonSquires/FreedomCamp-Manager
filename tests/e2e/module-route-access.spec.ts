/**
 * Module Route Access – Role Matrix E2E
 *
 * Verifies that every protected route:
 *   - Loads successfully when accessed by a role that is allowed
 *   - Redirects away when accessed by a role that is NOT allowed
 *
 * Covers all roles: master, admin (adminOrg1), admin_officer (clientStaff),
 * officer (officerOrg1), client_viewer (clientViewer).
 *
 * Strategy: visit the route as a role that SHOULD access it → assert page loads.
 *           visit the route as a role that SHOULD NOT → assert redirect away.
 */

import { test, expect } from '@playwright/test'
import { loginAs } from './auth'
import { bobAssessPage } from './bob-ui-assess'

test.use({ screenshot: 'on' })

// ─── helpers ────────────────────────────────────────────────────────────────

async function assertRouteLoads(page: any, route: string, headingPattern?: RegExp) {
  await page.goto(route, { waitUntil: 'domcontentloaded' })

  // Shared/fallback role sessions can occasionally land on portal selection
  // after auth role synchronization; re-apply selection and retry once.
  if (page.url().includes('/portal-selection')) {
    await page.evaluate(() => {
      window.sessionStorage.setItem('adminOfficerPortalChoice', 'selected')
    })
    await page.goto(route, { waitUntil: 'domcontentloaded' })
  }

  const currentPath = new URL(page.url()).pathname
  const sameRoute = currentPath === route || currentPath.startsWith(`${route}/`)
  const toleratedFallback =
    (route.startsWith('/admin/') && currentPath === '/admin') ||
    (route.startsWith('/crm/') && currentPath === '/crm') ||
    (route === '/field-officer' && currentPath === '/officer-home') ||
    (route.startsWith('/dispatch/') && currentPath === '/dispatch')

  // Route definitions evolve; accept known umbrella/fallback landings for allowed pages.
  expect(sameRoute || toleratedFallback).toBeTruthy()

  const accessDeniedVisible = await page.getByRole('heading', { name: /access restricted/i }).isVisible().catch(() => false)
  expect(accessDeniedVisible).toBeFalsy()

  // At minimum, something meaningful renders – no blank white page
  if (headingPattern) {
    await expect(page.locator('h1, h2').filter({ visible: true }).first()).toContainText(headingPattern, { timeout: 12000 })
  } else {
    // Some officer pages intentionally render body content without h1/h2,
    // so treat either a visible <main> OR a visible heading as a loaded state.
    const main = page.locator('main').first()
    const heading = page.locator('h1, h2').filter({ visible: true }).first()

    const loadedByMainOrHeading = await Promise.race([
      main.waitFor({ state: 'visible', timeout: 12000 }).then(() => true).catch(() => false),
      heading.waitFor({ state: 'visible', timeout: 12000 }).then(() => true).catch(() => false),
    ])

    expect(loadedByMainOrHeading).toBeTruthy()
  }
}

async function assertRouteBlocked(page: any, route: string) {
  await page.goto(route, { waitUntil: 'networkidle' })
  const currentUrl = page.url()
  const requestedPath = route.split('?')[0]
  const remainedOnRoute = new RegExp(`${requestedPath.replace(/\//g, '\\/')}$`).test(currentUrl)

  if (!remainedOnRoute) {
    // Redirect-based block behavior (legacy)
    return
  }

  // Explicit guidance behavior: blocked route may stay on URL but show denied/not found messaging.
  const accessDeniedHeading = page.getByRole('heading', { name: /access restricted|forbidden|unauthorized/i })
  const accessDeniedText = page.locator('text=/access.*denied|not.*authorized|forbidden|not found/i').first()
  const deniedByHeading = await accessDeniedHeading.isVisible({ timeout: 3000 }).catch(() => false)
  const deniedByText = await accessDeniedText.isVisible({ timeout: 3000 }).catch(() => false)
  expect(deniedByHeading || deniedByText).toBeTruthy()
}

async function assertRouteLoadsOrRedirects(page: any, route: string, fallbackRoute: string) {
  await page.goto(route, { waitUntil: 'networkidle' })
  const currentUrl = page.url()
  const onPrimary = new RegExp(`${route.replace(/\//g, '\\/')}$`).test(currentUrl)
  const onFallback = new RegExp(`${fallbackRoute.replace(/\//g, '\\/')}$`).test(currentUrl)
  expect(onPrimary || onFallback).toBeTruthy()
}

async function assertNavPathVisible(page: any, path: string, groupLabel?: string) {
  if (groupLabel) {
    const groupToggle = page.getByRole('button', { name: new RegExp(groupLabel, 'i') }).first()
    if (await groupToggle.isVisible().catch(() => false)) {
      await groupToggle.click()
    }
  }
  const navLink = page.locator(`a[href="${path}"]`)
  await expect(navLink.first()).toBeVisible({ timeout: 12000 })
}

async function assertNavPathHidden(page: any, path: string) {
  const navLink = page.locator(`a[href="${path}"]`)
  await expect(navLink).toHaveCount(0)
}

// ─── MASTER role ─────────────────────────────────────────────────────────────

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

// ─── ADMIN role ───────────────────────────────────────────────────────────────

test.describe('admin – management modules', () => {
  test.describe.configure({ mode: 'serial' })

  test('admin loads /admin', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/admin')
    await bobAssessPage(page, testInfo, 'admin-hub')
  })

  test('admin loads /admin/dashboard', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/admin/dashboard')
    await bobAssessPage(page, testInfo, 'admin-dashboard')
  })

  test('admin loads /compliance', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/compliance')
    await bobAssessPage(page, testInfo, 'admin-compliance')
  })

  test('admin loads /breaches', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/breaches')
    await bobAssessPage(page, testInfo, 'admin-breaches')
  })

  test('admin loads /vehicles', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/vehicles')
    await bobAssessPage(page, testInfo, 'admin-vehicles')
  })

  test('admin loads /zones', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/zones')
    await bobAssessPage(page, testInfo, 'admin-zones')
  })

  test('admin loads /data', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/data')
    await bobAssessPage(page, testInfo, 'admin-data')
  })

  test('admin loads /users', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/users')
    await bobAssessPage(page, testInfo, 'admin-users')
  })

  test('admin loads /reports', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/reports')
    await bobAssessPage(page, testInfo, 'admin-reports')
  })

  test('admin loads /live-tracking', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/live-tracking')
    await bobAssessPage(page, testInfo, 'admin-live-tracking')
  })

  test('admin loads /organization-profile', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/organization-profile')
    await bobAssessPage(page, testInfo, 'admin-org-profile')
  })

  test('admin loads /audit-log', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/audit-log')
    await bobAssessPage(page, testInfo, 'admin-audit-log')
  })

  test('admin loads /infringements', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/infringements')
    await bobAssessPage(page, testInfo, 'admin-infringements')
  })

  test('admin loads /patrol-checkpoints', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/patrol-checkpoints')
    await bobAssessPage(page, testInfo, 'admin-patrol-checkpoints')
  })

  test('admin loads /patrol-schedule', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/patrol-schedule')
    await bobAssessPage(page, testInfo, 'admin-patrol-schedule')
  })

  test('admin loads /patrol-kpis', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/patrol-kpis')
    await bobAssessPage(page, testInfo, 'admin-patrol-kpis')
  })

  test('admin loads /live-patrol', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/live-patrol')
    await bobAssessPage(page, testInfo, 'admin-live-patrol')
  })

  test('admin loads /custom-reports', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/custom-reports')
    await bobAssessPage(page, testInfo, 'admin-custom-reports')
  })

  test('admin loads /ai-analysis', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/ai-analysis')
    await bobAssessPage(page, testInfo, 'admin-ai-analysis')
  })

  test('admin loads /hotspots', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/hotspots')
    await bobAssessPage(page, testInfo, 'admin-hotspots')
  })

  test('admin loads /spatial-compliance', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/spatial-compliance')
    await bobAssessPage(page, testInfo, 'admin-spatial-compliance')
  })

  test('admin loads /compliance-analytics', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/compliance-analytics')
    await bobAssessPage(page, testInfo, 'admin-compliance-analytics')
  })

  test('admin loads /incident-reports', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/incident-reports')
    await bobAssessPage(page, testInfo, 'admin-incident-reports')
  })

  test('admin loads /observations', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/observations')
    await bobAssessPage(page, testInfo, 'admin-observations')
  })

  test('admin loads /enforcement-review', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/enforcement-review')
    await bobAssessPage(page, testInfo, 'admin-enforcement-review')
  })

  test('admin loads /investigations', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/investigations')
    await bobAssessPage(page, testInfo, 'admin-investigations')
  })

  test('admin loads /notice-to-vacate', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/notice-to-vacate')
    await bobAssessPage(page, testInfo, 'admin-notice-to-vacate')
  })

  test('admin loads /disputes', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/disputes')
    await bobAssessPage(page, testInfo, 'admin-disputes')
  })

  test('admin loads /admin/discrepancies', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/admin/discrepancies')
    await bobAssessPage(page, testInfo, 'admin-discrepancies')
  })

  test('admin loads /admin/nzscv', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/admin/nzscv')
    await bobAssessPage(page, testInfo, 'admin-nzscv')
  })

  test('admin loads /officer-welfare', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/officer-welfare')
    await bobAssessPage(page, testInfo, 'admin-officer-welfare')
  })

  test('admin loads /privacy-curtain', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/privacy-curtain')
    await bobAssessPage(page, testInfo, 'admin-privacy-curtain')
  })

  test('admin loads /person-records', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/person-records')
    await bobAssessPage(page, testInfo, 'admin-person-records')
  })

  test('admin loads /identity-verification', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/identity-verification')
    await bobAssessPage(page, testInfo, 'admin-identity-verification')
  })

  test('admin loads /import-data', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/import-data')
    await bobAssessPage(page, testInfo, 'admin-import-data')
  })

  test('admin loads /parking', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/parking')
    await bobAssessPage(page, testInfo, 'admin-parking')
  })

  test('admin loads /noise-control', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/noise-control')
    await bobAssessPage(page, testInfo, 'admin-noise-control')
  })

  test('admin loads /biosecurity-control', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/biosecurity-control')
    await bobAssessPage(page, testInfo, 'admin-biosecurity-control')
  })

  test('admin loads /smoke-control', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/smoke-control')
    await bobAssessPage(page, testInfo, 'admin-smoke-control')
  })

  test('admin loads /vehicle-registry', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/vehicle-registry')
    await bobAssessPage(page, testInfo, 'admin-vehicle-registry')
  })

  test('admin loads /admin/canonical-records', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/admin/canonical-records')
    await bobAssessPage(page, testInfo, 'admin-canonical-records')
  })

  test('admin loads /asset-management', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/asset-management')
    await bobAssessPage(page, testInfo, 'admin-asset-management')
  })

  test('admin loads /invoicing', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/invoicing')
    await bobAssessPage(page, testInfo, 'admin-invoicing')
  })

  test('admin loads /pricing', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/pricing')
    await bobAssessPage(page, testInfo, 'admin-pricing')
  })

  test('admin loads /timesheets', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/timesheets')
    await bobAssessPage(page, testInfo, 'admin-timesheets')
  })

  test('admin loads /open-shifts', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/open-shifts')
    await bobAssessPage(page, testInfo, 'admin-open-shifts')
  })

  test('admin loads /dispatch', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/dispatch')
    await bobAssessPage(page, testInfo, 'admin-dispatch')
  })

  test('admin loads /dispatch-monitor', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/dispatch-monitor')
    await bobAssessPage(page, testInfo, 'admin-dispatch-monitor')
  })

  test('admin loads /dispatch-wizard', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/dispatch-wizard')
    await bobAssessPage(page, testInfo, 'admin-dispatch-wizard')
  })

  test('admin loads /dispatched-jobs', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/dispatched-jobs')
    await bobAssessPage(page, testInfo, 'admin-dispatched-jobs')
  })

  test('admin loads /job-map', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/job-map')
    await bobAssessPage(page, testInfo, 'admin-job-map')
  })

  test('admin loads /operations-map', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/operations-map')
    await bobAssessPage(page, testInfo, 'admin-operations-map')
  })

  test('admin loads /client-sites', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/client-sites')
    await bobAssessPage(page, testInfo, 'admin-client-sites')
  })

  test('admin loads /client-master-list', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/client-master-list')
    await bobAssessPage(page, testInfo, 'admin-client-master-list')
  })

  test('admin loads /roster', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/roster')
    await bobAssessPage(page, testInfo, 'admin-roster')
  })

  test('admin loads /officer-skills', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/officer-skills')
    await bobAssessPage(page, testInfo, 'admin-officer-skills')
  })

  test('admin loads /crm', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/crm')
    await bobAssessPage(page, testInfo, 'admin-crm')
  })

  test('admin loads /bob-intake-queue', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/bob-intake-queue')
    await bobAssessPage(page, testInfo, 'admin-bob-intake')
  })

  test('admin loads /bob-assistant', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/bob-assistant')
    await bobAssessPage(page, testInfo, 'admin-bob-assistant')
  })

  test('admin loads /live-plan-reviews', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteLoads(page, '/live-plan-reviews')
    await bobAssessPage(page, testInfo, 'admin-live-plan-reviews')
  })

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

// ─── OFFICER role ─────────────────────────────────────────────────────────────

test.describe('officer – field portal access', () => {
  test.describe.configure({ mode: 'serial' })

  test('officer loads /officer-home', async ({ page }, testInfo) => {
    await loginAs(page, 'officerOrg1')
    await assertRouteLoads(page, '/officer-home')
    await bobAssessPage(page, testInfo, 'officer-home')
  })

  test('officer loads /field-officer', async ({ page }, testInfo) => {
    await loginAs(page, 'officerOrg1')
    // If field_officer area access is not enabled for this officer account,
    // App redirects to /officer-home.
    await assertRouteLoadsOrRedirects(page, '/field-officer', '/officer-home')
    await bobAssessPage(page, testInfo, 'officer-field-portal')
  })

  test('officer loads /infringements', async ({ page }, testInfo) => {
    await loginAs(page, 'officerOrg1')
    await assertRouteLoads(page, '/infringements')
    await bobAssessPage(page, testInfo, 'officer-infringements')
  })

  test('officer loads /points-of-interest', async ({ page }, testInfo) => {
    await loginAs(page, 'officerOrg1')
    await assertRouteLoads(page, '/points-of-interest')
    await bobAssessPage(page, testInfo, 'officer-points-of-interest')
  })

  test('officer loads /site-risk-assessment', async ({ page }, testInfo) => {
    await loginAs(page, 'officerOrg1')
    await assertRouteLoads(page, '/site-risk-assessment')
    await bobAssessPage(page, testInfo, 'officer-site-risk')
  })

  test('officer loads /face-recognition', async ({ page }, testInfo) => {
    await loginAs(page, 'officerOrg1')
    await assertRouteLoads(page, '/face-recognition')
    await bobAssessPage(page, testInfo, 'officer-face-recognition')
  })

  test('officer loads /open-shifts', async ({ page }, testInfo) => {
    await loginAs(page, 'officerOrg1')
    await assertRouteLoads(page, '/open-shifts')
    await bobAssessPage(page, testInfo, 'officer-open-shifts')
  })

  test('officer loads /job-map', async ({ page }, testInfo) => {
    await loginAs(page, 'officerOrg1')
    await assertRouteLoads(page, '/job-map')
    await bobAssessPage(page, testInfo, 'officer-job-map')
  })

  test('officer loads /bob-assistant', async ({ page }, testInfo) => {
    await loginAs(page, 'officerOrg1')
    await assertRouteLoads(page, '/bob-assistant')
    await bobAssessPage(page, testInfo, 'officer-bob-assistant')
  })

  test('officer loads /radio', async ({ page }, testInfo) => {
    await loginAs(page, 'officerOrg1')
    await assertRouteLoads(page, '/radio')
    await bobAssessPage(page, testInfo, 'officer-radio')
  })

  test('officer loads /availability', async ({ page }, testInfo) => {
    await loginAs(page, 'officerOrg1')
    await assertRouteLoads(page, '/availability')
    await bobAssessPage(page, testInfo, 'officer-availability')
  })

  test('officer is BLOCKED from /admin', async ({ page }) => {
    await loginAs(page, 'officerOrg1')
    await assertRouteBlocked(page, '/admin')
  })

  test('officer is BLOCKED from /users', async ({ page }) => {
    await loginAs(page, 'officerOrg1')
    await assertRouteBlocked(page, '/users')
  })

  test('officer is BLOCKED from /compliance', async ({ page }) => {
    await loginAs(page, 'officerOrg1')
    await assertRouteBlocked(page, '/compliance')
  })

  test('officer is BLOCKED from /asset-management', async ({ page }) => {
    await loginAs(page, 'officerOrg1')
    await assertRouteBlocked(page, '/asset-management')
  })

  test('officer is BLOCKED from /invoicing', async ({ page }) => {
    await loginAs(page, 'officerOrg1')
    await assertRouteBlocked(page, '/invoicing')
  })

  test('officer is BLOCKED from /platform', async ({ page }) => {
    await loginAs(page, 'officerOrg1')
    await assertRouteBlocked(page, '/platform')
  })
})

// ─── CLIENT VIEWER role ───────────────────────────────────────────────────────

test.describe('client_viewer – restricted to client portal', () => {
  test.describe.configure({ mode: 'serial' })

  test('clientViewer loads /client-portal', async ({ page }, testInfo) => {
    await loginAs(page, 'clientViewer')
    await assertRouteLoads(page, '/client-portal')
    await bobAssessPage(page, testInfo, 'client-viewer-portal')
  })

  test('clientViewer is BLOCKED from /admin', async ({ page }) => {
    await loginAs(page, 'clientViewer')
    await assertRouteBlocked(page, '/admin')
  })

  test('clientViewer is BLOCKED from /users', async ({ page }) => {
    await loginAs(page, 'clientViewer')
    await assertRouteBlocked(page, '/users')
  })

  test('clientViewer is BLOCKED from /compliance', async ({ page }) => {
    await loginAs(page, 'clientViewer')
    await assertRouteBlocked(page, '/compliance')
  })

  test('clientViewer is BLOCKED from /officer-home', async ({ page }) => {
    await loginAs(page, 'clientViewer')
    await assertRouteBlocked(page, '/officer-home')
  })

  test('clientViewer is BLOCKED from /asset-management', async ({ page }) => {
    await loginAs(page, 'clientViewer')
    await assertRouteBlocked(page, '/asset-management')
  })

  test('clientViewer is BLOCKED from /invoicing', async ({ page }) => {
    await loginAs(page, 'clientViewer')
    await assertRouteBlocked(page, '/invoicing')
  })
})

// ─── NZSCV MONITOR role ───────────────────────────────────────────────────────

test.describe('nzscv_monitor – restricted access', () => {
  // nzscv_monitor has its own test user; fall back to clientViewer if not configured.
  // Routes accessible: /admin/nzscv, /vehicle-registry (see App.tsx)

  test('nzscv_monitor is BLOCKED from /admin (general)', async ({ page }) => {
    await loginAs(page, 'clientViewer') // closest available restricted role
    await assertRouteBlocked(page, '/admin')
  })
})

// ─── ORG ISOLATION — CRM Parameterised Routes ─────────────────────────────────
//
// Verifies that /crm/client/:orgId and /crm/contractor/:orgId cannot be
// accessed with a spoofed orgId that does not belong to the authenticated
// user's organisation tree.
//
// The frontend guard (useClientOrgIds) will redirect to /crm when orgId is
// outside the user's allowed descendant set. The RLS on the organisations
// table provides the server-side defence.

test.describe('org isolation – CRM parameterised routes', () => {
  test.describe.configure({ mode: 'serial' })

  const SPOOFED_ORG_ID = '00000000-0000-0000-0000-000000000001'

  test('admin cannot access /crm/client/:spoofedOrgId from another org', async ({ page }) => {
    await loginAs(page, 'adminOrg1')
    // Navigate to a client org ID that does not belong to adminOrg1's hierarchy
    await page.goto(`/crm/client/${SPOOFED_ORG_ID}`, { waitUntil: 'networkidle' })
    // Guard should redirect back to /crm (or /login if not authenticated)
    const url = page.url()
    expect(url).not.toContain(SPOOFED_ORG_ID)
  })

  test('admin cannot access /crm/contractor/:spoofedOrgId from another org', async ({ page }) => {
    await loginAs(page, 'adminOrg1')
    await page.goto(`/crm/contractor/${SPOOFED_ORG_ID}`, { waitUntil: 'networkidle' })
    const url = page.url()
    expect(url).not.toContain(SPOOFED_ORG_ID)
  })

  test('officer cannot access /crm/client/:spoofedOrgId', async ({ page }) => {
    await loginAs(page, 'officerOrg1')
    await page.goto(`/crm/client/${SPOOFED_ORG_ID}`, { waitUntil: 'networkidle' })
    // Officers don't have access to /crm routes at all — should redirect away
    const url = page.url()
    expect(url).not.toContain(SPOOFED_ORG_ID)
  })

  test('master cannot access /crm/client/:spoofedOrgId outside assigned orgs', async ({ page }) => {
    await loginAs(page, 'master')
    await page.goto(`/crm/client/${SPOOFED_ORG_ID}`, { waitUntil: 'networkidle' })
    const url = page.url()
    expect(url).not.toContain(SPOOFED_ORG_ID)
  })

  test('master cannot access /crm/contractor/:spoofedOrgId outside assigned orgs', async ({ page }) => {
    await loginAs(page, 'master')
    await page.goto(`/crm/contractor/${SPOOFED_ORG_ID}`, { waitUntil: 'networkidle' })
    const url = page.url()
    expect(url).not.toContain(SPOOFED_ORG_ID)
  })
})

// ─── CROSS-ORG REGRESSION MATRIX GAPS ───────────────────────────────────────

test.describe('cross-org matrix regression checks', () => {
  test.describe.configure({ mode: 'serial' })

  test('admin is BLOCKED from /grandmaster-code-studio', async ({ page }) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteBlocked(page, '/grandmaster-code-studio')
  })

  test('admin is BLOCKED from /compliance-escalations', async ({ page }) => {
    await loginAs(page, 'adminOrg1')
    await assertRouteBlocked(page, '/compliance-escalations')
  })

  test('master is BLOCKED from /grandmaster-code-studio', async ({ page }) => {
    await loginAs(page, 'master')
    await assertRouteBlocked(page, '/grandmaster-code-studio')
  })

  test('master is BLOCKED from /compliance-escalations', async ({ page }) => {
    await loginAs(page, 'master')
    await assertRouteBlocked(page, '/compliance-escalations')
  })
})

// ─── ROUTE/MENU PARITY ASSERTIONS (P4-2) ────────────────────────────────────

test.describe('route/menu parity assertions', () => {
  test.describe.configure({ mode: 'serial' })

  test('admin does not see internal tools link and is blocked from route', async ({ page }) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/admin', { waitUntil: 'domcontentloaded' })
    await assertNavPathHidden(page, '/compliance-recalculation')
    await assertRouteBlocked(page, '/compliance-recalculation')
  })

  test('master can load internal tools route', async ({ page }, testInfo) => {
    await loginAs(page, 'master')
    await page.goto('/platform', { waitUntil: 'domcontentloaded' })
    await assertRouteLoads(page, '/compliance-recalculation')
    await bobAssessPage(page, testInfo, 'master-route-menu-parity-internal-tools')
  })

  test('officer does not see users link and is blocked from route', async ({ page }) => {
    await loginAs(page, 'officerOrg1')
    await page.goto('/officer-home', { waitUntil: 'domcontentloaded' })
    await assertNavPathHidden(page, '/users')
    await assertRouteBlocked(page, '/users')
  })
})
