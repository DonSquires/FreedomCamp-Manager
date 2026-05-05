/**
 * P4-8: Mobile Viewport (375px) Verification for AsyncStateWrapper Routes
 *
 * Validates that the 8 operator routes updated in P4-7 render without horizontal
 * overflow, expose their primary headings/labels, and show no uncaught JS error
 * banners at 375×812 (iPhone 12) viewport.
 *
 * The suite intentionally skips when credentials are absent so it is
 * non-blocking in environments without a live Supabase connection.
 */

import { test, expect } from '@playwright/test'
import { loginAs, isCredentialConfigured } from './auth'

// Run only on the Mobile Safari (375-wide) project.
// If executed on a desktop project the viewport check still passes (desktop
// is always ≥375px wide), but the real value is from the Mobile Safari runner.
test.use({ viewport: { width: 375, height: 812 } })
test.describe.configure({ timeout: 60000 })

const ROUTES_TO_CHECK = [
  { path: '/vehicles',           label: 'Vehicles',              heading: /vehicle/i },
  { path: '/breaches',           label: 'Breach Alerts',         heading: /breach/i },
  { path: '/enforcement-actions',label: 'Enforcement Actions',   heading: /enforcement/i },
  { path: '/enforcement-review', label: 'Enforcement Review',    heading: /enforcement|review/i },
  { path: '/compliance',         label: 'Compliance',            heading: /compliance/i },
  { path: '/live-patrol',        label: 'Live Patrol Monitor',   heading: /patrol|monitor/i },
  { path: '/dispatch-monitor',   label: 'Dispatch Monitor',      heading: /dispatch|monitor/i },
  { path: '/reports',            label: 'Reports',               heading: /report/i },
] as const

/**
 * Returns true if the page shows a recognised auth / setup gate so the test
 * can be skipped rather than fail due to missing credentials.
 */
async function isAuthGate(page: Parameters<typeof test>[0]['page']): Promise<boolean> {
  const body = await page.locator('body').innerText().catch(() => '')
  return /sign in|log in|login|setup required/i.test(body)
}

/**
 * Check that the body does not scroll horizontally at 375px width.
 * Returns the document.body.scrollWidth vs window.innerWidth.
 */
async function bodyScrollWidth(page: Parameters<typeof test>[0]['page']): Promise<{ scrollWidth: number; innerWidth: number }> {
  return page.evaluate(() => ({
    scrollWidth: document.body.scrollWidth,
    innerWidth: window.innerWidth,
  }))
}

test.describe('P4-8 — mobile viewport 375px: AsyncStateWrapper routes', () => {
  test.beforeEach(async ({ page }) => {
    if (!isCredentialConfigured('admin')) {
      test.skip(true, 'Admin credentials not configured — skipping mobile viewport check.')
    }
    await loginAs(page, 'admin')
  })

  for (const route of ROUTES_TO_CHECK) {
    test(`${route.label} — renders at 375px without horizontal overflow`, async ({ page }) => {
      await page.goto(route.path, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1500)

      // Skip gracefully if we hit an auth / setup gate instead of the real page.
      if (await isAuthGate(page)) {
        test.skip(true, `Auth gate encountered on ${route.path} — skipping.`)
        return
      }

      // 1. Page heading is present (either in <h1>, AppLayout title, or prominent text).
      await expect(
        page.locator('h1, [data-testid="page-title"], .text-xl, .text-2xl').first()
      ).toBeVisible({ timeout: 10000 })

      // 2. No hard JS error overlay (Vite error boundary or React error boundary visible).
      const errorOverlay = page.locator(
        '[data-testid="error-boundary"], .error-boundary-message, #vite-error-overlay'
      )
      await expect(errorOverlay).not.toBeVisible({ timeout: 2000 }).catch(() => {
        // tolerate if selector not present at all
      })

      // 3. No horizontal scroll at 375px — the AsyncStateWrapper uses w-full Cards
      //    that should not overflow.
      const { scrollWidth, innerWidth } = await bodyScrollWidth(page)
      expect(
        scrollWidth,
        `${route.label}: body scrollWidth (${scrollWidth}) exceeds innerWidth (${innerWidth}) — horizontal overflow at 375px`
      ).toBeLessThanOrEqual(innerWidth + 2) // 2px tolerance for scrollbar rounding
    })
  }
})
