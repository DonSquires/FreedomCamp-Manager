import { test, expect } from '@playwright/test'
import { loginAs } from './auth'

async function expectAuthenticatedRoute(page: any, route: string) {
  await page.goto(route, { waitUntil: 'domcontentloaded' })
  await expect(page).not.toHaveURL(/\/login/)
  await expect(page.locator('body')).toBeVisible({ timeout: 20000 })
}

test.describe('Deep functional test actions', () => {
  test('admin can reach key functional routes', async ({ page }) => {
    await loginAs(page, 'adminOrg1')

    await expectAuthenticatedRoute(page, '/admin')
    await expectAuthenticatedRoute(page, '/compliance')
    await expectAuthenticatedRoute(page, '/reports')
    await expectAuthenticatedRoute(page, '/tender-workspace')
  })
})