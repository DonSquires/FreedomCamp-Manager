import { expect, test } from '@playwright/test'
import { loginAs } from './auth'

test.describe('Patrol route navigation verification', () => {
  test('calculates a route from manual coordinates', async ({ page }) => {
    test.setTimeout(180000)

    await loginAs(page, 'master')
    await page.goto('/patrol-navigation', { waitUntil: 'domcontentloaded', timeout: 45000 })

    if (page.url().includes('/login')) {
      await loginAs(page, 'master')
      await page.goto('/patrol-navigation', { waitUntil: 'domcontentloaded', timeout: 45000 })
    }

    await expect(page.getByRole('heading', { name: /patrol navigation/i })).toBeVisible({ timeout: 30000 })

    await page.getByRole('radio', { name: /enter coordinates/i }).first().check()
    await page.getByPlaceholder('-36.8509,174.7645').first().fill('-41.2706,173.2836')

    await page.getByRole('radio', { name: /custom coordinates/i }).first().check()
    await page.getByPlaceholder('-36.9100,174.8300').first().fill('-41.2858,173.2778')

    const getDirections = page.getByRole('button', { name: /get directions/i }).first()
    await expect(getDirections).toBeEnabled({ timeout: 10000 })
    await getDirections.click()

    await expect(page.getByText(/total distance/i).first()).toBeVisible({ timeout: 30000 })
    await expect(page.getByText(/estimated drive time/i).first()).toBeVisible({ timeout: 30000 })
    await expect(page.getByText(/turn-by-turn directions/i).first()).toBeVisible({ timeout: 30000 })
  })
})
