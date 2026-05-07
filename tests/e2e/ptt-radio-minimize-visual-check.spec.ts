import { test, expect } from '@playwright/test'
import { loginAs } from './auth'

test.describe('PTT Radio Minimize Visual Check', () => {
  test('mobile minimize routes back with bottom dock', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 851 })
    await loginAs(page, 'officerOrg1')

    await page.goto('/radio', { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    await page.getByLabel('Minimize radio').click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1200)

    await page.screenshot({
      path: 'test-results/ptt-radio-mobile-minimized-dock.png',
      fullPage: true,
    })
  })

  test('desktop minimize routes back with bottom-right dock', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await loginAs(page, 'officerOrg1')

    await page.goto('/radio', { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    await page.getByRole('button', { name: /minimize/i }).click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1200)

    await page.screenshot({
      path: 'test-results/ptt-radio-desktop-minimized-dock.png',
      fullPage: true,
    })
  })
})
