import { expect, test } from '@playwright/test'
import { loginAs } from './auth'

const hasAdminCreds = !!(process.env.PLAYWRIGHT_ADMIN_ORG1_EMAIL || process.env.PLAYWRIGHT_ADMIN_EMAIL || process.env.E2E_ADMIN_EMAIL)

test.describe('phase4 notice print signature gate', () => {
  test('keeps print disabled until human signature authorization', async ({ page }) => {
    test.skip(!hasAdminCreds, 'Admin credentials not configured')

    let noticesRouteHits = 0

    await page.context().route('**/rest/v1/notices_to_vacate*', async (route) => {
      noticesRouteHits += 1
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'phase4-notice-1',
            reference_number: 'NTV-PHASE4-001',
            plate_number: 'ABC123',
            breach_reason: 'Exceeded permitted nights in zone',
            nights_stayed: 4,
            status: 'issued',
            delivery_method: 'printed_onsite',
            issued_at: new Date().toISOString(),
            vacate_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            notice_html: '<html><body><h1>Notice to Vacate</h1><p>Phase 4 test</p></body></html>',
            zone: { name: 'Tahuna Beach' },
            issued_by_user: { first_name: 'Jane', last_name: 'Doe' },
            breach_alert: null,
          },
        ]),
      })
    })

    await loginAs(page, 'adminOrg1')
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
    await page.goto('/notice-to-vacate', { waitUntil: 'domcontentloaded' })

    await expect.poll(() => noticesRouteHits, { timeout: 20000 }).toBeGreaterThan(0)

    await page.getByRole('button', { name: /preview/i }).first().click()

    const printButton = page.getByRole('button', { name: /^print$/i })
    await expect(printButton).toBeDisabled()

    const authorizeButton = page.getByRole('button', { name: /authorize print/i })
    await expect(authorizeButton).toBeDisabled()

    await page.getByLabel(/digital signature/i).fill('XX')
    await expect(authorizeButton).toBeDisabled()

    const expectedSignerText = (await page.getByText(/Expected signer:/i).innerText()).replace('Expected signer:', '').trim()
    await page.getByLabel(/digital signature/i).fill(expectedSignerText)
    await expect(authorizeButton).toBeEnabled()

    await authorizeButton.click()
    await expect(printButton).toBeEnabled()
  })
})
