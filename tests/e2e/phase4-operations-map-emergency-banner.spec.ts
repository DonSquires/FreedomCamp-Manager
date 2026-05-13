import { expect, test } from '@playwright/test'
import { loginAs } from './auth'

const hasAdminCreds = !!(process.env.PLAYWRIGHT_ADMIN_ORG1_EMAIL || process.env.PLAYWRIGHT_ADMIN_EMAIL || process.env.E2E_ADMIN_EMAIL)

test.describe('phase4 operations map emergency escalation', () => {
  test('shows emergency GPS broadcast banner when SOS alert is present', async ({ page }) => {
    test.skip(!hasAdminCreds, 'Admin credentials not configured')

    let welfareRouteHits = 0

    // Context route catches requests across redirects/portal hops in shared auth flow.
    await page.context().route('**/rest/v1/officer_welfare_alerts*', async (route) => {
      welfareRouteHits += 1
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'phase4-alert-1',
            officer_name: 'Phase Four Officer',
            officer_phone: '0200000000',
            alert_type: 'armed_danger',
            status: 'pending',
            gps_latitude: -41.27123,
            gps_longitude: 173.28456,
            alert_sent_at: new Date().toISOString(),
            escalation_level: 2,
          },
        ]),
      })
    })

    await loginAs(page, 'adminOrg1')
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
    await page.goto('/operations-map', { waitUntil: 'domcontentloaded' })

    await expect.poll(() => welfareRouteHits, { timeout: 25000 }).toBeGreaterThan(0)

    const banner = page.getByText(/Emergency channel broadcast active:/i)
    await expect(banner).toBeVisible({ timeout: 25000 })
    await expect(banner).toContainText('Phase Four Officer')
    await expect(banner).toContainText('(-41.27123, 173.28456)')
  })
})
