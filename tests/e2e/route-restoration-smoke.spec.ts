import { test, expect } from '@playwright/test'
import { loginAs } from './auth'

async function expectRouteAccessible(page: any, route: string) {
  await page.goto(route, { waitUntil: 'domcontentloaded' })

  // These routes were previously hard-redirected to "/".
  expect(page.url()).not.toBe('http://localhost:5173/')
  await expect(page).toHaveURL(new RegExp(route.replace('/', '\\/')), { timeout: 15000 })
  await expect(page.locator('body')).toBeVisible({ timeout: 15000 })
}

test.describe('Route Restoration Smoke', () => {
  test.describe.configure({ mode: 'serial' })

  test('admin path restores are reachable for admin-like users', async ({ page }) => {
    await loginAs(page, 'adminOrg1')

    await expectRouteAccessible(page, '/compliance-recalculation')
    await expectRouteAccessible(page, '/photo-reingest')
    await expectRouteAccessible(page, '/evidence-photo-linker')
    await expectRouteAccessible(page, '/admin/data-cleanup')
    await expectRouteAccessible(page, '/admin/data-integrity')
    await expectRouteAccessible(page, '/clean-dashboard')
  })

  test('master/grand_master restores are reachable', async ({ page }) => {
    await loginAs(page, 'master')

    await expectRouteAccessible(page, '/diagnostics')
    await expectRouteAccessible(page, '/grandmaster-code-studio')
    await expectRouteAccessible(page, '/admin/cleanup-recalculate')
  })
})
