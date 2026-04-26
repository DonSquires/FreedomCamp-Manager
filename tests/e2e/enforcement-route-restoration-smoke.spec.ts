import { test, expect } from '@playwright/test'
import { loginAs } from './auth'

async function expectRouteAccessible(page: any, route: string) {
  await page.goto(route, { waitUntil: 'domcontentloaded' })
  expect(page.url()).not.toBe('http://localhost:5173/')
  await expect(page).toHaveURL(new RegExp(route.replace('/', '\\/')), { timeout: 15000 })
  await expect(page.locator('body')).toBeVisible({ timeout: 15000 })
}

test.describe('Enforcement Route Restoration Smoke', () => {
  test.describe.configure({ mode: 'serial' })

  test('admin-like users can open enforcement actions and command center', async ({ page }) => {
    await loginAs(page, 'adminOrg1')
    await expectRouteAccessible(page, '/enforcement-actions')
    await expectRouteAccessible(page, '/enforcement-command-center')
  })

  test('officer can open enforcement actions only', async ({ page }) => {
    await loginAs(page, 'officerOrg1')
    await expectRouteAccessible(page, '/enforcement-actions')

    await page.goto('/enforcement-command-center', { waitUntil: 'domcontentloaded' })
    await expect(page).not.toHaveURL(/\/enforcement-command-center(?:\/)?$/, { timeout: 15000 })
    await expect(page.locator('body')).toBeVisible({ timeout: 15000 })
  })
})
