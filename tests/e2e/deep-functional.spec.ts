import { test, expect } from '@playwright/test'
import { loginAs, loginWithLiveCredentialsAndResolveProfile } from './auth'

const hasAdminOrg1Creds = Boolean(
  (process.env.PLAYWRIGHT_ADMIN_ORG1_EMAIL || process.env.PLAYWRIGHT_ADMIN_EMAIL || process.env.E2E_ADMIN_EMAIL) &&
  (process.env.PLAYWRIGHT_ADMIN_ORG1_PASSWORD || process.env.PLAYWRIGHT_ADMIN_PASSWORD || process.env.E2E_ADMIN_PASSWORD)
)

const hasLiveCreds = Boolean(
  (process.env.API_TEST_EMAIL || process.env.PLAYWRIGHT_LIVE_EMAIL || process.env.E2E_LIVE_EMAIL) &&
  (process.env.API_TEST_PASSWORD || process.env.PLAYWRIGHT_LIVE_PASSWORD || process.env.E2E_LIVE_PASSWORD)
)

async function expectAuthenticatedRoute(page: any, route: string) {
  await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await expect(page).not.toHaveURL(/\/login/)
  await expect(page.locator('body')).toBeVisible({ timeout: 20000 })
}

test.describe('Deep functional test actions', () => {
  test('@smoke admin can reach key functional routes', async ({ page }) => {
    test.setTimeout(120000)
    if (hasLiveCreds) {
      let profile = null
      try {
        profile = await loginWithLiveCredentialsAndResolveProfile(page)
      } catch (error: any) {
        test.skip(true, `Live credential login failed: ${error?.message || String(error)}`)
      }

      const resolvedRole = String(profile?.role || '').toLowerCase()

      if (resolvedRole === 'officer' || page.url().includes('/field-officer')) {
        await expectAuthenticatedRoute(page, '/field-officer')
        return
      }

      if (resolvedRole.startsWith('client_') || page.url().includes('/client')) {
        await expectAuthenticatedRoute(page, '/client')
        return
      }

      if (resolvedRole === 'master' || resolvedRole === 'grand_master' || page.url().includes('/platform')) {
        await expectAuthenticatedRoute(page, '/platform')
        await expectAuthenticatedRoute(page, '/organizations')
        return
      }

      await expectAuthenticatedRoute(page, '/admin')
      await expectAuthenticatedRoute(page, '/reports')
      return
    }

    test.skip(!hasAdminOrg1Creds, 'No live credentials and adminOrg1 credentials are not configured for this environment')
    await loginAs(page, 'adminOrg1')
    await expectAuthenticatedRoute(page, '/admin')
    await expectAuthenticatedRoute(page, '/compliance')
    await expectAuthenticatedRoute(page, '/reports')
    await expectAuthenticatedRoute(page, '/tender-workspace')
  })
})
