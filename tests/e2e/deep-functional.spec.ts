import { test, expect } from '@playwright/test'
import { loginAs } from './auth'

const hasAdminOrg1Creds = Boolean(
  (process.env.PLAYWRIGHT_ADMIN_ORG1_EMAIL || process.env.PLAYWRIGHT_ADMIN_EMAIL || process.env.E2E_ADMIN_EMAIL) &&
  (process.env.PLAYWRIGHT_ADMIN_ORG1_PASSWORD || process.env.PLAYWRIGHT_ADMIN_PASSWORD || process.env.E2E_ADMIN_PASSWORD)
)

async function expectAuthenticatedRoute(page: any, route: string) {
  await page.goto(route, { waitUntil: 'domcontentloaded' })
  await expect(page).not.toHaveURL(/\/login/)
  await expect(page.locator('body')).toBeVisible({ timeout: 20000 })
}

test.describe('Deep functional test actions', () => {
  test('@smoke admin can reach key functional routes', async ({ page }) => {
    test.skip(!hasAdminOrg1Creds, 'adminOrg1 credentials are not configured for this environment')
    await loginAs(page, 'adminOrg1')

    await expectAuthenticatedRoute(page, '/admin')
    await expectAuthenticatedRoute(page, '/compliance')
    await expectAuthenticatedRoute(page, '/reports')
    await expectAuthenticatedRoute(page, '/tender-workspace')
  })
})
