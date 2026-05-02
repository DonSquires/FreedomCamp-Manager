import { test, expect } from '@playwright/test'
import { loginAs } from './auth'

async function gotoWithPortalSelection(page: any, path: string) {
  await page.goto(path, { waitUntil: 'networkidle' })
  if (page.url().includes('/portal-selection')) {
    // Admin-officer sessions may require explicit portal choice before route access.
    await page.evaluate(() => window.sessionStorage.setItem('adminOfficerPortalChoice', 'selected'))
    await page.goto(path, { waitUntil: 'networkidle' })
  }
}

test.describe('Biosecurity E2E', () => {
  test.describe.configure({ mode: 'serial' })

  test('biosecurity control route loads for admin', async ({ page }) => {
    await loginAs(page, 'master')
    await gotoWithPortalSelection(page, '/biosecurity-control')

    await expect(page).not.toHaveURL(/\/login/)
    await expect(page).toHaveURL(/\/biosecurity-control/)
    await expect(page.locator('h1, h2').filter({ hasText: /biosecurity/i }).first()).toBeVisible({ timeout: 15000 })
  })

  test('job surface renders key controls', async ({ page }) => {
    await loginAs(page, 'master')
    await gotoWithPortalSelection(page, '/biosecurity-control')

    const hasPrimaryButton = await page.locator('button').filter({ hasText: /new|create|add|job/i }).first().isVisible().catch(() => false)
    const hasGridOrTable = await page.locator('table, [role="grid"], [data-slot="card"], .grid').first().isVisible().catch(() => false)
    expect(hasPrimaryButton || hasGridOrTable).toBeTruthy()
  })
})
