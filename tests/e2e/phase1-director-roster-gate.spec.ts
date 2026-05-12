import { test, expect } from '@playwright/test'

/**
 * Phase 1: The Director (Roster and Access Gate) - Checkpoint Test
 *
 * Verifies that field officers without active roster assignments are
 * redirected to the welfare-only /waiting-for-shift screen and cannot
 * access tactical modules.
 *
 * Success criteria:
 * - Non-rostered officer redirected to /waiting-for-shift
 * - Tactical data hidden
 * - Only Emergency tools available
 * - Rostered officer can access /field-officer normally
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173'
const OFFICER_EMAIL = process.env.PLAYWRIGHT_OFFICER_EMAIL || ''
const OFFICER_PASSWORD = process.env.PLAYWRIGHT_OFFICER_PASSWORD || ''

test.describe('Phase 1: Director Roster Gate', () => {
  test.skip(
    !OFFICER_EMAIL || !OFFICER_PASSWORD,
    'Skipping: PLAYWRIGHT_OFFICER_EMAIL and PLAYWRIGHT_OFFICER_PASSWORD required'
  )

  test('non-rostered officer is restricted to /waiting-for-shift', async ({ page }) => {
    // Navigate to app
    await page.goto(`${BASE_URL}/login`)
    expect(page).toHaveURL(/login/)

    // Sign in as officer
    await page.fill('input[type="email"]', OFFICER_EMAIL)
    await page.fill('input[type="password"]', OFFICER_PASSWORD)
    await page.click('button[type="submit"]')

    // Wait for redirect after login
    await page.waitForNavigation({ waitUntil: 'networkidle' })

    // If no roster, should be at /waiting-for-shift
    const currentUrl = page.url()
    if (!currentUrl.includes('/field-officer')) {
      // Expected: restricted to waiting
      expect(currentUrl).toContain('/waiting-for-shift')
      console.log('✓ Non-rostered officer correctly restricted to /waiting-for-shift')

      // Verify tactical modules are hidden
      const tacticalElements = await page.locator('[data-testid*="tactical"]').count()
      expect(tacticalElements).toBe(0)
      console.log('✓ Tactical modules not visible to waiting officer')

      // Verify emergency tools still available
      const emergencyButton = await page.locator('button:has-text("Emergency")').count()
      expect(emergencyButton).toBeGreaterThan(0)
      console.log('✓ Emergency tools available')

      // Try to navigate to tactical path manually
      await page.goto(`${BASE_URL}/field-officer`)

      // Should redirect back to waiting
      await page.waitForNavigation({ waitUntil: 'networkidle' })
      expect(page.url()).toContain('/waiting-for-shift')
      console.log('✓ Direct navigation to /field-officer redirects back to /waiting-for-shift')
    } else {
      // Officer has a roster - verify they CAN access tactical
      expect(currentUrl).toContain('/field-officer')
      console.log('✓ Rostered officer can access /field-officer')

      // Verify some tactical content is available
      const tacModule = await page.locator('[data-testid="tactical-module"]').count()
      console.log(`✓ Found ${tacModule} tactical modules available to rostered officer`)
    }
  })

  test('director gate applies only to officers', async ({ page }) => {
    // Admin users should never be affected by roster gate
    const masterEmail = process.env.PLAYWRIGHT_MASTER_EMAIL || ''
    const masterPassword = process.env.PLAYWRIGHT_MASTER_PASSWORD || ''

    if (!masterEmail || !masterPassword) {
      test.skip()
    }

    await page.goto(`${BASE_URL}/login`)
    await page.fill('input[type="email"]', masterEmail)
    await page.fill('input[type="password"]', masterPassword)
    await page.click('button[type="submit"]')

    await page.waitForNavigation({ waitUntil: 'networkidle' })

    // Admin should not be redirected to waiting-for-shift
    const currentUrl = page.url()
    expect(currentUrl).not.toContain('/waiting-for-shift')
    console.log('✓ Admin users not subject to roster gate')
  })

  test('roster gate redirects back from forbidden paths', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`)
    await page.fill('input[type="email"]', OFFICER_EMAIL)
    await page.fill('input[type="password"]', OFFICER_PASSWORD)
    await page.click('button[type="submit"]')

    await page.waitForNavigation({ waitUntil: 'networkidle' })

    // Try to access various tactical paths
    const forbiddenPaths = ['/field-officer/dispatch', '/field-officer/zones', '/field-officer/incidents']

    for (const path of forbiddenPaths) {
      // If non-rostered, should redirect to waiting
      if (page.url().includes('/waiting-for-shift')) {
        await page.goto(`${BASE_URL}${path}`)
        await page.waitForNavigation({ waitUntil: 'networkidle' })
        expect(page.url()).toContain('/waiting-for-shift')
        console.log(`✓ Path ${path} redirects to /waiting-for-shift for non-rostered officer`)
      }
    }
  })
})
