import { test, expect } from '@playwright/test'
import { loginAs } from './auth'

test.describe('PTT Radio Mobile Visual Check', () => {
  test('capture mobile screenshot with dual hamburgers and context strip', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 851 })
    await loginAs(page, 'officerOrg1')

    await page.goto('/radio', { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)

    await page.screenshot({
      path: 'test-results/ptt-radio-mobile-visual-check.png',
      fullPage: true,
    })
  })

  test('capture desktop screenshot with minimized dock support', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await loginAs(page, 'officerOrg1')

    await page.goto('/radio', { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)

    await page.screenshot({
      path: 'test-results/ptt-radio-desktop-visual-check.png',
      fullPage: true,
    })
  })
})
