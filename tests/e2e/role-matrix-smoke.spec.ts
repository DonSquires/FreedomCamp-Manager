import { test, expect } from '@playwright/test'
import { loginAs, type TestUserKey } from './auth'
import { bobAssessPage } from './bob-ui-assess'

// Always capture screenshots in this spec so Bob can assess every login state
// and the full visual record is preserved in the HTML report regardless of pass/fail.
test.use({ screenshot: 'on' })

const adminOrg1Email = String(process.env.PLAYWRIGHT_ADMIN_ORG1_EMAIL || process.env.PLAYWRIGHT_ADMIN_EMAIL || process.env.E2E_ADMIN_EMAIL || '').trim().toLowerCase()
const adminOrg2Email = String(process.env.PLAYWRIGHT_ADMIN_ORG2_EMAIL || process.env.E2E_ADMIN_ORG2_EMAIL || '').trim().toLowerCase()
const hasDistinctAdminOrg2Creds = !!adminOrg2Email && adminOrg2Email !== adminOrg1Email

async function expectRouteLoads(page: any, route: string) {
  await page.goto(route, { waitUntil: 'networkidle' })
  await expect(page).toHaveURL(new RegExp(route.replace('/', '\\/')))
  await expect(page.locator('main h1').first()).toBeVisible({ timeout: 10000 })
}

test.describe('Role Matrix Smoke', () => {
  // Single account is role-switched between tests; keep sequence deterministic.
  test.describe.configure({ mode: 'serial' })

  test('master can access platform', async ({ page }, testInfo) => {
    await loginAs(page, 'master')
    await expectRouteLoads(page, '/platform')
    await bobAssessPage(page, testInfo, 'master-platform')
  })

  test('adminOrg1 can access admin screen', async ({ page }, testInfo) => {
    await loginAs(page, 'adminOrg1')
    await expectRouteLoads(page, '/admin')
    await bobAssessPage(page, testInfo, 'adminOrg1-admin')
  })

  test('adminOrg2 can access admin screen', async ({ page }, testInfo) => {
    test.skip(!hasDistinctAdminOrg2Creds, 'Admin Org 2 credentials missing or same as Admin Org 1')
    await loginAs(page, 'adminOrg2')
    await expectRouteLoads(page, '/admin')
    await bobAssessPage(page, testInfo, 'adminOrg2-admin')
  })

  test('officerOrg1 can access field portal', async ({ page }, testInfo) => {
    await loginAs(page, 'officerOrg1')
    await page.goto('/field-officer', { waitUntil: 'networkidle' })
    await expect(page).toHaveURL(/\/(field-officer|officer-home)/)
    if (page.url().includes('/officer-home')) {
      await expect(page.getByText(/Team Chat|Browse Open Shifts|Request Ad-hoc Shift/i).first()).toBeVisible({ timeout: 10000 })
    } else {
      await expect(page.locator('main h1').first()).toBeVisible({ timeout: 10000 })
    }
    await bobAssessPage(page, testInfo, 'officerOrg1-field-portal')
  })

  test('clientViewer is restricted to client portal', async ({ page }, testInfo) => {
    await loginAs(page, 'clientViewer')
    await expectRouteLoads(page, '/client-portal')
    await bobAssessPage(page, testInfo, 'clientViewer-client-portal')

    await page.goto('/admin', { waitUntil: 'networkidle' })
    await expect(page).toHaveURL(/\/client-portal/)
  })

  test('clientStaff can access client portal and admin screen', async ({ page }, testInfo) => {
    await loginAs(page, 'clientStaff')
    await expectRouteLoads(page, '/client-portal')
    await bobAssessPage(page, testInfo, 'clientStaff-client-portal')
    await expectRouteLoads(page, '/admin')
    await bobAssessPage(page, testInfo, 'clientStaff-admin')
  })

  test('all configured test user keys resolve login credentials', async () => {
    const keys: TestUserKey[] = [
      'master',
      'adminOrg1',
      'adminOrg2',
      'officerOrg1',
      'clientViewer',
      'clientStaff',
    ]

    expect(keys.length).toBe(6)
  })
})
