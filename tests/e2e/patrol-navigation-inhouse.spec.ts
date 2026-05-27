import { expect, test } from '@playwright/test'
import { loginAs } from './auth'

test.describe('Patrol navigation in-house routing', () => {
  test('calculates route with in-house provider or in-app fallback', async ({ page }) => {
    await loginAs(page, 'adminOrg1')
    await page.goto('/patrol-navigation', { waitUntil: 'domcontentloaded', timeout: 45000 })

    await expect(page.getByRole('heading', { name: /Patrol Navigation/i })).toBeVisible({ timeout: 15000 })

    await page.getByLabel('Enter coordinates').first().check()
    await page.getByPlaceholder('-36.8509,174.7645').fill('-41.27120,173.28390')

    await page.getByLabel('Custom coordinates').first().check()
    await page.getByPlaceholder('-36.9100,174.8300').fill('-41.28580,173.27780')

    await page.getByRole('button', { name: /Get Directions/i }).click()

    const summaryDistance = page.getByText(/Total distance/i)
    await expect(summaryDistance).toBeVisible({ timeout: 20000 })

    const providerHeading = page.getByText(/In-house map provider/i)
    await expect(providerHeading).toBeVisible({ timeout: 20000 })

    const providerText = page.locator('text=/in_house_mapping_gateway|inbuilt-patrol-route-engine/i').first()
    await expect(providerText).toBeVisible({ timeout: 20000 })

    await expect(page.getByText(/Turn-by-Turn Directions/i)).toBeVisible({ timeout: 10000 })
  })
})
